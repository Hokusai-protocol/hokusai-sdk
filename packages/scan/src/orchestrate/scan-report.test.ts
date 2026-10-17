import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateArbiterReportV1 } from '@hokusai/core';
import { createFixtureRepo, FIXTURE_BRANCH } from '../shadow/test-fixture.js';
import { runReportScan, type ReportScanDeps } from './scan-report.js';
import { runScanCli } from '../cli-core.js';
import { resolveAttributionConfig } from '../attribution/index.js';

const DAY = 86_400;
const BASE = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });
function setup() {
  const fixture = createFixtureRepo(BASE);
  fixtures.push(fixture.dir);
  const stateDir = mkdtempSync(join(tmpdir(), 'hokusai-report-state-'));
  fixtures.push(stateDir);
  const calls: number[] = [];
  const deps: ReportScanDeps = {
    runGit: fixture.runGit,
    github: {
      getRepo: () => ({ defaultBranch: FIXTURE_BRANCH, private: false }),
      getPullRequest: (n) => { calls.push(n); return { number: n, title: 'PRIVATE_TITLE_SENTINEL', body: 'PRIVATE_BODY_SENTINEL', authorLogin: 'PRIVATE_AUTHOR_SENTINEL', authorType: 'User', headRef: 'PRIVATE_BRANCH_SENTINEL', headSha: fixture.mergeShas[n - 1] ?? '', labels: ['PRIVATE_LABEL_SENTINEL'], mergedAt: new Date((BASE + n * DAY) * 1000).toISOString() }; },
      listPullCommits: () => ['PRIVATE_TRAILER_SENTINEL'], getCheckConclusion: () => 'success',
    },
    labellerGithub: { getPrMetadata: () => null, listCrossReferences: () => [] },
    now: () => new Date((BASE + 100 * DAY) * 1000),
  };
  return { fixture, stateDir, calls, deps, target: { owner: 'owner', repo: 'repo', repoDir: fixture.dir, integrationBranch: FIXTURE_BRANCH } };
}

describe('runReportScan', () => {
  it('runs the report subcommand with local repository evidence', () => {
    const { fixture, deps, target } = setup();
    fixture.addMerges([{ prNumber: 1, epoch: BASE + DAY }]);
    let stdout = '';
    let stderr = '';
    const result = runScanCli(['report', 'owner/repo', '--repo', fixture.dir, '--integration-branch', FIXTURE_BRANCH, '--offline'], {
      env: {}, writeStdout: (text) => { stdout += text; }, writeStderr: (text) => { stderr += text; },
      reportDepsFactory: () => deps,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(stdout).prs).toHaveLength(1);
    expect(stderr.split('\n').filter(Boolean).every((line) => /^(info|warn|error):/.test(line))).toBe(true);
    expect(stdout + stderr).not.toContain('PRIVATE_TITLE_SENTINEL');
    expect(stdout + stderr).not.toContain('PRIVATE_BODY_SENTINEL');
    expect(target.integrationBranch).toBe(FIXTURE_BRANCH);
    let dryRunBody = '';
    const dryRun = runScanCli(['report', 'owner/repo', '--repo', fixture.dir, '--integration-branch', FIXTURE_BRANCH, '--offline', '--contribute', '--dry-run', '--no-state'], {
      env: {}, writeStdout: (text) => { dryRunBody += text; }, writeStderr: () => {}, reportDepsFactory: () => deps,
    });
    expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRunBody).schema_version).toBe('arbiter_report/v1');
  }, 30_000);
  it('emits a private-content-free valid report and reuses state', () => {
    const { fixture, stateDir, calls, deps, target } = setup();
    fixture.addMerges([1, 2, 3].map((prNumber) => ({ prNumber, epoch: BASE + prNumber * DAY })));
    const opts = { scannerVersion: '0.4.0', stateDir };
    const first = runReportScan(target, deps, opts);
    expect(first.report.prs).toHaveLength(3);
    expect(validateArbiterReportV1(first.report).ok).toBe(true);
    expect(first.report.prs.every((pr) => pr.labels.length === 3)).toBe(true);
    for (const secret of ['PRIVATE_TITLE_SENTINEL', 'PRIVATE_BODY_SENTINEL', 'PRIVATE_AUTHOR_SENTINEL', 'PRIVATE_BRANCH_SENTINEL', 'PRIVATE_LABEL_SENTINEL', 'PRIVATE_TRAILER_SENTINEL']) {
      expect(first.json).not.toContain(secret);
      expect(readFileSync(join(stateDir, 'prs.jsonl'), 'utf8')).not.toContain(secret);
    }
    fixture.addMerges([{ prNumber: 4, epoch: BASE + 4 * DAY }]);
    calls.length = 0;
    const incremental = runReportScan(target, deps, opts);
    expect(calls).toEqual([4]);
    calls.length = 0;
    const full = runReportScan(target, deps, { scannerVersion: '0.4.0' });
    expect(incremental.report.aggregates).toEqual(full.report.aggregates);
    expect(incremental.report.coverage).toEqual(full.report.coverage);
    calls.length = 0;
    runReportScan(target, deps, { ...opts, attributionConfig: resolveAttributionConfig({ extraLabelNames: ['agent'] }) });
    expect(calls).toHaveLength(4);
    calls.length = 0;
    runReportScan(target, deps, { ...opts, maxPrs: 2 });
    expect(calls).toEqual([3, 4]);
    fixture.runGit(['reset', '--hard', 'HEAD~2']);
    fixture.addMerges([{ prNumber: 5, epoch: BASE + 5 * DAY }]);
    calls.length = 0;
    const rewritten = runReportScan(target, deps, opts);
    const rewrittenFull = runReportScan(target, deps, { scannerVersion: '0.4.0' });
    expect(calls.length).toBeGreaterThan(0);
    expect(rewritten.report.aggregates).toEqual(rewrittenFull.report.aggregates);
  }, 30_000);
  it('applies attribution gate configuration to report policy', () => {
    const { fixture, deps, target } = setup();
    fixture.addMerges([{ prNumber: 1, epoch: BASE + DAY }]);
    const report = runReportScan(target, deps, {
      scannerVersion: '0.4.0',
      attributionConfig: resolveAttributionConfig({ coverageFloorPercent: 75, minEligiblePrs: 25 }),
    }).report;
    expect(report.policy).toMatchObject({ min_cell_n: 25, min_agent_coverage: 0.75, min_harness_coverage: 0.75, min_exact_model_coverage: 0.75 });
  }, 30_000);
  it('ignores a truncated checkpoint and performs a full rescan', () => {
    const { fixture, stateDir, calls, deps, target } = setup();
    fixture.addMerges([1, 2].map((prNumber) => ({ prNumber, epoch: BASE + prNumber * DAY })));
    const opts = { scannerVersion: '0.4.0', stateDir };
    runReportScan(target, deps, opts);
    const path = join(stateDir, 'prs.jsonl');
    const cached = JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0]!) as { merge_sha: string; row: { pr_number: number } };
    writeFileSync(path, `${JSON.stringify({ merge_sha: cached.merge_sha, row: { pr_number: cached.row.pr_number } })}\n`);
    calls.length = 0;
    runReportScan(target, deps, opts);
    expect(calls).toEqual([1, 2]);
  }, 30_000);
});
