import { describe, expect, it } from 'vitest';
import type { GitRunner } from '../survival-labeller.js';
import { enumerateCorpusRepo, type GraphqlRunner } from './enumerate.js';

const REPO = 'org/repo';
const sha = (n: number) => n.toString(16).padStart(40, '0');
const epoch = (day: number) => Date.parse(`2025-01-${String(day).padStart(2, '0')}T12:00:00Z`) / 1000;

interface FakeCommit { n: number; parents: number[]; day: number; subject: string; body?: string }

/** First-parent history, oldest first, as `git log --first-parent --reverse` would print it per window. */
function fakeGit(commits: FakeCommit[]): GitRunner {
  return (args) => {
    const since = Date.parse(args.find((a) => a.startsWith('--since='))!.slice(8)) / 1000;
    const until = Date.parse(args.find((a) => a.startsWith('--until='))!.slice(8)) / 1000;
    const stdout = commits
      .filter((c) => epoch(c.day) >= since && epoch(c.day) <= until)
      .map((c) => [sha(c.n), c.parents.map(sha).join(' '), String(epoch(c.day)), c.subject, c.body ?? ''].join('\x1f') + '\x1e')
      .join('\n');
    return { stdout, stderr: '', exitCode: 0 };
  };
}

interface FakePr { number: number; mergeCommit?: number; commits?: number; mergedAt?: string; baseRefName?: string }

function pr(p: FakePr) {
  return {
    number: p.number,
    url: `https://github.com/${REPO}/pull/${p.number}`,
    mergedAt: p.mergedAt ?? '2025-01-10T12:00:00Z',
    baseRefName: p.baseRefName ?? 'main',
    headRefOid: 'f'.repeat(40),
    title: `PR ${p.number}`,
    body: 'raw body',
    mergeCommit: p.mergeCommit === undefined ? null : { oid: sha(p.mergeCommit) },
    author: { login: 'dev', __typename: 'User' },
    labels: { nodes: [{ name: 'bug' }] },
    closingIssuesReferences: { nodes: [{ number: 5 }] },
    commits: { totalCount: p.commits ?? 1 },
  };
}

/** Search returns `merged`; aliased by-number lookups return `byNumber`. Records every query. */
function fakeGraphql(merged: FakePr[], byNumber: FakePr[] = [], countOverride?: (q: string) => number) {
  const calls: string[] = [];
  const graphql: GraphqlRunner = (query, variables) => {
    calls.push(String(variables['q'] ?? 'by-number'));
    if (query.includes('issueCount }')) return { search: { issueCount: countOverride?.(String(variables['q'])) ?? merged.length } };
    if (query.includes('search(')) return { search: { issueCount: merged.length, pageInfo: { endCursor: null, hasNextPage: false }, nodes: merged.map(pr) } };
    const repository: Record<string, unknown> = {};
    for (const match of query.matchAll(/pr(\d+): pullRequest/g)) {
      const found = byNumber.find((p) => p.number === Number(match[1]));
      repository[`pr${match[1]}`] = found ? pr(found) : null;
    }
    return { repository };
  };
  return { graphql, calls };
}

const target = { repo: REPO, branch: 'main', defaultBranchNames: ['main'], from: new Date('2025-01-01T00:00:00Z'), until: new Date('2025-02-01T00:00:00Z') };

