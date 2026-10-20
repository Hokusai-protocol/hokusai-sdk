import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { execArgvCommand } from '../shell-utils.js';
import type { GitRunner } from '../survival-labeller.js';
import type { CorpusPrRecord, GraphqlRunner } from './enumerate.js';
import { labelCorpusRepo, prefetchCrossReferences, prefetchedGithubClient, toMergedPrRef } from './label.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** main: base -> rebased PR commit 1 (a.txt) -> rebased PR commit 2 (b.txt). */
function rebaseRepo(): { dir: string; base: string; first: string; last: string } {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-label-'));
  dirs.push(dir);
  const git = (args: string[], date: string) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@x' },
    }).trim();
  git(['init', '-q', '-b', 'main'], '2025-01-01T00:00:00Z');
  const commit = (file: string, body: string, date: string) => {
    writeFileSync(join(dir, file), body);
    git(['add', file], date);
    git(['commit', '-q', '-m', `add ${file}`], date);
    return git(['rev-parse', 'HEAD'], date);
  };
  const base = commit('README', 'base\n', '2025-01-01T00:00:00Z');
  const first = commit('a.txt', 'one\ntwo\n', '2025-01-02T00:00:00Z');
  const last = commit('b.txt', 'three\n', '2025-01-02T00:00:01Z');
  return { dir, base, first, last };
}

/**
 * main:   base -> M (agent edits a.txt's first line) -> A (rollup landing) -> D (human deletes the member's line)
 * rollup: base -> R (rollup member appends a line to a.txt)
 * M predates the member's landing, so it must not vote on who undid it.
 */
function rollupRepo(): { dir: string; base: string; member: string; landing: string } {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-rollup-'));
  dirs.push(dir);
  const git = (args: string[], date: string) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@x' },
    }).trim();
  git(['init', '-q', '-b', 'main'], '2025-01-01T00:00:00Z');
  writeFileSync(join(dir, 'a.txt'), 'zero\none\n');
  git(['add', 'a.txt'], '2025-01-01T00:00:00Z');
  git(['commit', '-q', '-m', 'base'], '2025-01-01T00:00:00Z');
  const base = git(['rev-parse', 'HEAD'], '2025-01-01T00:00:00Z');
  git(['checkout', '-q', '-b', 'rollup'], '2025-01-02T00:00:00Z');
  writeFileSync(join(dir, 'a.txt'), 'zero\none\n\n\n\ntwo\n');
  git(['commit', '-q', '-am', 'Rollup merge of #1 - dev:a, r=dev'], '2025-01-02T00:00:00Z');
  const member = git(['rev-parse', 'HEAD'], '2025-01-02T00:00:00Z');
  git(['checkout', '-q', 'main'], '2025-01-02T12:00:00Z');
  writeFileSync(join(dir, 'a.txt'), 'ZERO\none\n');
  git(['commit', '-q', '-am', 'tweak\n\nCo-Authored-By: Claude <noreply@anthropic.com>'], '2025-01-02T12:00:00Z');
  git(['merge', '-q', '--no-ff', 'rollup', '-m', 'Auto merge of #9 - dev:rollup-x, r=dev'], '2025-01-03T00:00:00Z');
  const landing = git(['rev-parse', 'HEAD'], '2025-01-03T00:00:00Z');
  writeFileSync(join(dir, 'a.txt'), 'ZERO\none\n\n\n\n');
  git(['commit', '-q', '-am', 'drop two'], '2025-01-04T00:00:00Z');
  return { dir, base, member, landing };
}

function record(overrides: Partial<CorpusPrRecord>): CorpusPrRecord {
  return {
    repo: 'org/repo', pr_number: 1, pr_url: 'https://github.com/org/repo/pull/1', merged_at: '2025-01-02T00:00:01Z',
    base_ref: 'main', head_sha: null, merge_sha: 'x', base_sha: 'y', landed_sha: 'x', member_commits: 1, landed_by: 'squash', batched: false, relanded_merge_shas: [],
    author_login: 'dev', author_type: 'User', labels: [], closing_issues: [], title: 'Add files', body: '', ...overrides,
  };
}

