#!/usr/bin/env node
/**
 * Clean-consumer smoke test for `@hokusai/costs` (HOK-3073).
 *
 * Proves the acceptance criterion end to end: a clean consumer installs the
 * *shipped artifact* (packed tarballs by default, the published registry
 * package with `--registry <version>`) into a temp project outside the
 * workspace and runs every shipped example with the network hard-blocked and
 * `HOKUSAI_*` stripped from the environment.
 *
 * Steps:
 *   1. build + `pnpm pack` core and costs into a tmp dir;
 *   2. assert tarball hygiene (only package.json/README/dist/examples, no
 *      tests or test-support, < 500 KB, concrete @hokusai/core version);
 *   3. `npm install --offline` the tarballs into a fresh ESM consumer;
 *   4. run each example from node_modules with the no-network preload;
 *   5. assert the report JSON carries the acceptance keys;
 *   6. import every exports subpath and check its `.d.ts` exists;
 *   7. type-check a consumer.ts (quickstart + router-compat bridge with a
 *      local type stub) with the workspace TypeScript.
 *
 * Usage:
 *   node scripts/smoke-costs-consumer.mjs                # against packed tarballs
 *   node scripts/smoke-costs-consumer.mjs --registry 0.5.0   # against npm (post-publish)
 *   KEEP_SMOKE_DIR=1 ...                                 # keep the tmp dir for debugging
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardPath = path.join(repoRoot, 'scripts', 'no-network-guard.cjs');
const CHILD_TIMEOUT_MS = 120_000;
const MAX_TARBALL_BYTES = 500 * 1024;

const registryIndex = process.argv.indexOf('--registry');
const registryVersion = registryIndex === -1 ? null : process.argv[registryIndex + 1];
if (registryIndex !== -1 && !registryVersion) {
  fail('--registry requires a version, e.g. --registry 0.5.0');
}

function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}

/** Environment for consumer-side children: HOKUSAI_* stripped. */
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('HOKUSAI')) env[key] = value;
  }
  return env;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      timeout: CHILD_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stderr = error.stderr ? `\n--- stderr ---\n${error.stderr}` : '';
    const stdout = error.stdout ? `\n--- stdout ---\n${String(error.stdout).slice(0, 2000)}` : '';
    fail(`\`${command} ${args.join(' ')}\` failed: ${error.message}${stderr}${stdout}`);
  }
}

const workDir = mkdtempSync(path.join(tmpdir(), 'hokusai-costs-smoke-'));
const cleanup = () => {
  if (process.env.KEEP_SMOKE_DIR === '1') {
    console.log(`KEEP_SMOKE_DIR=1 — leaving ${workDir}`);
    return;
  }
  rmSync(workDir, { recursive: true, force: true });
};
process.on('exit', cleanup);

// ── 1. Build + pack (tarball mode only) ─────────────────────────────
const packDir = path.join(workDir, 'tarballs');
const consumerDir = path.join(workDir, 'consumer');
run('mkdir', ['-p', packDir, consumerDir]);

/** @type {string[]} install specs for npm */
let installSpecs;
if (registryVersion === null) {
  console.log('smoke: building @hokusai/core and @hokusai/costs…');
  run('pnpm', ['--filter', '@hokusai/core', 'build'], { cwd: repoRoot });
  run('pnpm', ['--filter', '@hokusai/costs', 'build'], { cwd: repoRoot });
  console.log('smoke: packing…');
  run('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: path.join(repoRoot, 'packages', 'core'),
  });
  run('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: path.join(repoRoot, 'packages', 'costs'),
  });
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
  const coreTgz = tarballs.find((name) => name.startsWith('hokusai-core-'));
  const costsTgz = tarballs.find((name) => name.startsWith('hokusai-costs-'));
  if (!coreTgz || !costsTgz) fail(`pack produced ${JSON.stringify(tarballs)}`);

  // ── 2. Tarball hygiene ────────────────────────────────────────────
  const costsTgzPath = path.join(packDir, costsTgz);
  const entries = run('tar', ['-tzf', costsTgzPath])
    .trim()
    .split('\n')
    .map((entry) => entry.replace(/^package\//, ''));
  const allowed = /^(package\.json$|README[^/]*$|dist\/|examples\/)/;
  const forbidden = /\.test\.|test-support|(^|\/)features\//;
  for (const entry of entries) {
    if (!allowed.test(entry)) fail(`unexpected tarball entry: ${entry}\n${entries.join('\n')}`);
    if (forbidden.test(entry)) fail(`forbidden tarball entry: ${entry}`);
  }
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'examples/task-cost-offline.mjs',
    'examples/fixtures/claude-code-session.jsonl',
  ]) {
    if (!entries.includes(required)) fail(`tarball is missing ${required}`);
  }
  const tarballBytes = statSync(costsTgzPath).size;
  if (tarballBytes > MAX_TARBALL_BYTES) {
    fail(`tarball is ${tarballBytes} bytes (> ${MAX_TARBALL_BYTES})`);
  }
  run('tar', ['-xzf', costsTgzPath, '-C', workDir, 'package/package.json']);
  const packedJson = JSON.parse(readFileSync(path.join(workDir, 'package', 'package.json'), 'utf8'));
  const coreDep = packedJson.dependencies?.['@hokusai/core'];
  if (!coreDep || coreDep.includes('workspace')) {
    fail(`packed @hokusai/core dependency is not concrete: ${String(coreDep)}`);
  }
  installSpecs = [path.join(packDir, coreTgz), costsTgzPath];
} else {
  console.log(`smoke: installing @hokusai/costs@${registryVersion} from the registry…`);
  installSpecs = [
    `@hokusai/core@${registryVersion}`,
    `@hokusai/costs@${registryVersion}`,
  ];
}

