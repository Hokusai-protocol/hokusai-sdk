/**
 * Git columns against a real repository, with one PR per `landed_by` type and
 * commits placed to catch leakage: a later commit to the same file, and a commit
 * that lands later but claims an earlier date.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CorpusPrRecord } from './enumerate.js';
import { buildHistoryIndex, gitColumns, parseRawNumstat, type HistoryIndex } from './feature-git.js';

const day = (n: number) => `2026-03-${String(n).padStart(2, '0')}T12:00:00Z`;
const DEV = ['Dev', 'dev@example.com'] as const;
const OTHER = ['Other', 'other@example.com'] as const;

let repo: string;
let index: HistoryIndex;
const shas: Record<string, string> = {};

function git(args: string[], date = day(1), who: readonly [string, string] = DEV): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: who[0], GIT_AUTHOR_EMAIL: who[1], GIT_COMMITTER_NAME: who[0], GIT_COMMITTER_EMAIL: who[1] },
  }).trim();
}

function commit(name: string, path: string, content: string, subject: string, date: string, who: readonly [string, string] = DEV): void {
  writeFileSync(join(repo, path), content);
  git(['add', path], date, who);
  git(['commit', '-q', '-m', subject], date, who);
  shas[name] = git(['rev-parse', 'HEAD']);
}

const record = (over: Partial<CorpusPrRecord>): CorpusPrRecord => ({
  repo: 'org/repo', pr_number: 1, pr_url: '', merged_at: day(10), base_ref: 'main', head_sha: 'h', merge_sha: 'm', base_sha: 'b',
  member_commits: 1, landed_by: 'squash', batched: false, relanded_merge_shas: [], author_login: 'dev', author_type: 'User', labels: [], closing_issues: [], title: '', body: '',
  ...over,
} as CorpusPrRecord);

const columns = (over: Partial<CorpusPrRecord>, emails: string[] | null = ['dev@example.com']) => gitColumns({ index, gitDir: repo, record: record(over), authorEmails: emails });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'hok-3023-git-'));
  git(['init', '-q', '-b', 'main']);
  commit('root', 'app.py', 'def f():\n    return 1\n', 'init', day(1));
  commit('otherFix', 'app.py', 'def f():\n    if True:\n        return 1\n', 'fix: guard', day(2), OTHER);

  // squash: one commit, parent on the line.
  commit('squashBase', 'other.txt', 'x\n', 'chore: other', day(3));
  commit('squash', 'app.py', 'def f():\n    if True:\n        if True:\n            return 1\n', 'feat: nest (#1)', day(4));

  // number_ref: the same shape, found by the number in the subject.
  commit('numberRef', 'new_test.py', 'def test():\n    pass\n', 'add test (#2)', day(5));

  // rebase: two commits on the line; base is before the first.
  commit('rebase1', 'app.py', 'def f():\n    return 2\n', 'one', day(6));
  commit('rebase2', 'other.txt', 'y\n', 'two', day(6));

  // merge_commit: a side branch, merged with --no-ff.
  shas['mergeBase'] = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'side'], day(7));
  commit('side1', 'side.txt', 'a\n', 'side work', day(7), OTHER);
  git(['checkout', '-q', 'main'], day(7));
  git(['merge', '-q', '--no-ff', '-m', 'Merge pull request #3', 'side'], day(7));
  shas['merge'] = git(['rev-parse', 'HEAD']);

  // rollup: members merged on a side branch, which then lands as one commit.
  shas['rollupBase'] = shas['merge']!;
  git(['checkout', '-q', '-b', 'rollup'], day(8));
  git(['checkout', '-q', '-b', 'm1'], day(8));
  commit('m1c', 'm1.txt', 'a\n', 'member one', day(8));
  git(['checkout', '-q', 'rollup'], day(8));
  git(['merge', '-q', '--no-ff', '-m', 'Rollup merge of #4', 'm1'], day(8));
  shas['member1'] = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'm2'], day(8));
  commit('m2c', 'app.py', 'def f():\n    return 3\n', 'member two', day(8));
  git(['checkout', '-q', 'rollup'], day(8));
  git(['merge', '-q', '--no-ff', '-m', 'Rollup merge of #5', 'm2'], day(8));
  shas['member2'] = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main'], day(8));
  git(['merge', '-q', '--no-ff', '-m', 'Auto merge of #6', 'rollup'], day(8));
  shas['rollup'] = git(['rev-parse', 'HEAD']);

  // Leakage traps, after every PR above has landed.
  commit('later', 'app.py', 'def f():\n    return 4\n', 'fix: later', day(20), OTHER);
  commit('backdated', 'app.py', 'def f():\n    return 5\n', 'fix: claims an old date', day(2));

  index = buildHistoryIndex(repo, 'refs/heads/main', join(repo, '.git', 'scratch'), new Set([shas['squash']!]));
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('each landed_by type', () => {
  it('squash: diff and history from its parent', () => {
    expect(columns({ landed_by: 'squash', base_sha: shas['squashBase']!, merge_sha: shas['squash']!, merged_at: day(4) })).toMatchObject({
      'feature.shape.files_touched': 1,
      'feature.shape.tests_changed': false,
      'feature.shape.complexity_delta': 1,
      'feature.history.new_files': 0,
      'feature.history.file_commits_90d': 2,
      'feature.history.file_authors_90d': 2,
      'feature.history.file_fix_commits_90d': 1,
      'feature.history.newest_file_age_days': 3,
      'feature.author.repo_commits_prior': 2,
      'feature.author.touched_file_commits_prior': 1,
    });
  });

  it('number_ref: a new file has no age and counts as new', () => {
    expect(columns({ landed_by: 'number_ref', base_sha: shas['squash']!, merge_sha: shas['numberRef']!, merged_at: day(5) })).toMatchObject({
      'feature.shape.files_touched': 1,
      'feature.shape.tests_changed': true,
      'feature.history.new_files': 1,
      'feature.history.file_commits_90d': 0,
      'feature.history.newest_file_age_days': null,
    });
  });

  it('rebase: the diff spans every member commit', () => {
    expect(columns({ landed_by: 'rebase', member_commits: 2, base_sha: shas['numberRef']!, merge_sha: shas['rebase2']!, merged_at: day(6) })['feature.shape.files_touched']).toBe(2);
  });

  it('merge_commit: only the PR\'s own change', () => {
    const result = columns({ landed_by: 'merge_commit', base_sha: shas['mergeBase']!, merge_sha: shas['merge']!, merged_at: day(7) });
    expect(result['feature.shape.files_touched']).toBe(1);
    expect(result['feature.history.new_files']).toBe(1);
  });

  it('rollup: a later member sees history up to before the rollup landed, and its own diff', () => {
    const result = columns({ landed_by: 'rollup', base_sha: shas['member1']!, merge_sha: shas['member2']!, merged_at: day(8) });
    expect(result['feature.shape.files_touched']).toBe(1);
    // app.py before the rollup: root, otherFix, squash, rebase1. Nothing from the rollup itself.
    expect(result['feature.history.file_commits_90d']).toBe(4);
  });
});

describe('leakage', () => {
  it('ignores a later commit to the same file, and one that lands later with an old date', () => {
    const result = columns({ base_sha: shas['squashBase']!, merge_sha: shas['squash']!, merged_at: day(4) });
    // The two later "fix:" commits touch app.py and are dated in or before the window.
    expect(result['feature.history.file_fix_commits_90d']).toBe(1);
    expect(result['feature.history.file_commits_90d']).toBe(2);
  });

  it('never credits an author with commits from after the base', () => {
    expect(columns({ base_sha: shas['otherFix']!, merge_sha: shas['squashBase']!, merged_at: day(3) })['feature.author.repo_commits_prior']).toBe(1);
  });
});

describe('unknowns', () => {
  it('writes null author columns when the author\'s email is unknown and nothing supplies one', () => {
    const result = columns({ base_sha: shas['mergeBase']!, merge_sha: shas['merge']!, merged_at: day(7) }, null);
    expect(result['feature.author.repo_commits_prior']).toBeNull();
    expect(result['feature.author.touched_file_commits_prior']).toBeNull();
  });

  it('falls back to the landing commit\'s email for a squash', () => {
    expect(columns({ base_sha: shas['squashBase']!, merge_sha: shas['squash']!, merged_at: day(4) }, null)['feature.author.repo_commits_prior']).toBe(2);
  });

  it('writes no diff columns for a commit git cannot find', () => {
    expect(columns({ base_sha: '1'.repeat(40), merge_sha: shas['squash']! })).toEqual({});
  });

  it('keeps the landing message only for commits it was asked about', () => {
    expect(index.landingMessages.get(shas['squash']!)).toBe('feat: nest (#1)');
    expect(index.landingMessages.has(shas['root']!)).toBe(false);
  });
});

describe('parseRawNumstat', () => {
  it('reads paths with tabs and counts binary files as zero lines', () => {
    const zero = '0'.repeat(40);
    const output = [`:000000 100644 ${zero} ${'a'.repeat(40)} A`, 'a\tb.txt', `:100644 100644 ${'b'.repeat(40)} ${'c'.repeat(40)} M`, 'x.png', '3\t1\ta\tb.txt', '-\t-\tx.png', ''].join('\0');
    expect(parseRawNumstat(output)).toEqual([
      { path: 'a\tb.txt', status: 'A', oldOid: zero, newOid: 'a'.repeat(40), added: 3, deleted: 1 },
      { path: 'x.png', status: 'M', oldOid: 'b'.repeat(40), newOid: 'c'.repeat(40), added: 0, deleted: 0 },
    ]);
  });
});