describe('enumerateCorpusRepo', () => {
  it('maps squash and merge commits by merge SHA and keeps label-side metadata', () => {
    const git = fakeGit([
      { n: 1, parents: [0], day: 2, subject: 'Fix A (#10)' },
      { n: 2, parents: [1, 99], day: 3, subject: 'Merge pull request #11 from org/b' },
    ]);
    const { graphql } = fakeGraphql([{ number: 10, mergeCommit: 1 }, { number: 11, mergeCommit: 2 }]);
    const { records, stats } = enumerateCorpusRepo(target, { runGit: git, graphql });
    expect(records.map((r) => [r.pr_number, r.landed_by, r.merge_sha, r.base_sha])).toEqual([
      [10, 'squash', sha(1), sha(0)],
      [11, 'merge_commit', sha(2), sha(1)],
    ]);
    expect(records[0]).toMatchObject({ labels: ['bug'], closing_issues: [5], batched: false, member_commits: 1 });
    expect(stats).toMatchObject({ first_parent_commits: 2, mapped_commits: 2, mapped_share: 1, prs: 2 });
  });

  it('claims the earlier first-parent commits of a rebase-merged PR and anchors base_sha before them', () => {
    const git = fakeGit([
      { n: 1, parents: [0], day: 2, subject: 'Refs #1 -- step one' },
      { n: 2, parents: [1], day: 2, subject: 'Refs #1 -- step two' },
      { n: 3, parents: [2], day: 2, subject: 'Fixed #1 -- step three' },
    ]);
    const { graphql } = fakeGraphql([{ number: 20, mergeCommit: 3, commits: 3 }]);
    const { records, stats } = enumerateCorpusRepo(target, { runGit: git, graphql });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ landed_by: 'rebase', member_commits: 3, merge_sha: sha(3), base_sha: sha(0) });
    expect(stats.mapped_share).toBe(1);
  });

  it('marks batched bors merges and maps every member', () => {
    const git = fakeGit([{ n: 1, parents: [0, 50], day: 4, subject: 'Merge #30 #31' }]);
    const { graphql } = fakeGraphql([{ number: 30, mergeCommit: 1 }, { number: 31, mergeCommit: 1 }]);
    const { records, stats } = enumerateCorpusRepo(target, { runGit: git, graphql });
    expect(records.map((r) => [r.pr_number, r.batched, r.landed_by])).toEqual([
      [30, true, 'merge_commit'],
      [31, true, 'merge_commit'],
    ]);
    expect(stats.batched_commits).toBe(1);
  });

  it('fetches merge-bot PRs by number when the merged search misses them', () => {
    const git = fakeGit([{ n: 1, parents: [0], day: 5, subject: '[x] tweak', body: 'Pull Request resolved: https://github.com/org/repo/pull/40' }]);
    const { graphql, calls } = fakeGraphql([], [{ number: 40 }]);
    const { records, stats } = enumerateCorpusRepo(target, { runGit: git, graphql });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pr_number: 40, landed_by: 'number_ref', merge_sha: sha(1) });
    expect(calls).toContain('by-number');
    expect(stats.number_ref_prs).toBe(1);
  });

  it('reports direct pushes as unmapped and off-branch PRs separately', () => {
    const git = fakeGit([
      { n: 1, parents: [0], day: 6, subject: 'Bump version' },
      { n: 2, parents: [1], day: 7, subject: 'Fix B (#12)' },
    ]);
    const { graphql } = fakeGraphql([{ number: 12, mergeCommit: 2 }, { number: 13, mergeCommit: 77, baseRefName: 'release-1.0' }]);
    const { stats } = enumerateCorpusRepo(target, { runGit: git, graphql });
    expect(stats).toMatchObject({ mapped_commits: 1, mapped_share: 0.5, unmapped_sample: [sha(1)], api_prs_not_on_branch: 1, api_prs_not_on_branch_default_base: 0 });
  });

  it('attaches relands to the first landing and counts direct-pushed reverts apart from misses', () => {
    const trailer = (n: number) => `Pull Request resolved: https://github.com/org/repo/pull/${n}`;
    const git = fakeGit([
      { n: 1, parents: [0], day: 2, subject: '[x] feature', body: trailer(50) },
      { n: 2, parents: [1], day: 3, subject: 'Revert "[x] feature (#50)"' },
      { n: 3, parents: [2], day: 4, subject: '[x] feature', body: trailer(50) },
    ]);
    const { graphql } = fakeGraphql([], [{ number: 50 }]);
    const audited: string[] = [];
    const { records, stats } = enumerateCorpusRepo(target, { runGit: git, graphql, pullsForCommit: (s) => (audited.push(s), []) });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pr_number: 50, merge_sha: sha(1), relanded_merge_shas: [sha(3)] });
    expect(stats).toMatchObject({ mapped_commits: 2, relanded_commits: 1, unmapped_reverts: 1, pr_recall_est: 1, direct_push_share_est: 0.3333 });
    expect(audited).toEqual([]);
  });

  it('audits unmapped commits to separate enumerator misses from direct pushes', () => {
    const git = fakeGit([
      { n: 1, parents: [0], day: 6, subject: 'Release notes' },
      { n: 2, parents: [1], day: 7, subject: 'Missed by search' },
      { n: 3, parents: [2], day: 8, subject: 'Fix C (#14)' },
      { n: 4, parents: [3], day: 9, subject: 'Fix D (#15)' },
    ]);
    const { graphql } = fakeGraphql([{ number: 14, mergeCommit: 3 }, { number: 15, mergeCommit: 4 }]);
    const pullsForCommit = (s: string) => (s === sha(2) ? [99] : []);
    const { stats } = enumerateCorpusRepo(target, { runGit: git, graphql, pullsForCommit });
    // 2 mapped; of 2 unmapped, 1 has a PR (a miss) and 1 is a direct push.
    expect(stats).toMatchObject({ unmapped_audited: 2, unmapped_audited_with_pr: 1, pr_recall_est: 0.6667, direct_push_share_est: 0.25 });
  });

  it('splits date ranges over the 1,000-result search cap and reuses cached slices', () => {
    const git = fakeGit([]);
    const store = new Map<string, unknown>();
    const cache = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, v) };
    const fullRange = 'merged:2025-01-01..2025-01-31';
    const first = fakeGraphql([{ number: 1, mergeCommit: 1 }], [], (q) => (q.endsWith(fullRange) ? 1500 : 10));
    enumerateCorpusRepo(target, { runGit: git, graphql: first.graphql, cache });
    const counted = first.calls.filter((q) => q.includes('merged:'));
    expect(counted.some((q) => q.endsWith(fullRange))).toBe(true);
    expect(counted.some((q) => q.endsWith('merged:2025-01-01..2025-01-16'))).toBe(true);
    expect(counted.some((q) => q.endsWith('merged:2025-01-17..2025-01-31'))).toBe(true);

    const second = fakeGraphql([], [], () => 10);
    enumerateCorpusRepo(target, { runGit: git, graphql: second.graphql, cache });
    expect(second.calls.filter((q) => q.includes('2025-01-01..2025-01-16'))).toEqual([]);
  });
});