// ── 3. Clean consumer install (outside the workspace) ───────────────
writeFileSync(
  path.join(consumerDir, 'package.json'),
  JSON.stringify({ name: 'hokusai-costs-smoke-consumer', private: true, type: 'module' }, null, 2),
);
const installArgs = ['install', '--no-audit', '--no-fund', '--loglevel=error'];
// Tarball installs must not touch the network at all; a registry install is
// the one deliberately-online step of post-publish verification.
if (registryVersion === null) installArgs.push('--offline');
console.log('smoke: npm install in a clean consumer…');
run('npm', [...installArgs, ...installSpecs], { cwd: consumerDir, env: cleanEnv() });

const installedCosts = path.join(consumerDir, 'node_modules', '@hokusai', 'costs');
const installedJson = JSON.parse(readFileSync(path.join(installedCosts, 'package.json'), 'utf8'));

// ── 4 + 5. Run every shipped example with the network blocked ───────
const examplesDir = path.join(installedCosts, 'examples');
const examples = readdirSync(examplesDir).filter((name) => name.endsWith('.mjs'));
if (examples.length < 4) fail(`expected >= 4 shipped examples, found ${JSON.stringify(examples)}`);

const REPORT_KEYS = ['totalUsd', 'byModel', 'byHarness', 'usage', 'source', 'diagnostics'];
for (const example of examples.sort()) {
  console.log(`smoke: node --require no-network-guard examples/${example}`);
  const stdout = run('node', ['--require', guardPath, path.join(examplesDir, example)], {
    cwd: consumerDir,
    env: cleanEnv(),
  });
  if (example === 'fake-harness.mjs' || example === 'ledger-offline.mjs') continue;
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fail(`Example output is not valid JSON (${example}): ${stdout.slice(0, 500)}`);
  }
  for (const key of REPORT_KEYS) {
    if (!(key in report)) fail(`${example}: report is missing "${key}"`);
  }
  for (const key of ['revision', 'effectiveDate']) {
    if (!(key in report.pricing)) fail(`${example}: report.pricing is missing "${key}"`);
  }
  if (!('status' in report.coverage)) fail(`${example}: report.coverage is missing "status"`);
  if (example === 'task-cost-offline.mjs' && !(report.totalUsd > 0)) {
    fail(`two-line example totalUsd must be > 0, got ${String(report.totalUsd)}`);
  }
}

// ── 6. Every exports subpath resolves and ships types ────────────────
for (const [subpath, target] of Object.entries(installedJson.exports)) {
  const specifier = subpath === '.' ? '@hokusai/costs' : `@hokusai/costs/${subpath.slice(2)}`;
  console.log(`smoke: import('${specifier}')`);
  run(
    'node',
    ['--require', guardPath, '--input-type=module', '-e', `await import('${specifier}');`],
    { cwd: consumerDir, env: cleanEnv() },
  );
  const typesPath = path.join(installedCosts, target.types);
  if (!existsSync(typesPath)) fail(`missing type declarations for ${subpath}: ${target.types}`);
}

// ── 7. Type-check the quickstart + router-compat bridge ─────────────
writeFileSync(
  path.join(consumerDir, 'consumer.ts'),
  `import { createTaskCostTracker, measureTask, type TaskCostReport } from '@hokusai/costs';

// Local stub of the @hokusai/router surface this report bridges into, so the
// smoke test needs no router install (compatibility contract, HOK-3073).
interface RouteLike {
  reportOutcome(input: { status: 'succeeded' | 'failed'; actualCostUsd?: number }): Promise<unknown>;
}

export async function quickstart(route: RouteLike): Promise<TaskCostReport> {
  const tracker = createTaskCostTracker({ taskId: 'smoke-task' });
  tracker.recordUsage({ model: 'claude-sonnet-5', usage: { inputTokens: 1, outputTokens: 1 } });
  const { cost } = await measureTask({ taskId: 'smoke-task-2' }, () => 'done');
  // Bridge rule: a null (partial) total is passed as ABSENT, never as 0.
  await route.reportOutcome({
    status: 'succeeded',
    ...(cost.totalUsd !== null ? { actualCostUsd: cost.totalUsd } : {}),
  });
  return tracker.summary();
}
`,
);
writeFileSync(
  path.join(consumerDir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        strict: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['consumer.ts'],
    },
    null,
    2,
  ),
);
console.log('smoke: type-checking consumer.ts…');
run(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', consumerDir, '--pretty', 'false'], {
  cwd: consumerDir,
  env: cleanEnv(),
});

console.log('SMOKE OK');
