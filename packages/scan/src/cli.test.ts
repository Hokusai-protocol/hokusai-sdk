/**
 * CLI behaviour tests (REQ-F3, REQ-F7):
 *
 * 1. In-process `runScanCli` coverage of the exit-code contract, output
 *    routing, and stderr discipline.
 * 2. The scrubbed-environment subprocess parity test: the BUILT CLI runs in
 *    a sanitized environment (fresh HOME, no git config, minimal PATH, none
 *    of the GH_, WAVEMILL_, HOKUSAI_ or GITHUB_ variables, cwd outside any
 *    repo, planted legacy config that must be ignored) and must still
 *    produce the golden bytes on stdout. Skipped with a message when dist/
 *    has not been built (CI builds before testing).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EXIT_INVALID_INPUT,
  EXIT_OK,
  EXIT_UPSTREAM,
  runScanCli,
  type CliIo,
} from './cli-core.js';
import { classifyUpstreamFailure } from './default-deps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, '../../../fixtures/arbiter/scan');
const CLI_DIST = join(__dirname, '../dist/cli.js');
const ACTION_BUNDLE = join(__dirname, '../action/dist/index.js');

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

interface CliCapture {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[], env: Record<string, string | undefined> = {}): CliCapture {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
    env,
  };
  const result = runScanCli(argv, io);
  return { exitCode: result.exitCode, stdout, stderr };
}

interface GoldenInputs {
  github_repo: string;
  integration_branch: string;
  checkout_ref: string;
  pr_number: number;
  base_ref: string;
  as_of: string;
}

function readInputs(caseName: string): GoldenInputs {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, caseName, 'inputs.json'), 'utf-8'),
  ) as GoldenInputs;
}

function restoreFixture(caseName: string): { repoDir: string; inputs: GoldenInputs } {
  const inputs = readInputs(caseName);
  const repoDir = tempDir(`scan-cli-${caseName}-`);
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' });
  git(['init', '-q', '-b', '_restore']);
  git(['fetch', '-q', join(FIXTURES_ROOT, caseName, 'repo.bundle'), 'refs/heads/*:refs/heads/*']);
  git(['checkout', '-q', inputs.checkout_ref]);
  return { repoDir, inputs };
}

function expectPrefixedStderr(stderr: string): void {
  for (const line of stderr.split('\n')) {
    if (!line) continue;
    expect(line, `unprefixed stderr line: ${line}`).toMatch(/^(info|warn|error): /);
  }
}

// ── Exit-code contract (in-process) ────────────────────────────────────────

describe('hokusai-scan exit codes (invalid input → 2)', () => {
  it('rejects a missing subcommand with usage', () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('usage: hokusai-scan');
  });

  it('rejects an unknown subcommand', () => {
    const result = runCli(['banana']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: unknown subcommand banana');
  });

  it('rejects an unknown flag via parseArgs strict mode', () => {
    const result = runCli(['extract', '--repo', '.', '--pr', '1', '--frobnicate']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toMatch(/^error: /);
  });

  it('requires --pr for extract', () => {
    const { repoDir } = restoreFixture('case-01-simple-merge');
    const result = runCli(['extract', '--repo', repoDir]);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: --pr is required');
  });

  it('rejects --pr 0', () => {
    const { repoDir } = restoreFixture('case-01-simple-merge');
    const result = runCli(['extract', '--repo', repoDir, '--pr', '0']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: --pr must be a positive integer');
  });

  it('rejects --github-repo without a slash', () => {
    const { repoDir } = restoreFixture('case-01-simple-merge');
    const result = runCli([
      'label', '--repo', repoDir, '--integration-branch', 'integ', '--github-repo', 'noslash',
    ]);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: --github-repo must be in owner/name form');
  });

  it('rejects a nonexistent --repo path', () => {
    const result = runCli(['extract', '--repo', '/definitely/not/a/path', '--pr', '1']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: --repo path does not exist');
  });

  it('rejects a --repo that is not a git working tree', () => {
    const dir = tempDir('scan-cli-notgit-');
    const result = runCli(['extract', '--repo', dir, '--pr', '1']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: --repo is not a git working tree');
  });

  it('rejects a shallow clone with a fetch-depth hint', () => {
    const { repoDir } = restoreFixture('case-01-simple-merge');
    const shallowDir = join(tempDir('scan-cli-shallow-'), 'clone');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repoDir}`, shallowDir], {
      stdio: 'pipe',
    });
    const result = runCli(['extract', '--repo', shallowDir, '--pr', '1']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain(
      'error: repository is a shallow clone; checkout with fetch-depth: 0',
    );
  });

  it('rejects --integration-branch main', () => {
    const { repoDir } = restoreFixture('case-01-simple-merge');
    const result = runCli(['label', '--repo', repoDir, '--integration-branch', 'main']);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: integration branch main is rejected (v1.0.0 contract)');
  });

  it('rejects a malformed --as-of', () => {
    const { repoDir } = restoreFixture('case-01-simple-merge');
    const result = runCli([
      'label', '--repo', repoDir, '--integration-branch', 'integ', '--as-of', 'not-a-date',
    ]);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: --as-of must be an ISO-8601 timestamp');
  });

  it('rejects a scan PR that is not on the integration branch', () => {
    const { repoDir, inputs } = restoreFixture('case-01-simple-merge');
    const result = runCli([
      'scan', '--repo', repoDir, '--integration-branch', inputs.integration_branch,
      '--github-repo', inputs.github_repo, '--pr', '999', '--offline', '--as-of', inputs.as_of,
    ]);
    expect(result.exitCode).toBe(EXIT_INVALID_INPUT);
    expect(result.stderr).toContain('error: PR #999 not found on integ');
  });
});

describe('hokusai-scan upstream failures (exit 3)', () => {
  it('classifies gh failure stderr into actionable messages', () => {
    expect(classifyUpstreamFailure({ exitCode: 1, stderr: 'HTTP 401: Unauthorized' })).toBe(
      'GitHub authentication failed',
    );
    expect(classifyUpstreamFailure({ exitCode: 1, stderr: 'HTTP 404: Not Found' })).toBe(
      'GitHub resource not found',
    );
    expect(
      classifyUpstreamFailure({ exitCode: 1, stderr: 'API rate limit exceeded, resets at 2026-09-26T12:00:00Z' }),
    ).toContain('GitHub rate limit exceeded');
    expect(classifyUpstreamFailure({ exitCode: -1, stderr: 'request timed out' })).toBe(
      'GitHub request timed out',
    );
    expect(classifyUpstreamFailure({ exitCode: 1, stderr: '', failed: true })).toContain(
      'gh executable not found',
    );
  });

  it('maps a failed gh metadata fetch on --pr-url to exit 3', () => {
    const { repoDir, inputs } = restoreFixture('case-01-simple-merge');
    // Shim gh on PATH so the CLI's online metadata lookup fails with a 401.
    const shimDir = tempDir('scan-cli-ghshim-');
    writeFileSync(join(shimDir, 'gh'), '#!/bin/sh\necho "HTTP 401: Unauthorized" >&2\nexit 1\n');
    chmodSync(join(shimDir, 'gh'), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}${delimiter}${previousPath ?? ''}`;
    try {
      const result = runCli([
        'label', '--repo', repoDir, '--integration-branch', inputs.integration_branch,
        '--github-repo', inputs.github_repo, '--as-of', inputs.as_of,
        '--pr-url', 'https://github.com/golden/case-01-simple-merge/pull/999',
      ]);
      expect(result.exitCode).toBe(EXIT_UPSTREAM);
      expect(result.stderr).toContain('error: GitHub authentication failed');
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe('hokusai-scan output routing', () => {
  it('writes to stdout with --out - (default) and matches the golden bytes', () => {
    const { repoDir, inputs } = restoreFixture('case-01-simple-merge');
    const expected = readFileSync(
      join(FIXTURES_ROOT, 'case-01-simple-merge', 'survival-labels.expected.jsonl'),
      'utf-8',
    );
    const result = runCli([
      'label', '--repo', repoDir, '--integration-branch', inputs.integration_branch,
      '--github-repo', inputs.github_repo, '--as-of', inputs.as_of, '--offline',
    ]);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toBe(expected);
    expectPrefixedStderr(result.stderr);
    expect(result.stderr).toContain('info: summary ');
  });

  it('writes to a file with --out <path>, leaving stdout empty', () => {
    const { repoDir, inputs } = restoreFixture('case-01-simple-merge');
    const outPath = join(tempDir('scan-cli-out-'), 'nested', 'result.jsonl');
    const expected = readFileSync(
      join(FIXTURES_ROOT, 'case-01-simple-merge', 'survival-labels.expected.jsonl'),
      'utf-8',
    );
    const result = runCli([
      'label', '--repo', repoDir, '--integration-branch', inputs.integration_branch,
      '--github-repo', inputs.github_repo, '--as-of', inputs.as_of, '--offline',
      '--out', outPath,
    ]);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toBe('');
    expect(readFileSync(outPath, 'utf-8')).toBe(expected);
  });

  it('extract emits the golden candidate features on stdout', () => {
    const { repoDir, inputs } = restoreFixture('case-01-simple-merge');
    const expected = readFileSync(
      join(FIXTURES_ROOT, 'case-01-simple-merge', 'candidate-features.expected.json'),
      'utf-8',
    );
    const result = runCli([
      'extract', '--repo', repoDir, '--pr', String(inputs.pr_number),
      '--base-ref', inputs.base_ref, '--offline',
    ]);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toBe(expected);
    expectPrefixedStderr(result.stderr);
  });

  it('scan combines contract + features + labels for one PR', () => {
    const { repoDir, inputs } = restoreFixture('case-02-followup-deletion');
    const result = runCli([
      'scan', '--repo', repoDir, '--integration-branch', inputs.integration_branch,
      '--github-repo', inputs.github_repo, '--pr', String(inputs.pr_number),
      '--base-ref', inputs.base_ref, '--as-of', inputs.as_of, '--offline',
    ]);
    expect(result.exitCode).toBe(EXIT_OK);
    const combined = JSON.parse(result.stdout) as {
      scan_contract: Record<string, string>;
      candidate_features: { schema_version: string };
      survival_labels: Array<{ horizon_days: number; prUrl: string }>;
    };
    expect(combined.scan_contract).toEqual({
      candidateFeatures: 'candidate_features/v1',
      labels: 'arbiter_survival_label/v1',
      labellerVersion: '1.0.0',
      normalizationVersion: '1.0.0',
    });
    expect(combined.candidate_features.schema_version).toBe('candidate_features/v1');
    expect(combined.survival_labels).toHaveLength(3);
    expect(combined.survival_labels.every((row) => row.prUrl.endsWith('/pull/2'))).toBe(true);
  });
});

// ── Scrubbed-environment subprocess parity (REQ-F3) ────────────────────────

const distBuilt = existsSync(CLI_DIST) && existsSync(join(__dirname, '../../core/dist/index.js'));

describe('scrubbed-environment CLI parity', () => {
  function scrubbedEnv(home: string): Record<string, string> {
    const gitDir = dirname(
      execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).trim(),
    );
    const nodeDir = dirname(process.execPath);
    return {
      HOME: home,
      PATH: `${nodeDir}${delimiter}${gitDir}`,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      // Deliberately NO GH_*, WAVEMILL_*, HOKUSAI_*, GITHUB_* variables.
    };
  }

  function plantHostileState(home: string): void {
    // A lived-in machine: legacy tool state that must be ignored entirely.
    mkdirSync(join(home, '.wavemill'), { recursive: true });
    writeFileSync(
      join(home, '.wavemill', 'config'),
      JSON.stringify({ integrationBranch: 'WRONG-BRANCH', owner: 'WRONG-OWNER' }),
    );
    writeFileSync(
      join(home, '.gitconfig'),
      '[user]\n\tname = Should Not Matter\n[init]\n\tdefaultBranch = wrongbranch\n',
    );
  }

  it.skipIf(!distBuilt)(
    'the built CLI reproduces the golden bytes with no ambient state at all',
    () => {
      for (const caseName of [
        'case-01-simple-merge',
        'case-02-followup-deletion',
        'case-03-empty-diff',
      ] as const) {
        const { repoDir, inputs } = restoreFixture(caseName);
        const home = tempDir('scan-cli-home-');
        const cwd = tempDir('scan-cli-cwd-');
        plantHostileState(home);
        const env = scrubbedEnv(home);

        const labelRun = spawnSync(
          process.execPath,
          [
            CLI_DIST, 'label', '--repo', repoDir,
            '--integration-branch', inputs.integration_branch,
            '--github-repo', inputs.github_repo,
            '--as-of', inputs.as_of, '--offline',
          ],
          { cwd, env, encoding: 'utf-8' },
        );
        expect(labelRun.status, `${caseName} label stderr: ${labelRun.stderr}`).toBe(0);
        expect(labelRun.stdout).toBe(
          readFileSync(join(FIXTURES_ROOT, caseName, 'survival-labels.expected.jsonl'), 'utf-8'),
        );
        expectPrefixedStderr(labelRun.stderr);

        const extractRun = spawnSync(
          process.execPath,
          [
            CLI_DIST, 'extract', '--repo', repoDir,
            '--pr', String(inputs.pr_number), '--base-ref', inputs.base_ref, '--offline',
          ],
          { cwd, env, encoding: 'utf-8' },
        );
        expect(extractRun.status, `${caseName} extract stderr: ${extractRun.stderr}`).toBe(0);
        expect(extractRun.stdout).toBe(
          readFileSync(join(FIXTURES_ROOT, caseName, 'candidate-features.expected.json'), 'utf-8'),
        );
        expectPrefixedStderr(extractRun.stderr);
      }
    },
    120_000,
  );

  it.skipIf(!distBuilt || !existsSync(ACTION_BUNDLE))(
    'the Action bundle produces the same bytes as the CLI for the same inputs',
    () => {
      const { repoDir, inputs } = restoreFixture('case-01-simple-merge');
      const home = tempDir('scan-action-home-');
      const cwd = tempDir('scan-action-cwd-');
      const runnerTemp = tempDir('scan-action-rt-');
      const outputFile = join(runnerTemp, 'github-output.txt');
      writeFileSync(outputFile, '');
      plantHostileState(home);
      const run = spawnSync(process.execPath, [ACTION_BUNDLE], {
        cwd,
        encoding: 'utf-8',
        env: {
          ...scrubbedEnv(home),
          RUNNER_TEMP: runnerTemp,
          GITHUB_WORKSPACE: repoDir,
          GITHUB_OUTPUT: outputFile,
          INPUT_MODE: 'label',
          'INPUT_INTEGRATION-BRANCH': inputs.integration_branch,
          'INPUT_GITHUB-REPO': inputs.github_repo,
          'INPUT_AS-OF': inputs.as_of,
          INPUT_OFFLINE: 'true',
        },
      });
      expect(run.status, `action stderr: ${run.stderr}`).toBe(0);
      const written = readFileSync(join(runnerTemp, 'hokusai-scan-output.jsonl'), 'utf-8');
      expect(written).toBe(
        readFileSync(
          join(FIXTURES_ROOT, 'case-01-simple-merge', 'survival-labels.expected.jsonl'),
          'utf-8',
        ),
      );
      const outputs = readFileSync(outputFile, 'utf-8');
      expect(outputs).toContain('contract-version=candidate_features/v1:arbiter_survival_label/v1');
      expect(outputs).toContain('row-count=3');
    },
    60_000,
  );
});
