/**
 * The HOK-3023 leakage audit, run in CI on a real repository: one PR per `landed_by`
 * type, history that continues after every merge (including a backdated commit), and
 * captured evidence with post-merge reviews, dismissals, labels, renames and edits.
 * The same harness runs on development-repo PRs through `corpus-feature-replay`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CorpusPrRecord } from './enumerate.js';
import { chunkNumbers } from './feature-capture.js';
import { blankPostMergeRecord, differingColumns, replayRepo, runFeatureReplay, truncateCiAt, withPostMergeActivity, withPreMergeReview } from './feature-replay.js';
import { loadEvidenceChunk } from './feature-run.js';
import { extractPrFeatures, type CiEvidence, type PrEvidence } from './features.js';

const day = (n: number, hour = 12) => `2026-03-${String(n).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
const DEV = ['Dev', 'dev@example.com'] as const;
const OTHER = ['Other', 'other@example.com'] as const;

let work: string;
let root: string;
let repoDir: string;
const shas: Record<string, string> = {};
const records: CorpusPrRecord[] = [];
const evidence = new Map<number, PrEvidence>();

function git(args: string[], date = day(1), who: readonly [string, string] = DEV): string {
  return execFileSync('git', args, {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: who[0], GIT_AUTHOR_EMAIL: who[1], GIT_COMMITTER_NAME: who[0], GIT_COMMITTER_EMAIL: who[1] },
  }).trim();
}

function commit(name: string, path: string, content: string, message: string, date: string, who: readonly [string, string] = DEV): string {
  writeFileSync(join(work, path), content);
  git(['add', path], date, who);
  git(['commit', '-q', '-m', message], date, who);
  return (shas[name] = git(['rev-parse', 'HEAD']));
}

function pr(number: number, over: Partial<CorpusPrRecord>, merged: string): void {
  records.push({
    repo: 'org/repo', pr_number: number, pr_url: `https://github.com/org/repo/pull/${number}`, merged_at: merged, base_ref: 'main', head_sha: 'h', merge_sha: 'm', base_sha: 'b',
    member_commits: 1, landed_by: 'squash', batched: false, relanded_merge_shas: [], author_login: 'dev', author_type: 'User', labels: ['regression'], closing_issues: [], title: 'now', body: 'now',
    ...over,
  } as CorpusPrRecord);
  const created = new Date(Date.parse(merged) - 6 * 3_600_000).toISOString();
  const before = new Date(Date.parse(merged) - 3_600_000).toISOString();
  const after = new Date(Date.parse(merged) + 86_400_000).toISOString();
  // GitHub as it reads today: every PR was reviewed, relabelled, renamed and edited after merge.
  evidence.set(number, {
    pr_number: number,
    created_at: created,
    merged_at: merged,
    title: 'renamed after merge',
    body: 'edited after merge',
    head_ref: number % 2 ? 'claude/fix' : 'fix',
    reviews: [
      { id: `${number}-a`, state: 'DISMISSED', submitted_at: before, author: 'alice' },
      { id: `${number}-b`, state: 'COMMENTED', submitted_at: after, author: 'bob' },
    ],
    dismissals: [{ at: after, previous_state: 'APPROVED', review_id: `${number}-a` }],
    label_events: [
      { at: before, action: 'added', label: 'bug' },
      { at: after, action: 'removed', label: 'bug' },
      { at: after, action: 'added', label: 'regression' },
    ],
    renames: [{ at: after, from: 'at merge', to: 'renamed after merge' }],
    body_edits: [
      { at: created, body: 'at merge' },
      { at: after, body: 'edited after merge' },
    ],
    commits: [{ oid: `c${number}`, message: number % 2 ? 'work\n\nCo-Authored-By: Claude <noreply@anthropic.com>' : 'work', author_name: 'Dev', author_email: 'dev@example.com', author_login: 'dev' }],
  });
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'hok-3023-replay-work-'));
  root = mkdtempSync(join(tmpdir(), 'hok-3023-replay-cache-'));
  repoDir = join(root, 'org__repo');
  git(['init', '-q', '-b', 'main']);
  commit('root', 'app.py', 'def f():\n    return 1\n', 'init', day(1));
  commit('fix', 'app.py', 'def f():\n    if True:\n        return 1\n', 'fix: guard', day(2), OTHER);

  pr(1, { landed_by: 'squash', base_sha: shas['fix']!, merge_sha: commit('squash', 'app.py', 'def f():\n    return 2\n', 'feat: two (#1)', day(4)) }, day(4));
  pr(2, { landed_by: 'number_ref', base_sha: shas['squash']!, merge_sha: commit('ref', 'test_app.py', 'def test():\n    pass\n', 'add test (#2)', day(5)) }, day(5));
  commit('rebase1', 'app.py', 'def f():\n    return 3\n', 'one', day(6));
  pr(3, { landed_by: 'rebase', member_commits: 2, base_sha: shas['ref']!, merge_sha: commit('rebase2', 'other.txt', 'y\n', 'two', day(6)) }, day(6));

  const mergeBase = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'side'], day(7));
  commit('side', 'app.py', 'def f():\n    return 4\n', 'side work', day(7), OTHER);
  git(['checkout', '-q', 'main'], day(7));
  git(['merge', '-q', '--no-ff', '-m', 'Merge pull request #4', 'side'], day(7));
  pr(4, { landed_by: 'merge_commit', base_sha: mergeBase, merge_sha: (shas['merge'] = git(['rev-parse', 'HEAD'])) }, day(7));

  git(['checkout', '-q', '-b', 'rollup'], day(8));
  git(['checkout', '-q', '-b', 'm1'], day(8));
  commit('m1c', 'm1.txt', 'a\n', 'member one', day(8));
  git(['checkout', '-q', 'rollup'], day(8));
  git(['merge', '-q', '--no-ff', '-m', 'Rollup merge of #5', 'm1'], day(8));
  const member1 = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'm2'], day(8));
  commit('m2c', 'app.py', 'def f():\n    return 5\n', 'member two', day(8));
  git(['checkout', '-q', 'rollup'], day(8));
  git(['merge', '-q', '--no-ff', '-m', 'Rollup merge of #6', 'm2'], day(8));
  const member2 = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main'], day(8));
  git(['merge', '-q', '--no-ff', '-m', 'Auto merge of #7', 'rollup'], day(8));
  pr(5, { landed_by: 'rollup', batched: true, base_sha: shas['merge'], merge_sha: member1 }, day(8));
  pr(6, { landed_by: 'rollup', batched: true, base_sha: member1, merge_sha: member2 }, day(8));

  // History after every merge, including a commit that claims an earlier date.
  commit('later', 'app.py', 'def f():\n    return 6\n', 'fix: later\n\nCo-Authored-By: Claude <noreply@anthropic.com>', day(20), OTHER);
  commit('backdated', 'app.py', 'def f():\n    return 7\n', 'fix: claims an old date', day(2), DEV);

  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['clone', '-q', '--bare', work, join(repoDir, 'repo.git')]);
  writeFileSync(join(repoDir, 'enumeration.json'), JSON.stringify({ branch: 'main' }));
  writeFileSync(join(repoDir, 'prs.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  for (const kind of ['evidence', 'ci', 'timeline'] as const) mkdirSync(join(repoDir, 'feature-evidence', kind), { recursive: true });
  for (const chunk of chunkNumbers(records.map((record) => record.pr_number))) {
    const name = `${chunk[0]}-${chunk.at(-1)}.json.gz`;
    // As captured: the evidence batch carries no timeline events; the timeline batch does.
    const items = chunk.map((number) => ({ pr_number: number, value: { ...evidence.get(number)!, dismissals: [], label_events: [], renames: [] }, error: null }));
    writeFileSync(join(repoDir, 'feature-evidence', 'evidence', name), gzipSync(JSON.stringify({ captured_at: day(30), items })));
    const timeline = chunk.map((number) => {
      const { dismissals, label_events: labelEvents, renames } = evidence.get(number)!;
      return { pr_number: number, value: { pr_number: number, dismissals, label_events: labelEvents, renames }, error: null };
    });
    writeFileSync(join(repoDir, 'feature-evidence', 'timeline', name), gzipSync(JSON.stringify({ captured_at: day(30), items: timeline })));
  }
});

afterAll(() => {
  for (const dir of [work, root]) if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('replay on a real repository', () => {
  it('cuts git at each PR and finds every row byte-identical, for every landed_by type', () => {
    const result = replayRepo({ repo: 'org/repo', repoDir, seed: 'a'.repeat(64), cuts: 6, perCut: 6, log: () => {}, label: 'test' });
    expect(Object.keys(result.by_landed_by).sort()).toEqual(['merge_commit', 'number_ref', 'rebase', 'rollup', 'squash']);
    expect(result.items.filter((item) => item.replay.length || item.perturbed.length)).toEqual([]);
    expect(result.totals.replay_identical).toBe(result.totals.sampled);
    expect(result.totals.perturbed_identical).toBe(result.totals.sampled);
    expect(result.totals.control_changed).toBe(result.totals.sampled);
    // Every PR's current reviews and labels differ from merge time, so a leaky reading would show.
    expect(result.totals.leaky_reading_differs).toBe(result.totals.sampled);
  }, 60_000);

  it('keeps sampled PR numbers out of stdout and refuses an output inside a git work tree', () => {
    const slice = join(root, 'slice.json');
    writeFileSync(slice, JSON.stringify({ repos: ['org/sealed'] }));
    const stdout: string[] = [];
    const entries = [{ repo: 'org/repo' }, { repo: 'org/sealed' }] as never;
    const io = { writeStdout: (text: string) => stdout.push(text), writeStderr: () => {} };
    const out = join(root, 'out');
    expect(runFeatureReplay({ entries, cacheRoot: root, slicePath: slice, outDir: out, seed: 'b'.repeat(64), cuts: 5, perCut: 2, io, log: () => {} }).exitCode).toBe(0);
    const summary = JSON.parse(stdout.join('')) as { development_repos: number; totals: { sampled: number } };
    expect(summary.development_repos).toBe(1);
    expect(stdout.join('')).not.toMatch(/org\/repo|pr_number/);
    expect(readFileSync(join(out, 'replay-1.json'), 'utf8')).toContain('pr_number');
    expect(runFeatureReplay({ entries, cacheRoot: root, slicePath: slice, outDir: join(work, 'out'), cuts: 1, perCut: 1, io, log: () => {} }).exitCode).toBe(2);
  }, 60_000);
});

describe('loadEvidenceChunk', () => {
  it('takes timeline events from the timeline capture and fails closed without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hok-3023-chunk-'));
    try {
      for (const kind of ['evidence', 'timeline'] as const) mkdirSync(join(dir, 'feature-evidence', kind), { recursive: true });
      const value = { ...evidence.get(1)!, label_events: [] };
      writeFileSync(join(dir, 'feature-evidence', 'evidence', '1-2.json.gz'), gzipSync(JSON.stringify({ captured_at: day(30), items: [{ pr_number: 1, value, error: null }, { pr_number: 2, value: { ...value, pr_number: 2 }, error: null }] })));
      expect(() => loadEvidenceChunk(dir, [1, 2])).toThrow(/run --step timeline/);
      const events = { pr_number: 1, dismissals: [], renames: [], label_events: [{ at: day(3), action: 'added', label: 'bug' }] };
      writeFileSync(join(dir, 'feature-evidence', 'timeline', '1-2.json.gz'), gzipSync(JSON.stringify({ captured_at: day(31), items: [{ pr_number: 1, value: events, error: null }, { pr_number: 2, value: null, error: 'capture_failed' }] })));
      const loaded = loadEvidenceChunk(dir, [1, 2]);
      expect(loaded.evidence.get(1)!.label_events).toEqual(events.label_events);
      expect(loaded.evidence.get(2)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the canaries', () => {
  const record = { repo: 'org/repo', pr_number: 9, merged_at: day(10), merge_sha: 'm', base_sha: 'b', member_commits: 1, landed_by: 'squash', batched: false, relanded_merge_shas: [], author_login: 'dev', author_type: 'User', labels: [], closing_issues: [] } as unknown as CorpusPrRecord;
  const base: PrEvidence = {
    pr_number: 9, created_at: day(10, 6), merged_at: day(10), title: 't', body: 'b', head_ref: null,
    reviews: [{ id: 'r', state: 'APPROVED', submitted_at: day(10, 9), author: 'a' }], dismissals: [], label_events: [], renames: [], body_edits: [], commits: [],
  };
  const extract = (value: PrEvidence, ci: CiEvidence | null = null, over: CorpusPrRecord = record) => extractPrFeatures({ record: over, evidence: value, ci, git: {} });

  it('post-merge activity changes nothing', () => {
    expect(differingColumns(extract(base), extract(withPostMergeActivity(base, day(10))))).toEqual([]);
    expect(differingColumns(extract(base), extract(base, null, blankPostMergeRecord(record)))).toEqual([]);
  });

  it('one review before the merge is seen', () => {
    expect(differingColumns(extract(base), extract(withPreMergeReview(base, day(10))))).toContain('feature.process.review_count');
  });

  it('a CI result that finished after the merge is cut', () => {
    const ci: CiEvidence = { pr_number: 9, contexts: [{ at: day(10, 11), failed: false }, { at: day(11), failed: true }, { at: null, failed: true }] };
    expect(truncateCiAt(ci, day(10))!.contexts).toEqual([{ at: day(10, 11), failed: false }]);
    expect(differingColumns(extract(base, ci), extract(base, truncateCiAt(ci, day(10))))).toEqual([]);
  });

  it('reports the columns that differ, so a leak names itself', () => {
    const a = extract(base);
    const b = { ...a, features: { ...a.features, 'feature.process.github_label_count': 99 } };
    expect(differingColumns(a, b)).toEqual(['feature.process.github_label_count']);
  });
});
