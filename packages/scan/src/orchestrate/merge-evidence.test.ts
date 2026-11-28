import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { completeCandidateFeaturesV1Fixture } from '../../../core/src/fixtures/candidate-features.js';
import { harvestedSurvivalLabelFixture } from '../../../core/src/fixtures/arbiter-survival-label.js';
import type { CorpusPrRecord } from '../corpus/enumerate.js';
import type { PrEvidence } from '../corpus/features.js';
import type { GitRunner } from '../survival-labeller.js';
import { collectMergeEvidence } from './merge-evidence.js';
import { runReportScan } from './scan-report.js';

it('pins landing evidence, discovers a rebase, and excludes later edits and private text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-merge-evidence-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'PRIVATE_AUTHOR', GIT_COMMITTER_NAME: 'PRIVATE_AUTHOR', GIT_AUTHOR_EMAIL: 'private@example.invalid', GIT_COMMITTER_EMAIL: 'private@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env }).trim();
  const runGit: GitRunner = (args) => {
    const result = spawnSync('git', [...args], { cwd: dir, encoding: 'utf8', env });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? 1 };
  };
  try {
    git('init', '-q', '-b', 'main');
    const commit = (file: string, message: string) => { writeFileSync(join(dir, file), `${message}\n`); git('add', file); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); };
    const root = commit('PRIVATE_PATH.txt', 'root');
    const squash = commit('squash.txt', 'squash (#1)');
    const rebase1 = commit('one.txt', 'first');
    const rebase2 = commit('two.txt', 'work\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    git('checkout', '-q', '-b', 'side');
    commit('side.txt', 'side\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'Merge pull request #3', 'side');
    const merge = git('rev-parse', 'HEAD');
    const at = '2026-01-02T00:00:00Z';
    const make = (number: number, base: string, sha: string, landed_by: CorpusPrRecord['landed_by'], members: number): CorpusPrRecord => ({ repo: 'example/repo', pr_number: number, pr_url: '', merged_at: at, base_ref: 'main', head_sha: null, merge_sha: sha, base_sha: base, landed_sha: sha, member_commits: members, landed_by, batched: false, relanded_merge_shas: [], author_login: 'PRIVATE_LOGIN', author_type: 'User', labels: [], closing_issues: [], title: '', body: '' });
    const records = [make(1, root, squash, 'squash', 1), make(2, squash, rebase2, 'rebase', 2), make(3, rebase2, merge, 'merge_commit', 1)];
    const evidence = (number: number): PrEvidence => ({ pr_number: number, created_at: '2026-01-01T00:00:00Z', merged_at: at, title: 'PRIVATE_TITLE', body: 'PRIVATE_BODY', head_ref: 'ordinary', reviews: [], dismissals: [], label_events: [], renames: [], body_edits: [{ at: '2026-01-01T00:00:00Z', body: 'PRIVATE_BODY' }], commits: [], history_complete: { title: true, body: true } });
    const prs = records.map((record) => ({ pr_number: record.pr_number, merge_sha: record.merge_sha }));
    let rebaseCommitCount = 2;
    let authorAvailable = true;
    const graphql = (query: string) => {
      if (query.includes('issueCount }')) return { search: { issueCount: records.length } };
      if (query.includes('search(')) return { search: { issueCount: records.length, pageInfo: { endCursor: null, hasNextPage: false }, nodes: records.map((record) => ({ number: record.pr_number, url: `https://github.com/example/repo/pull/${record.pr_number}`, mergedAt: at, baseRefName: 'main', headRefOid: record.merge_sha, title: 'PRIVATE_TITLE', body: 'PRIVATE_BODY', mergeCommit: { oid: record.merge_sha }, author: authorAvailable ? { login: 'PRIVATE_LOGIN', __typename: 'User' } : null, labels: { nodes: [] }, closingIssuesReferences: { nodes: [] }, commits: { totalCount: record.pr_number === 2 ? rebaseCommitCount : record.member_commits } })) } };
      return { repository: {} };
    };
    const input = { target: { owner: 'example', repo: 'repo', repoDir: dir, integrationBranch: 'main' }, runGit, graphql, from: new Date('2025-12-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z'), prs, capture: evidence, captureCi: () => null };
    const first = collectMergeEvidence(input);
    expect(first.rows.map((row) => row.agent_at_merge)).toEqual(['unknown', 'agent', 'agent']);
    expect(first.rows[1]!.values['feature.shape.member_commits']).toBeNull();
    expect(first.rows[1]!.values['feature.shape.files_touched']).toBeNull();
    expect(first.rows[2]!.values['feature.shape.files_touched']).toBe(1);
    commit('later.txt', 'later work');
    rebaseCommitCount = 1;
    const later = collectMergeEvidence({ ...input, capture: (number) => ({ ...evidence(number), title: 'later', body: 'later body', renames: [{ at: '2026-01-03T00:00:00Z', from: 'PRIVATE_TITLE', to: 'later' }], body_edits: [...evidence(number).body_edits, { at: '2026-01-03T00:00:00Z', body: 'later body' }] }) });
    expect(later).toEqual(first);
    rebaseCommitCount = 3;
    expect(collectMergeEvidence(input)).toEqual(first);
    expect(() => collectMergeEvidence({ ...input, capture: (number) => ({ ...evidence(number), label_events: [{ at: 'invalid', action: 'added', label: 'PRIVATE_LABEL' }] }) })).toThrow();
    const unavailable = collectMergeEvidence({ ...input, capture: () => null });
    expect(unavailable.rows[0]!.agent_at_merge).toBe('unknown');
    expect(unavailable.missing.github_history).toBeGreaterThan(0);
    authorAvailable = false;
    const unknown = collectMergeEvidence(input);
    expect(unknown.rows[0]!.agent_at_merge).toBe('unknown');
    expect(unknown.rows[0]!.values['segment.agent.marked_by_account']).toBeNull();
    const text = JSON.stringify(first);
    for (const secret of ['PRIVATE_TITLE', 'PRIVATE_BODY', 'PRIVATE_PATH', 'PRIVATE_AUTHOR', 'PRIVATE_LOGIN', 'private@example.invalid']) expect(text).not.toContain(secret);
    expect(first.missing.ci).toBeGreaterThan(0);
    expect(rebase1).not.toBe(rebase2);
    authorAvailable = true;
    rebaseCommitCount = 2;
    let internal: unknown;
    const now = () => new Date('2026-02-01T00:00:00Z');
    const report = await runReportScan(input.target, {
      runGit, now,
      github: { graphql, async getRepo() { await Promise.resolve(); return { defaultBranch: 'main', private: false }; }, async getPullRequest(number) { await Promise.resolve(); return { number, title: 'PRIVATE_TITLE', body: 'PRIVATE_BODY', authorLogin: 'PRIVATE_LOGIN', authorType: 'User', headRef: 'ordinary', headSha: merge, labels: [], mergedAt: at }; }, async listPullCommits() { await Promise.resolve(); return []; }, async getCheckConclusion() { await Promise.resolve(); return null; } },
      labeller: { runGit, github: { getPrMetadata: () => null, listCrossReferences: () => [] }, now },
      extract: () => completeCandidateFeaturesV1Fixture,
      label: () => [harvestedSurvivalLabelFixture],
    }, { scannerVersion: 'test', onMergeEvidence: (result) => { internal = result; } });
    expect(report.prs.map((pr) => pr.pr_number).sort()).toEqual([1, 2, 3]);
    expect(JSON.stringify(internal)).not.toContain('PRIVATE_TITLE');
    expect(JSON.stringify(report)).not.toContain('agent_at_merge');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