describe('corpus labelling', () => {
  it('labels a rebase-merged PR over all of its commits, not only the last', () => {
    const { dir, base, first, last } = rebaseRepo();
    const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', dir, ...args], { encoding: 'utf8' });
    const deps = { runGit, github: prefetchedGithubClient(new Map()), now: () => new Date('2025-06-01T00:00:00Z') };
    const input = { owner: 'org', repo: 'repo', branch: 'main', repoDir: dir, horizons: [14] as const };

    const whole = labelCorpusRepo({ ...input, records: [record({ merge_sha: last, base_sha: base, member_commits: 2, landed_by: 'rebase' })] }, deps);
    expect(whole.failed).toEqual([]);
    expect(whole.rows[0]!.line_ranges.map((r) => r.path)).toEqual(['a.txt', 'b.txt']);
    expect(whole.rows[0]!.envelope).toMatchObject({ integration_branch: 'main', integration_mode: 'direct', merge_sha: last });

    // The pre-HOK-3266 anchor (merge^1) would have seen only the last commit.
    const lastOnly = labelCorpusRepo({ ...input, records: [record({ merge_sha: last, base_sha: first })] }, deps);
    expect(lastOnly.rows[0]!.line_ranges.map((r) => r.path)).toEqual(['b.txt']);
  });

  it('labels a rollup member from its own merge commit and walks undoers from the landing merge', () => {
    const { dir, base, member, landing } = rollupRepo();
    const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', dir, ...args], { encoding: 'utf8' });
    const deps = { runGit, github: prefetchedGithubClient(new Map()), now: () => new Date('2025-06-01T00:00:00Z') };
    const input = { owner: 'org', repo: 'repo', branch: 'main', repoDir: dir, horizons: [14] as const };
    const rollupMember = record({ merge_sha: member, base_sha: base, landed_sha: landing, landed_by: 'rollup', merged_at: '2025-01-03T00:00:00Z' });

    const { rows, failed } = labelCorpusRepo({ ...input, records: [rollupMember] }, deps);
    expect(failed).toEqual([]);
    expect(rows[0]!.line_ranges.map((r) => r.path)).toEqual(['a.txt']);
    expect(rows[0]!.envelope).toMatchObject({ merge_sha: member });
    // Walking from the landing merge leaves out the agent's earlier main-side commit.
    expect(rows[0]!.outcome.undone_by).toBe('human');

    const fromMember = labelCorpusRepo({ ...input, records: [{ ...rollupMember, landed_sha: member }] }, deps);
    expect(fromMember.rows[0]!.outcome.undone_by).toBe(null);
  });

  it('adapts records with base_sha as the pre-change state and the title as the subject', () => {
    const ref = toMergedPrRef(record({ merge_sha: 'm', base_sha: 'b', head_sha: null, title: 'HOK-1 fix' }));
    expect(ref).toMatchObject({ mergeSha: 'm', parentSha: 'b', headSha: 'm', subject: 'HOK-1 fix', mergedAtEpoch: Date.parse('2025-01-02T00:00:01Z') / 1000 });
  });

  it('prefetches cross-references in batches and serves them without network', () => {
    const queries: string[] = [];
    const graphql: GraphqlRunner = (query) => {
      queries.push(query);
      const repository: Record<string, unknown> = {};
      for (const match of query.matchAll(/pr(\d+): pullRequest/g)) {
        repository[`pr${match[1]}`] = match[1] === '2'
          ? { timelineItems: { nodes: [{ createdAt: '2025-01-05T00:00:00Z', source: { url: 'https://github.com/org/repo/issues/9' } }, {}] } }
          : null;
      }
      return { repository };
    };
    const numbers = Array.from({ length: 51 }, (_, i) => i + 1);
    const refs = prefetchCrossReferences('org/repo', numbers, graphql);
    expect(queries).toHaveLength(2);
    const client = prefetchedGithubClient(refs);
    expect(client.listCrossReferences(2)).toEqual([{ createdAtEpoch: Date.parse('2025-01-05T00:00:00Z') / 1000, url: 'https://github.com/org/repo/issues/9' }]);
    expect(client.listCrossReferences(3)).toEqual([]);
    expect(client.getPrMetadata('https://github.com/org/repo/pull/2')).toBe(null);
  });
});
