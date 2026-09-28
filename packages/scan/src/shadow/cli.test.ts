/**
 * Shadow CLI tests (REQ-F7): every failure exits 0 with a bare
 * `SHADOW_ERROR code=<CODE>` line, invalid arguments are rejected before any
 * write, corrupt state recovers, and a crash between the rows append and the
 * state write cannot produce duplicates.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runScanCli, type CliIo } from '../cli-core.js';
import { runShadowCli } from './cli.js';
import { createFixtureRepo, type FixtureRepo } from './test-fixture.js';

const NOW_EPOCH = 1_760_000_000;
const now = (): Date => new Date(NOW_EPOCH * 1000);
const DAY = 86400;

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) {
    try {
      chmodSync(dir, 0o755);
    } catch {
      // already writable or gone
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

function fixture(): FixtureRepo {
  const repo = createFixtureRepo(NOW_EPOCH - 100 * DAY);
  cleanups.push(repo.dir);
  repo.addMerges([
    { prNumber: 1, epoch: NOW_EPOCH - 3 * DAY },
    { prNumber: 2, epoch: NOW_EPOCH - 2 * DAY },
  ]);
  return repo;
}

function run(command: string, args: string[], cwd: string): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  const { exitCode } = runShadowCli(command, args, { log: (l) => lines.push(l), cwd, now });
  return { lines, exitCode };
}

function expectShadowError(result: { lines: string[]; exitCode: number }, code: string): void {
  expect(result.exitCode).toBe(0);
  expect(result.lines).toEqual([`SHADOW_ERROR code=${code}`]);
  // Fail-silent: no stack traces, no absolute paths.
  expect(result.lines.join('')).not.toMatch(/\/|\\| at /);
}

describe('shadow CLI failures exit 0 (REQ-F7)', () => {
  it('rejects invalid arguments before any write', () => {
    const repo = fixture();
    const dataDir = join(tempDir('hokusai-shadow-cli-'), 'data');
    const cases: string[][] = [
      ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--threshold', '1.5'],
      ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--github-repo', 'notaslug'],
      ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--horizon-days', '-1'],
      ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--max-prs', '0'],
      ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--unknown-flag', 'x'],
      ['--integration-branch', 'auto/integration'], // missing --data-dir
      ['--data-dir', dataDir], // missing --integration-branch
    ];
    for (const args of cases) {
      expectShadowError(run('shadow-score', [...args, '--repo', repo.dir], repo.dir), 'INVALID_ARG');
      expect(existsSync(dataDir)).toBe(false); // nothing written
    }
  });

  it('an unknown shadow subcommand is INVALID_ARG', () => {
    const repo = fixture();
    expectShadowError(run('shadow-nonsense', [], repo.dir), 'INVALID_ARG');
  });

  it('a non-git directory is NOT_A_GIT_REPO', () => {
    const notARepo = tempDir('hokusai-shadow-notgit-');
    const dataDir = join(notARepo, 'data');
    const result = run(
      'shadow-score',
      ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--repo', notARepo, '--github-repo', 'o/r'],
      notARepo,
    );
    expectShadowError(result, 'NOT_A_GIT_REPO');
    expect(existsSync(dataDir)).toBe(false);
  });

  it('a read-only data dir is DATA_DIR_UNWRITABLE', () => {
    const repo = fixture();
    const readOnly = tempDir('hokusai-shadow-ro-');
    chmodSync(readOnly, 0o500);
    if (process.getuid && process.getuid() === 0) return; // root ignores modes
    const result = run(
      'shadow-score',
      [
        '--data-dir', join(readOnly, 'data'),
        '--integration-branch', 'auto/integration',
        '--repo', repo.dir,
        '--github-repo', 'o/r',
      ],
      repo.dir,
    );
    expectShadowError(result, 'DATA_DIR_UNWRITABLE');
  });

  it('corrupt state.json proceeds from bootstrap and records STATE_CORRUPT', () => {
    const repo = fixture();
    const dataDir = tempDir('hokusai-shadow-corrupt-');
    writeFileSync(join(dataDir, 'state.json'), '{bad json');

    const result = run(
      'shadow-score',
      [
        '--data-dir', dataDir,
        '--integration-branch', 'auto/integration',
        '--repo', repo.dir,
        '--github-repo', 'o/r',
      ],
      repo.dir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines.at(-1)).toMatch(/^SHADOW_OK scored=2 /);
    const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf-8')) as {
      last_error_code: string;
    };
    expect(state.last_error_code).toBe('STATE_CORRUPT');
  });

  it('a crash between the rows append and the state write causes no duplicates', () => {
    const repo = fixture();
    const dataDir = tempDir('hokusai-shadow-crash-');
    const args = [
      '--data-dir', dataDir,
      '--integration-branch', 'auto/integration',
      '--repo', repo.dir,
      '--github-repo', 'o/r',
    ];

    // First run writes rows; simulate the crash by deleting state.json
    // (the cursor never landed).
    expect(run('shadow-score', args, repo.dir).lines.at(-1)).toMatch(/^SHADOW_OK scored=2 /);
    rmSync(join(dataDir, 'state.json'));

    const rerun = run('shadow-score', args, repo.dir);
    expect(rerun.lines.at(-1)).toMatch(/^SHADOW_OK scored=0 /);
    const rows = readFileSync(join(dataDir, 'scores.jsonl'), 'utf-8').split('\n').filter(Boolean);
    expect(rows).toHaveLength(2);
  });

  it('shadow-backfill and shadow-report also run end-to-end via the CLI', () => {
    const repo = fixture();
    const dataDir = tempDir('hokusai-shadow-e2e-');
    const common = ['--data-dir', dataDir, '--integration-branch', 'auto/integration', '--repo', repo.dir, '--github-repo', 'o/r'];

    expect(run('shadow-score', common, repo.dir).lines.at(-1)).toMatch(/^SHADOW_OK scored=2 /);
    // Nothing matured yet with the real wall clock (merges are ~2-3 days old).
    const backfill = run('shadow-backfill', [...common, '--horizon-days', '30'], repo.dir);
    expect(backfill.lines.at(-1)).toMatch(/^SHADOW_OK labelled=0 pending=2 /);

    const report = run('shadow-report', ['--data-dir', dataDir], repo.dir);
    expect(report.exitCode).toBe(0);
    const parsed = JSON.parse(report.lines.join('\n')) as { repos: Array<{ n_scored: number }> };
    expect(parsed.repos[0]?.n_scored).toBe(2);
    expect(readdirSync(join(dataDir, 'reports'))).toHaveLength(1);
  });
});

describe('cli-core routing', () => {
  it('runScanCli routes shadow commands and exits 0 on their failures', () => {
    let stdout = '';
    const io: CliIo = {
      writeStdout: (text) => {
        stdout += text;
      },
      writeStderr: () => {},
      env: {},
    };
    const result = runScanCli(['shadow-score', '--threshold', 'nonsense'], io);
    expect(result.exitCode).toBe(0);
    expect(stdout).toBe('SHADOW_ERROR code=INVALID_ARG\n');
  });

  it('the built CLI binary exits 0 in shadow mode (subprocess)', () => {
    const cliDist = join(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js');
    if (!existsSync(cliDist)) return; // CI builds before testing
    const notARepo = tempDir('hokusai-shadow-bin-');
    mkdirSync(join(notARepo, 'data'));
    const stdout = execFileSync(
      process.execPath,
      [cliDist, 'shadow-score', '--data-dir', join(notARepo, 'data'), '--integration-branch', 'auto/integration', '--repo', notARepo],
      { cwd: notARepo },
    ).toString();
    expect(stdout.trim()).toBe('SHADOW_ERROR code=NOT_A_GIT_REPO');
  });

  it('the Action bundle in shadow mode exits 0 and writes no outputs or summary', () => {
    const actionBundle = join(dirname(fileURLToPath(import.meta.url)), '../../action/dist/index.js');
    if (!existsSync(actionBundle)) return; // CI builds before testing
    const repo = fixture();
    const workDir = tempDir('hokusai-shadow-action-');
    const dataDir = join(workDir, 'data');
    const githubOutput = join(workDir, 'github-output.txt');
    const githubSummary = join(workDir, 'github-summary.md');
    writeFileSync(githubOutput, '');
    writeFileSync(githubSummary, '');

    const stdout = execFileSync(process.execPath, [actionBundle], {
      cwd: repo.dir,
      env: {
        ...process.env,
        INPUT_MODE: 'shadow-score',
        'INPUT_DATA-DIR': dataDir,
        'INPUT_INTEGRATION-BRANCH': 'auto/integration',
        'INPUT_GITHUB-REPO': 'o/r',
        'INPUT_REPO-PATH': repo.dir,
        // The subprocess runs on the wall clock; widen the bootstrap window
        // so the fixture's pinned commit dates stay inside it.
        'INPUT_BOOTSTRAP-DAYS': '36500',
        GITHUB_OUTPUT: githubOutput,
        GITHUB_STEP_SUMMARY: githubSummary,
      },
    }).toString();

    // 3 = the two fixture merges plus the initial commit (wide window).
    expect(stdout).toMatch(/SHADOW_OK scored=3 /);
    // Never visible: the Action wrote neither outputs nor a step summary.
    expect(readFileSync(githubOutput, 'utf-8')).toBe('');
    expect(readFileSync(githubSummary, 'utf-8')).toBe('');
  });
});
