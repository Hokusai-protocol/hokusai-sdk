import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const adapterRoot = path.join(repoRoot, 'packages', 'adapter-codex');
const pluginSourceDir = path.join(adapterRoot, 'plugin');
const bundleSourceFile = path.join(adapterRoot, 'dist-bundle', 'index.js');
const distZipDir = path.join(repoRoot, 'dist-zip');
const fixedDate = new Date('1970-01-01T00:00:00.000Z');
const fixedTimeSeconds = fixedDate.getTime() / 1000;

const denylistPatterns = [
  /(^|\/)\.env(\.[^/]+)?$/i,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)features(\/|$)/,
  /\.test\.[cm]?[jt]sx?$/i,
  /(^|\/)__fixtures__(\/|$)/,
  /worktrees/i,
];

function parseVersionArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--version') {
      return argv[index + 1];
    }
  }

  return undefined;
}

function resolveVersion() {
  const explicitVersion = parseVersionArg(process.argv.slice(2));
  if (explicitVersion) {
    return explicitVersion;
  }

  const refName = process.env.GITHUB_REF_NAME?.trim();
  if (refName && /^v?\d+\.\d+\.\d+(?:[-+].*)?$/.test(refName)) {
    return refName.replace(/^v/, '');
  }

  const packageJson = JSON.parse(
    readFileSync(path.join(adapterRoot, 'package.json'), 'utf8'),
  );
  return packageJson.version;
}

function assertExists(filePath, message) {
  if (!existsSync(filePath)) {
    throw new Error(message);
  }
}

function listRelativeFiles(rootDir) {
  const entries = [];

  function walk(currentDir) {
    const dirEntries = readdirSync(currentDir, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);

      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        entries.push(relativePath);
      }
    }
  }

  walk(rootDir);
  return entries;
}

function assertNoForbiddenPaths(rootDir) {
  for (const relativePath of listRelativeFiles(rootDir)) {
    const normalizedPath = relativePath.split(path.sep).join('/');
    const blockedPattern = denylistPatterns.find((pattern) =>
      pattern.test(normalizedPath),
    );
    if (blockedPattern) {
      throw new Error(
        `forbidden path in plugin zip staging: ${normalizedPath}`,
      );
    }
  }
}

function normalizeTimestamps(rootDir) {
  function walk(currentDir) {
    const dirEntries = readdirSync(currentDir, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      }

      utimesSync(absolutePath, fixedTimeSeconds, fixedTimeSeconds);
    }
  }

  walk(rootDir);
  utimesSync(rootDir, fixedTimeSeconds, fixedTimeSeconds);
}

function createChecksumFile(
  zipFile,
  checksumFile,
  checksumTargetName = path.basename(zipFile),
) {
  const hash = createHash('sha256');
  hash.update(readFileSync(zipFile));
  writeFileSync(checksumFile, `${hash.digest('hex')}  ${checksumTargetName}\n`);
}

function readManifestVersion() {
  const manifestPath = path.join(
    pluginSourceDir,
    '.codex-plugin',
    'plugin.json',
  );
  assertExists(manifestPath, `missing plugin manifest at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.version) {
    throw new Error(`plugin manifest at ${manifestPath} has no version field`);
  }
  return String(manifest.version).trim();
}

function assertManifestVersionMatches(resolvedVersion) {
  const manifestVersion = readManifestVersion();
  if (manifestVersion !== resolvedVersion) {
    throw new Error(
      `plugin manifest version (${manifestVersion}) does not match resolved release version (${resolvedVersion})`,
    );
  }
}

function writeMinimalPackageJson(version, targetFile) {
  writeFileSync(
    targetFile,
    `${JSON.stringify(
      {
        name: 'hokusai-codex-plugin-marketplace',
        version,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
}

function main() {
  const version = resolveVersion();
  assertExists(pluginSourceDir, 'plugin source directory missing');
  assertExists(
    bundleSourceFile,
    'bundle not found; run pnpm --filter @hokusai/adapter-codex bundle:plugin first',
  );
  assertManifestVersionMatches(version);

  mkdirSync(distZipDir, { recursive: true });

  const stagingParentDir = path.join(
    os.tmpdir(),
    'hokusai-codex-plugin-staging',
  );
  mkdirSync(stagingParentDir, { recursive: true });
  const archiveRootName = 'hokusai-codex-plugin';
  const stagingDir = path.join(
    stagingParentDir,
    `hokusai-codex-plugin-${process.pid}`,
  );
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  const archiveRootDir = path.join(stagingDir, archiveRootName);
  mkdirSync(archiveRootDir, { recursive: true });

  const stagedPluginDir = path.join(archiveRootDir, 'plugins', 'hokusai');
  cpSync(pluginSourceDir, stagedPluginDir, { recursive: true });
  mkdirSync(path.join(stagedPluginDir, 'dist'), { recursive: true });
  cpSync(bundleSourceFile, path.join(stagedPluginDir, 'dist', 'index.js'));
  cpSync(
    path.join(pluginSourceDir, 'README.md'),
    path.join(archiveRootDir, 'README.md'),
  );
  cpSync(
    path.join(pluginSourceDir, 'marketplace.json'),
    path.join(archiveRootDir, 'marketplace.json'),
  );
  writeMinimalPackageJson(version, path.join(archiveRootDir, 'package.json'));
  chmodSync(path.join(stagedPluginDir, 'bin', 'hokusai-codex-mcp'), 0o755);
  chmodSync(
    path.join(stagedPluginDir, 'bin', 'hokusai-codex-outcome-hook'),
    0o755,
  );

  assertExists(
    path.join(stagedPluginDir, '.codex-plugin', 'plugin.json'),
    'missing plugin manifest at plugins/hokusai/.codex-plugin/plugin.json',
  );
  assertExists(
    path.join(stagedPluginDir, '.mcp.json'),
    'missing plugin mcp config at plugins/hokusai/.mcp.json',
  );

  assertNoForbiddenPaths(archiveRootDir);
  normalizeTimestamps(archiveRootDir);
  utimesSync(stagingDir, fixedTimeSeconds, fixedTimeSeconds);

  const outputBaseName = `hokusai-codex-plugin-${version}`;
  const zipFile = path.join(distZipDir, `${outputBaseName}.zip`);
  const checksumFile = `${zipFile}.sha256`;
  const latestZipFile = path.join(
    distZipDir,
    'hokusai-codex-plugin-latest.zip',
  );
  const latestChecksumFile = `${latestZipFile}.sha256`;

  execFileSync('zip', ['-rX', '--filesync', zipFile, archiveRootName], {
    cwd: stagingDir,
    stdio: 'inherit',
  });

  createChecksumFile(zipFile, checksumFile);
  cpSync(zipFile, latestZipFile);
  createChecksumFile(
    latestZipFile,
    latestChecksumFile,
    path.basename(latestZipFile),
  );

  console.log(`Created ${zipFile}`);
  console.log(`Created ${checksumFile}`);
  console.log(`Created ${latestZipFile}`);
  console.log(`Created ${latestChecksumFile}`);
}

main();
