import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const zipFile = path.join(
  repoRoot,
  'dist-zip',
  'hokusai-claude-code-plugin-latest.zip',
);
const codexManifestPath = path.join(
  repoRoot,
  'packages',
  'adapter-codex',
  'plugin',
  '.codex-plugin',
  'plugin.json',
);
const expectedRootName = 'hokusai-claude-code-plugin';
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
    return false;
  }

  pass(message);
  return true;
}

function assertFileExists(filePath, description) {
  return assert(
    existsSync(filePath),
    `${description}: ${path.relative(repoRoot, filePath)}`,
  );
}

function assertNonEmptyFile(filePath, description) {
  if (!assertFileExists(filePath, description)) {
    return false;
  }

  try {
    const size = statSync(filePath).size;
    return assert(
      size > 0,
      `${description} is non-empty: ${path.relative(repoRoot, filePath)}`,
    );
  } catch (error) {
    fail(`${description} stat failed: ${formatError(error)}`);
    return false;
  }
}

function assertExecutableFile(filePath, description) {
  if (!assertNonEmptyFile(filePath, description)) {
    return false;
  }

  try {
    const mode = statSync(filePath).mode & 0o111;
    return assert(
      mode !== 0,
      `${description} is executable: ${path.relative(repoRoot, filePath)}`,
    );
  } catch (error) {
    fail(`${description} stat failed: ${formatError(error)}`);
    return false;
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertZipToolAvailable() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    pass('unzip is available');
  } catch (error) {
    fail(`unzip is required for smoke testing: ${formatError(error)}`);
  }
}

function readJson(filePath, description) {
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'));
    pass(`${description} parses as JSON: ${path.relative(repoRoot, filePath)}`);
    return value;
  } catch (error) {
    fail(
      `${description} parse failed at ${path.relative(repoRoot, filePath)}: ${formatError(error)}`,
    );
    return undefined;
  }
}

function extractFrontmatter(markdown, filePath) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) {
    fail(`command frontmatter missing: ${path.relative(repoRoot, filePath)}`);
    return '';
  }

  pass(`command frontmatter present: ${path.relative(repoRoot, filePath)}`);
  return match[1];
}

function normalizeManifestHookEntries(hooks) {
  if (typeof hooks === 'string') {
    return [hooks];
  }

  if (Array.isArray(hooks)) {
    return hooks.filter((entry) => typeof entry === 'string');
  }

  return [];
}

