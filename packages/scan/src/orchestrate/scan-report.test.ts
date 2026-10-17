import { describe, expect, it } from 'vitest';
import { completeCandidateFeaturesV1Fixture } from '../../../core/src/fixtures/candidate-features.js';
import { harvestedSurvivalLabelFixture } from '../../../core/src/fixtures/arbiter-survival-label.js';
import { runReportScan } from './scan-report.js';
import type { GitCommandResult } from '../survival-labeller.js';
const merge = 'a'.repeat(40), parent = 'b'.repeat(40), head = 'c'.repeat(40);
describe('runReportScan', () => {
  it('assembles a report from injected dependencies without emitting raw GitHub text', async () => {
    const runGit = (args: readonly string[]): GitCommandResult => ({
      stdout: args[0] === 'log' ? `${merge}\t${parent} ${head}\t1780272000\tMerge pull request #123 from org/agent` : '', stderr: '', exitCode: 0,
    });
    const label = () => [harvestedSurvivalLabelFixture];
    const draft = await runReportScan({ owner: 'org', repo: 'repo', repoDir: '/repo', integrationBranch: 'develop' }, {
      runGit, now: () => new Date('2026-10-16T00:00:00Z'), labeller: { runGit, github: { getPrMetadata: () => null, listCrossReferences: () => [] }, now: () => new Date('2026-10-16T00:00:00Z') },
      github: {
        async getRepo() { await Promise.resolve(); return { defaultBranch: 'develop', private: false }; },
        async getPullRequest() { await Promise.resolve(); return { number: 123, title: 'TITLE_SECRET', body: 'BODY_SECRET', authorLogin: 'AUTHOR_SECRET', authorType: 'User', headRef: 'BRANCH_SECRET', headSha: head, labels: [], mergedAt: '2026-06-01T00:00:00Z' }; },
        async listPullCommits() { await Promise.resolve(); return ['TRAILER_SECRET']; }, async getCheckConclusion() { await Promise.resolve(); return 'success'; },
      },
      extract: () => completeCandidateFeaturesV1Fixture,
      label,
    }, { horizons: [harvestedSurvivalLabelFixture.horizon_days], scannerVersion: '1.0.0' });
    const bytes = JSON.stringify(draft);
    for (const secret of ['TITLE_SECRET', 'BODY_SECRET', 'AUTHOR_SECRET', 'BRANCH_SECRET', 'TRAILER_SECRET']) expect(bytes).not.toContain(secret);
    expect(draft.prs).toHaveLength(1);
    expect(draft.coverage.prs_enumerated).toBe(1);
  });
});

describe('incremental report cache', () => {
  it('reuses immutable metadata and matured labels while matching a full scan', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-report-state-'));
    let now = new Date('2026-06-10T00:00:00Z');
    let prLookups = 0, extractions = 0, labels = 0;
    const runGit = (args: readonly string[]): GitCommandResult => ({
      stdout: args[0] === 'log' && !args.some((arg) => arg === `${merge}..develop`) ? `${merge}\t${parent} ${head}\t1780272000\tMerge pull request #123 from org/agent` : '', stderr: '', exitCode: 0,
    });
    const deps = {
      runGit, now: () => now,
      labeller: { runGit, github: { getPrMetadata: () => null, listCrossReferences: () => [] }, now: () => now },
      github: {
        async getRepo() { await Promise.resolve(); return { defaultBranch: 'develop', private: false }; },
        async getPullRequest() { await Promise.resolve(); prLookups++; return { number: 123, title: 'private title', body: 'private body', authorLogin: 'private author', authorType: 'User', headRef: 'branch', headSha: head, labels: [], mergedAt: '2026-06-01T00:00:00Z' }; },
        async listPullCommits() { await Promise.resolve(); return ['private commit']; }, async getCheckConclusion() { await Promise.resolve(); return null; },
      },
      extract: () => { extractions++; return completeCandidateFeaturesV1Fixture; },
      label: (() => {
        labels++;
        return [labels === 1 ? { ...harvestedSurvivalLabelFixture, outcome: { ...harvestedSurvivalLabelFixture.outcome, reason_codes: ['missing_horizon'] } } : harvestedSurvivalLabelFixture];
      }) as never,
    };
    const target = { owner: 'org', repo: 'repo', repoDir: '/repo', integrationBranch: 'develop' };
    const options = { horizons: [harvestedSurvivalLabelFixture.horizon_days], scannerVersion: '1.0.0', stateDir };
    try {
      await runReportScan(target, deps, options);
      now = new Date('2026-10-16T00:00:00Z');
      const incremental = await runReportScan(target, deps, options);
      expect(prLookups).toBe(1);
      expect(extractions).toBe(1);
      expect(labels).toBe(2);
      const cacheBytes = fs.readFileSync(path.join(stateDir, 'prs.jsonl'), 'utf8');
      for (const secret of ['private title', 'private body', 'private author', 'private commit']) expect(cacheBytes).not.toContain(secret);
      const fullOptions = { horizons: options.horizons, scannerVersion: options.scannerVersion };
      const full = await runReportScan(target, deps, fullOptions);
      expect(incremental.aggregates).toEqual(full.aggregates);
      expect(incremental.coverage).toEqual(full.coverage);
      expect(incremental.prs).toEqual(full.prs);
    } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
  });
});
