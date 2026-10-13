// Consumer smoke test for the @hokusai/costs release (HOK-3073, REQ-F9):
//
//   1. build @hokusai/core + @hokusai/costs,
//   2. `pnpm pack` both into a temp dir,
//   3. install the tarballs into a fresh ESM consumer project,
//   4. run the packaged offline example under the no-network guard with
//      HOKUSAI_API_KEY removed from the environment,
//   5. assert the printed TaskCostReport (totalUsd > 0, complete coverage),
//   6. assert tarball hygiene (no test files, < 500 KB).
//
// Prints `SMOKE OK` and exits 0 on success; exits non-zero with a clear
// message on any failure. Set KEEP_SMOKE_DIR=1 to keep the temp dir.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD_TIMEOUT_MS = 120_000;
const MAX_TARBALL_BYTES = 500 * 1024;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guardPath = join(repoRoot, 'scripts', 'no-network-guard.cjs');

function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: CHILD_TIMEOUT_MS,
    encoding: 'utf8',
    ...options,
  });
}

const workDir = mkdtempSync(join(tmpdir(), 'hokusai-costs-smoke-'));
let keepDir = process.env.KEEP_SMOKE_DIR === '1';
try {
  console.log('smoke: building @hokusai/core and @hokusai/costs …');
  run('pnpm', ['--filter', '@hokusai/core', 'build'], { cwd: repoRoot });
  run('pnpm', ['--filter', '@hokusai/costs', 'build'], { cwd: repoRoot });

  console.log('smoke: packing tarballs …');
  const packDir = join(workDir, 'tarballs');
  for (const pkg of ['core', 'costs']) {
    run('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: join(repoRoot, 'packages', pkg),
    });
  }
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
  const coreTarball = tarballs.find((name) => name.startsWith('hokusai-core-'));
  const costsTarball = tarballs.find((name) =>
    name.startsWith('hokusai-costs-'),
  );
  if (!coreTarball || !costsTarball) {
    fail(
      `expected core+costs tarballs in ${packDir}, found: ${tarballs.join(', ')}`,
    );
  }

  // Tarball hygiene (release NFRs): no test files or test support, no
  // oversized payload.
  const costsTarballPath = join(packDir, costsTarball);
  const entries = run('tar', ['-tzf', costsTarballPath]).split('\n');
  const leaked = entries.filter(
    (entry) =>
      /\.test\.(ts|js|d\.ts)/.test(entry) || entry.includes('test-support'),
  );
  if (leaked.length > 0) {
    fail(`costs tarball ships test files:\n${leaked.join('\n')}`);
  }
  if (
    !entries.some((entry) => entry.endsWith('examples/task-cost-offline.mjs'))
  ) {
    fail('costs tarball is missing examples/task-cost-offline.mjs');
  }
  if (
    !entries.some((entry) =>
      entry.endsWith('examples/fixtures/claude-code-session.jsonl'),
    )
  ) {
    fail(
      'costs tarball is missing examples/fixtures/claude-code-session.jsonl',
    );
  }
  if (!entries.some((entry) => entry.endsWith('README.md'))) {
    fail('costs tarball is missing README.md');
  }
  const tarballBytes = statSync(costsTarballPath).size;
  if (tarballBytes > MAX_TARBALL_BYTES) {
    fail(`costs tarball is ${tarballBytes} bytes (limit ${MAX_TARBALL_BYTES})`);
  }

  console.log('smoke: installing tarballs into a fresh consumer …');
  const consumerDir = join(workDir, 'consumer');
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      { name: 'costs-smoke-consumer', private: true, type: 'module' },
      null,
      2,
    ),
  );
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      join(packDir, coreTarball),
      join(packDir, costsTarball),
    ],
    { cwd: consumerDir },
  );

  console.log('smoke: copying the packaged example out of node_modules …');
  const installedExamples = join(
    consumerDir,
    'node_modules',
    '@hokusai',
    'costs',
    'examples',
  );
  cpSync(
    join(installedExamples, 'task-cost-offline.mjs'),
    join(consumerDir, 'task-cost-offline.mjs'),
  );
  cpSync(join(installedExamples, 'fixtures'), join(consumerDir, 'fixtures'), {
    recursive: true,
  });

  console.log(
    'smoke: running the offline example under the no-network guard …',
  );
  const childEnv = { ...process.env };
  delete childEnv.HOKUSAI_API_KEY;
  const stdout = run(
    'node',
    ['--require', guardPath, 'task-cost-offline.mjs'],
    { cwd: consumerDir, env: childEnv },
  );

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fail(`example output is not JSON:\n${stdout}`);
  }
  if (typeof report.totalUsd !== 'number' || !(report.totalUsd > 0)) {
    fail(`expected totalUsd > 0, got ${JSON.stringify(report.totalUsd)}`);
  }
  for (const key of [
    'taskId',
    'byModel',
    'byHarness',
    'usage',
    'source',
    'pricing',
    'coverage',
    'diagnostics',
  ]) {
    if (!(key in report)) fail(`report is missing "${key}"`);
  }
  if (report.coverage.status !== 'complete') {
    fail(
      `expected coverage.status "complete", got "${report.coverage.status}"`,
    );
  }
  if (report.pricing.currency !== 'USD') {
    fail(`expected pricing.currency "USD", got "${report.pricing.currency}"`);
  }
  if (JSON.stringify(report).includes('HOKUSAI_API_KEY')) {
    fail('report mentions HOKUSAI_API_KEY');
  }

  console.log(
    `smoke: report totalUsd=${report.totalUsd} coverage=${report.coverage.status} tarball=${tarballBytes}B`,
  );
  console.log('SMOKE OK');
} catch (error) {
  keepDir = true;
  console.error(`SMOKE FAILED (dir kept at ${workDir}):`);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (!keepDir) rmSync(workDir, { recursive: true, force: true });
  else console.error(`smoke: temp dir kept at ${workDir}`);
}