function normalizeManifestHookPath(hookPath) {
  return hookPath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function assertManifest(manifestPath) {
  const manifest = readJson(manifestPath, 'plugin manifest');
  if (!manifest) {
    return;
  }

  for (const field of ['name', 'version', 'description', 'homepage']) {
    assert(
      typeof manifest[field] === 'string' && manifest[field].trim().length > 0,
      `plugin manifest has ${field}`,
    );
  }

  const hookEntries = normalizeManifestHookEntries(manifest.hooks);
  assert(
    hookEntries.every(
      (entry) => normalizeManifestHookPath(entry) !== 'hooks/hooks.json',
    ),
    'plugin manifest must not reference auto-loaded hooks/hooks.json',
  );
}

function assertCodexManifestAudit() {
  const manifest = readJson(codexManifestPath, 'Codex plugin manifest');
  if (!manifest) {
    return;
  }

  const hookEntries = normalizeManifestHookEntries(manifest.hooks).map(
    normalizeManifestHookPath,
  );
  assert(
    hookEntries.includes('hooks/hooks.json'),
    'Codex plugin manifest intentionally references hooks/hooks.json',
  );
}

function assertCommandMarkdown(commandPath) {
  if (!assertNonEmptyFile(commandPath, 'command file exists')) {
    return;
  }

  const markdown = readFileSync(commandPath, 'utf8');
  const frontmatter = extractFrontmatter(markdown, commandPath);
  if (!frontmatter) {
    return;
  }

  assert(
    /(^|\n)description:\s*\S/.test(frontmatter),
    `command frontmatter has description: ${path.basename(commandPath)}`,
  );
}

function assertNoImportFailure(output, name) {
  assert(
    !/Cannot find module|ERR_MODULE_NOT_FOUND|SyntaxError/i.test(output),
    `${name} loaded without import or syntax failure`,
  );
}

function runCommand(commandPath, args, options = {}) {
  const result = spawnSync(commandPath, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
  });

  if (result.error) {
    fail(
      `${path.basename(commandPath)} failed to launch: ${formatError(result.error)}`,
    );
    return undefined;
  }

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function assertOfflineCommands(extractedRoot) {
  const configDir = path.join(extractedRoot, '.smoke-config');
  const env = {
    ...process.env,
    HOKUSAI_API_KEY: 'hk_live_smoke',
    HOKUSAI_ROUTING_CONSENT: '',
    HOKUSAI_OUTCOME_OPT_IN: '',
    HOKUSAI_CONFIG_DIR: configDir,
  };
  const binDir = path.join(extractedRoot, 'plugin', 'bin');

  const routeResult = runCommand(
    path.join(binDir, 'hokusai-route'),
    ['--task', 'smoke test', '--config', configDir],
    { cwd: extractedRoot, env },
  );
  if (routeResult) {
    assert(
      routeResult.status === 3,
      'hokusai-route exits with consent-required code',
    );
    assert(
      routeResult.stderr.includes('HOKUSAI_ROUTING_CONSENT'),
      'hokusai-route prints routing consent guidance',
    );
    assertNoImportFailure(
      `${routeResult.stdout}\n${routeResult.stderr}`,
      'hokusai-route',
    );
  }

  const reportResult = runCommand(
    path.join(binDir, 'hokusai-report'),
    [
      '--preview',
      '--correlation-id',
      'c1',
      '--recommended-model',
      'claude-sonnet-4-6',
      '--actual-model',
      'claude-sonnet-4-6',
      '--accepted',
      '--status',
      'succeeded',
      '--config',
      configDir,
    ],
    { cwd: extractedRoot, env },
  );
  if (reportResult) {
    assert(
      reportResult.status === 3,
      'hokusai-report exits with consent-required code',
    );
    assert(
      reportResult.stderr.includes('HOKUSAI_OUTCOME_OPT_IN'),
      'hokusai-report prints outcome opt-in guidance',
    );
    assertNoImportFailure(
      `${reportResult.stdout}\n${reportResult.stderr}`,
      'hokusai-report',
    );
  }

  const privacyResult = runCommand(
    path.join(binDir, 'hokusai-privacy'),
    ['list', '--config', configDir],
    { cwd: extractedRoot, env },
  );
  if (privacyResult) {
    assert(privacyResult.status === 0, 'hokusai-privacy exits successfully');
    assert(
      privacyResult.stdout.includes('No records found'),
      'hokusai-privacy prints empty-state output',
    );
    assertNoImportFailure(
      `${privacyResult.stdout}\n${privacyResult.stderr}`,
      'hokusai-privacy',
    );
  }

  const doctorResult = runCommand(
    path.join(binDir, 'hokusai-doctor'),
    ['--config', configDir],
    { cwd: extractedRoot, env },
  );
  if (doctorResult) {
    assert(doctorResult.status === 1, 'hokusai-doctor exits with failed checks');
    assert(
      doctorResult.stdout.includes('Hokusai doctor'),
      'hokusai-doctor prints doctor header',
    );
    assert(
      doctorResult.stdout.includes('routing-consent'),
      'hokusai-doctor reports routing consent status',
    );
    assert(
      doctorResult.stdout.includes('api-reachability'),
      'hokusai-doctor reports API reachability status',
    );
    assertNoImportFailure(
      `${doctorResult.stdout}\n${doctorResult.stderr}`,
      'hokusai-doctor',
    );
  }

  const missingConfigValueResult = runCommand(
    path.join(binDir, 'hokusai-doctor'),
    ['--config'],
    { cwd: extractedRoot, env },
  );
  if (missingConfigValueResult) {
    assert(
      missingConfigValueResult.status === 2,
      'hokusai-doctor rejects missing --config values',
    );
    assert(
      missingConfigValueResult.stderr.includes('Usage: hokusai-doctor'),
      'hokusai-doctor prints usage for missing --config values',
    );
  }

  const unknownArgResult = runCommand(
    path.join(binDir, 'hokusai-doctor'),
    ['--unknown'],
    { cwd: extractedRoot, env },
  );
  if (unknownArgResult) {
    assert(
      unknownArgResult.status === 2,
      'hokusai-doctor rejects unknown arguments',
    );
    assert(
      unknownArgResult.stderr.includes('Usage: hokusai-doctor'),
      'hokusai-doctor prints usage for unknown arguments',
    );
  }
}

function assertLiveRouteCommand(extractedRoot) {
  if (!process.argv.includes('--live')) {
    return;
  }

  const apiKey = process.env.HOKUSAI_API_KEY?.trim();
  if (!apiKey) {
    fail('live smoke requested with --live but HOKUSAI_API_KEY is not set');
    return;
  }

  const configDir = path.join(extractedRoot, '.smoke-config-live');
  const env = {
    ...process.env,
    HOKUSAI_API_KEY: apiKey,
    HOKUSAI_ROUTING_CONSENT: process.env.HOKUSAI_ROUTING_CONSENT ?? 'true',
    HOKUSAI_CONFIG_DIR: configDir,
  };

  const routeResult = runCommand(
    path.join(extractedRoot, 'plugin', 'bin', 'hokusai-route'),
    ['--json', '--task', 'CI smoke test routing recommendation'],
    { cwd: extractedRoot, env },
  );

  if (!routeResult) {
    return;
  }

  assert(routeResult.status === 0, 'live hokusai-route exits successfully');
  assertNoImportFailure(
    `${routeResult.stdout}\n${routeResult.stderr}`,
    'live hokusai-route',
  );

  try {
    const payload = JSON.parse(routeResult.stdout);
    assert(
      typeof payload.model === 'string' && payload.model.length > 0,
      'live hokusai-route returns a model id',
    );
    assert(
      typeof payload.correlationId === 'string' &&
        payload.correlationId.length > 0,
      'live hokusai-route returns a correlation id',
    );
  } catch (error) {
    fail(`live hokusai-route returned invalid JSON: ${formatError(error)}`);
  }
}

function main() {
  assertZipToolAvailable();
  assertCodexManifestAudit();

  if (!assertNonEmptyFile(zipFile, 'plugin zip exists')) {
    return finish();
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'hokusai-plugin-smoke-'));
  const extractDir = path.join(tempDir, 'unzipped');

  try {
    execFileSync('unzip', ['-q', zipFile, '-d', extractDir], {
      stdio: 'inherit',
    });
    pass(`zip extracted: ${path.relative(repoRoot, zipFile)}`);

    const extractedRoot = path.join(extractDir, expectedRootName);
    assert(
      existsSync(extractedRoot),
      `archive root exists: ${expectedRootName}`,
    );

    const manifestPath = path.join(
      extractedRoot,
      'plugin',
      '.claude-plugin',
      'plugin.json',
    );
    const routeCommandPath = path.join(
      extractedRoot,
      'plugin',
      'commands',
      'route.md',
    );
    const reportCommandPath = path.join(
      extractedRoot,
      'plugin',
      'commands',
      'report.md',
    );
    const privacyCommandPath = path.join(
      extractedRoot,
      'plugin',
      'commands',
      'privacy.md',
    );
    const doctorCommandPath = path.join(
      extractedRoot,
      'plugin',
      'commands',
      'doctor.md',
    );
    const routeBinPath = path.join(
      extractedRoot,
      'plugin',
      'bin',
      'hokusai-route',
    );
    const reportBinPath = path.join(
      extractedRoot,
      'plugin',
      'bin',
      'hokusai-report',
    );
    const privacyBinPath = path.join(
      extractedRoot,
      'plugin',
      'bin',
      'hokusai-privacy',
    );
    const doctorBinPath = path.join(
      extractedRoot,
      'plugin',
      'bin',
      'hokusai-doctor',
    );
    const bundlePath = path.join(extractedRoot, 'dist', 'index.js');
    const readmePath = path.join(extractedRoot, 'README.md');
    const packageJsonPath = path.join(extractedRoot, 'package.json');

    assertManifest(manifestPath);
    assertCommandMarkdown(routeCommandPath);
    assertCommandMarkdown(reportCommandPath);
    assertCommandMarkdown(privacyCommandPath);
    assertCommandMarkdown(doctorCommandPath);
    assertNonEmptyFile(routeBinPath, 'route bin exists');
    assertNonEmptyFile(reportBinPath, 'report bin exists');
    assertNonEmptyFile(privacyBinPath, 'privacy bin exists');
    assertExecutableFile(doctorBinPath, 'doctor bin exists');
    assertNonEmptyFile(bundlePath, 'bundled dist/index.js exists');
    assertNonEmptyFile(readmePath, 'README exists');
    assertNonEmptyFile(packageJsonPath, 'package.json exists');

    assertOfflineCommands(extractedRoot);
    assertLiveRouteCommand(extractedRoot);
  } catch (error) {
    fail(`smoke test crashed: ${formatError(error)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  finish();
}

function finish() {
  if (failures.length > 0) {
    console.error(
      `\nPlugin smoke test failed with ${failures.length} issue(s).`,
    );
    process.exit(1);
  }

  console.log('\nPlugin smoke test passed.');
}

main();
