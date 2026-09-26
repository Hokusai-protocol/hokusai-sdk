/**
 * Tests for `scripts/check-scan-workflow-surfaces.mjs` (HOK-2820): the
 * mechanical proof that shadow-mode scan workflows can never surface
 * anything on a PR. Runs the guard as a subprocess (the same way
 * `pnpm check:boundaries` does) against generated allowed/forbidden
 * fixtures, and against this repository's real workflows.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const GUARD = join(repoRoot, 'scripts/check-scan-workflow-surfaces.mjs');

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function runGuard(dirs: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [GUARD, ...dirs], { cwd: repoRoot, encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function fixtureDir(name: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), `scan-guard-${name}-`));
  cleanups.push(dir);
  for (const [file, content] of Object.entries(files)) {
    const full = join(dir, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** A silent shadow workflow: explicit read permissions, fork guard, soft-fail. */
const ALLOWED_WORKFLOW = `name: hokusai-scan-pr
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: read
jobs:
  shadow:
    if: github.event.pull_request.head.repo.fork == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - id: scan
        continue-on-error: true
        uses: ./packages/scan/action
        with:
          mode: extract
`;

/** Non-PR-triggered variant (nightly): contents write for the state branch is allowed. */
const ALLOWED_NIGHTLY = `name: hokusai-scan-nightly
on:
  schedule:
    - cron: '15 6 * * *'
permissions:
  contents: write
  pull-requests: read
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - run: echo silent
`;

describe('check-scan-workflow-surfaces guard', () => {
  it('passes an allowed shadow workflow', () => {
    const dir = fixtureDir('allowed', {
      'hokusai-scan-pr.yml': ALLOWED_WORKFLOW,
      'hokusai-scan-nightly.yml': ALLOWED_NIGHTLY,
    });
    const result = runGuard([dir]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('passed (2 file(s))');
  });

  const forbiddenStrings: Array<[string, string]> = [
    ['checks: write', 'check-run write'],
    ['pull-requests: write', 'PR write'],
    ['statuses: write', 'commit-status write'],
    ['issues: write', 'issue write'],
    ['github.rest.issues.createComment({})', 'PR comment'],
    ['github.rest.checks.create({})', 'check run'],
    ['github.rest.repos.createCommitStatus({})', 'commit status'],
    ['echo "::error file=x.ts::bad"', '::error annotation'],
    ['echo "::warning::careful"', '::warning annotation'],
    ['echo "::notice::fyi"', '::notice annotation'],
  ];

  for (const [forbidden, label] of forbiddenStrings) {
    it(`fails on ${label} (\`${forbidden}\`)`, () => {
      const dir = fixtureDir('forbidden', {
        'hokusai-scan-pr.yml': `${ALLOWED_WORKFLOW}      - run: |\n          ${forbidden}\n`,
      });
      const result = runGuard([dir]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('shadow mode must stay invisible on PRs');
    });
  }

  it('fails on a missing permissions block', () => {
    const dir = fixtureDir('noperms', {
      'hokusai-scan-pr.yml': ALLOWED_WORKFLOW.replace(
        /permissions:\n  contents: read\n  pull-requests: read\n/,
        '',
      ),
    });
    const result = runGuard([dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no explicit permissions: block');
  });

  it('fails on a pull_request trigger without the fork guard', () => {
    const dir = fixtureDir('nofork', {
      'hokusai-scan-pr.yml': ALLOWED_WORKFLOW.replace(
        '    if: github.event.pull_request.head.repo.fork == false\n',
        '',
      ),
    });
    const result = runGuard([dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fork guard');
  });

  it('fails on a pull_request trigger without continue-on-error', () => {
    const dir = fixtureDir('hardfail', {
      'hokusai-scan-pr.yml': ALLOWED_WORKFLOW.replace('        continue-on-error: true\n', ''),
    });
    const result = runGuard([dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('continue-on-error');
  });

  it('fails on pull_request_target', () => {
    const dir = fixtureDir('prtarget', {
      'hokusai-scan-pr.yml': ALLOWED_WORKFLOW.replace('pull_request:', 'pull_request_target:'),
    });
    const result = runGuard([dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pull_request_target is forbidden');
  });

  it('fails when pointed at a directory with no workflow files', () => {
    const dir = fixtureDir('empty', {});
    const result = runGuard([dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no workflow files');
  });

  it('passes against this repository’s real scan workflows and templates', () => {
    const result = runGuard([]);
    expect(result.status, result.stderr).toBe(0);
  });
});
