#!/usr/bin/env node
/**
 * Propagate package versions into the files `changeset version` cannot reach.
 *
 * Changesets only rewrites `package.json`. Four other files carry a version and
 * silently drifted from it:
 *
 *   - the two plugin manifests, which the release build asserts against the tag
 *     (a stale manifest aborts the release *after* lint/build/test pass)
 *   - the marketplace entry, which nothing asserts, so a stale version ships
 *   - `SDK_VERSION`, stamped on every request and on every contribution row as
 *     `integration_version` — a stale value mislabels the data we train on
 *
 * Run with `--check` to fail instead of writing. CI runs that on every PR so
 * drift is caught on the PR that causes it, not at the tag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const readJson = (file) => JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));
const packageVersion = (pkg) => readJson(`packages/${pkg}/package.json`).version;

const CORE = packageVersion('core');
const CLAUDE = packageVersion('adapter-claude-code');
const CODEX = packageVersion('adapter-codex');

/** Each target: the file, the version it must carry, and how to read/write it. */
const targets = [
  {
    file: 'packages/adapter-claude-code/plugin/.claude-plugin/plugin.json',
    expected: CLAUDE,
    read: (json) => json.version,
    write: (json, version) => ({ ...json, version }),
  },
  {
    file: 'packages/adapter-codex/plugin/.codex-plugin/plugin.json',
    expected: CODEX,
    read: (json) => json.version,
    write: (json, version) => ({ ...json, version }),
  },
  {
    file: '.claude-plugin/marketplace.json',
    expected: CLAUDE,
    read: (json) => json.plugins?.[0]?.version,
    write: (json, version) => ({
      ...json,
      plugins: json.plugins.map((plugin) => ({ ...plugin, version })),
    }),
  },
];

const drift = [];

for (const target of targets) {
  const json = readJson(target.file);
  const actual = target.read(json);
  if (actual === target.expected) {
    continue;
  }

  drift.push(`${target.file}: ${actual} → ${target.expected}`);
  if (!checkOnly) {
    writeFileSync(
      path.join(repoRoot, target.file),
      `${JSON.stringify(target.write(json, target.expected), null, 2)}\n`,
    );
  }
}

// SDK_VERSION lives in source, not JSON.
const clientFile = 'packages/core/src/client.ts';
const clientPath = path.join(repoRoot, clientFile);
const client = readFileSync(clientPath, 'utf8');
const sdkVersionPattern = /(export const SDK_VERSION = ')([^']+)(';)/;
const match = sdkVersionPattern.exec(client);

if (!match) {
  console.error(`could not find SDK_VERSION in ${clientFile}`);
  process.exit(1);
}

if (match[2] !== CORE) {
  drift.push(`${clientFile}: SDK_VERSION ${match[2]} → ${CORE}`);
  if (!checkOnly) {
    writeFileSync(
      clientPath,
      client.replace(sdkVersionPattern, `$1${CORE}$3`),
    );
  }
}

if (drift.length === 0) {
  console.log('Versions are in sync.');
  process.exit(0);
}

if (checkOnly) {
  console.error('Version drift detected:\n');
  for (const entry of drift) {
    console.error(`  ${entry}`);
  }
  console.error(
    '\nRun `pnpm sync:versions` and commit the result. A stale plugin manifest' +
      '\naborts the release at tag time; a stale SDK_VERSION mislabels every' +
      '\ncontribution row.',
  );
  process.exit(1);
}

console.log('Synced:\n');
for (const entry of drift) {
  console.log(`  ${entry}`);
}
