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

function record(overrides: Partial<CorpusPrRecord>): CorpusPrRecord {
  return {
    repo: 'org/repo', pr_number: 1, pr_url: 'https://github.com/org/repo/pull/1', merged_at: '2025-01-02T00:00:01Z',
    base_ref: 'main', head_sha: null, merge_sha: 'x', base_sha: 'y', member_commits: 1, landed_by: 'squash', batched: false, relanded_merge_shas: [],
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
