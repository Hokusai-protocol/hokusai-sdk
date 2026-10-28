import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalHash, type ArbiterSurvivalLabelV1, type CorrectiveCandidateV1 } from '@hokusai/core';
import { harvestedSurvivalLabelFixture } from '../../../core/src/fixtures/arbiter-survival-label.js';
import { execArgvCommand } from '../shell-utils.js';
import type { CrossReference, GitRunner } from '../survival-labeller.js';
import { correctiveCorpusRepo, type CorrectiveCorpusRepoResult } from './corrective.js';
import type { IssueMeta } from './corrective-szz.js';
import type { CorpusPrRecord } from './enumerate.js';

const REPO = 'o/r';
const url = (n: number) => `https://github.com/${REPO}/pull/${n}`;
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../../../core/schemas/arbiter-corrective-rework.schema.json');
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(schemaPath, 'utf8')) as object);

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A linear main branch built commit by commit; each commit's date is its merge time. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-corrective-'));
  dirs.push(dir);
  const git = (args: string[], date = '2025-01-01T00:00:00Z') =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@x' },
    }).trim();
  git(['init', '-q', '-b', 'main']);
  const commit = (files: Record<string, string | null>, message: string, date: string) => {
    for (const [path, body] of Object.entries(files)) {
      if (body === null) git(['rm', '-q', path], date);
      else {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), body);
        git(['add', path], date);
      }
    }
    git(['commit', '-q', '--allow-empty', '-m', message], date);
    return git(['rev-parse', 'HEAD'], date);
  };
  const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { commit, runGit };
}

function record(n: number, base: string, merge: string, mergedAt: string, overrides: Partial<CorpusPrRecord> = {}): CorpusPrRecord {
  return {
    repo: REPO, pr_number: n, pr_url: url(n), merged_at: mergedAt, base_ref: 'main', head_sha: null,
    merge_sha: merge, base_sha: base, landed_sha: merge, member_commits: 1, landed_by: 'squash', batched: false,
    relanded_merge_shas: [], author_login: 'dev', author_type: 'User', labels: [], closing_issues: [],
    title: `Change ${n}`, body: '', ...overrides,
  };
}

function s2Row(prUrl: string, horizon: 14 | 30 | 60, missing = false): ArbiterSurvivalLabelV1 {
  const row: ArbiterSurvivalLabelV1 = structuredClone(harvestedSurvivalLabelFixture);
  row.prUrl = prUrl;
  row.horizon_days = horizon;
  if (missing) (row.outcome as { report_outcome: unknown }).report_outcome = null;
  return row;
}

describe('correctiveCorpusRepo', () => {
  let result: CorrectiveCorpusRepoResult;
  let originals: CorpusPrRecord[];
  const find = (original: number, proxy: string): CorrectiveCandidateV1[] =>
    result.candidates.filter((c) => c.original.pr_url === url(original) && c.proxy === proxy);

  beforeAll(() => {
    const { commit, runGit } = repo();
    const c0 = commit({ 'src/a.py': 'zero\n' }, 'base', '2025-01-01T00:00:00Z');
    const o1 = commit({ 'src/a.py': 'zero\none\ntwo\nthree\nfour\n' }, 'Add a (#1)', '2025-01-02T00:00:00Z');
    const o2 = commit({ 'src/b.py': 'bee\n' }, 'Add b (#2)', '2025-01-03T00:00:00Z');
    // #1's "two" and "three" are rewritten before any fix starts: half its lines survive.
    const o3 = commit({ 'src/a.py': 'zero\none\nTWO\nTHREE\nfour\n' }, 'Tidy a (#3)', '2025-01-04T00:00:00Z');
    const f4 = commit({ 'src/a.py': 'zero\none\nTWO\nTHREE\n', 'tests/test_a.py': 'ok\n', 'src/c.py': 'see\n' }, 'fix: crash in parser (#4)', '2025-01-05T00:00:00Z');
    // A merge bot's direct-pushed revert of #2, with a defect reason.
    commit({ 'src/b.py': null }, `Revert "Add b (#2)"\n\nThis reverts commit ${o2}.\n\nReverted ${url(2)} on behalf of https://github.com/bot due to breaks trunk`, '2025-01-06T00:00:00Z');
    // A collateral revert of #3: not a defect.
    const r2 = commit({ 'src/a.py': 'zero\none\ntwo\nthree\n' }, `Revert "Tidy a (#3)"\n\nThis reverts commit ${o3}.\n\nReverted ${url(3)} on behalf of https://github.com/x due to merge conflict with #99`, '2025-01-07T00:00:00Z');
    const d5 = commit({ 'deps.txt': 'v2\n' }, 'fix: bump lib (#5)', '2025-01-08T00:00:00Z');
    const p6 = commit({ 'docs.md': 'see\n' }, 'Update docs (#6)', '2025-01-09T00:00:00Z');
    const f7 = commit({ 'src/a.py': 'zero\none\ntwo\nthree\nfive\n' }, 'Handle edge case (#7)', '2025-01-10T00:00:00Z');
    const p8 = commit({ 'src/d.py': 'dee\n' }, 'Close tracker (#8)', '2025-01-11T00:00:00Z');
    // A bug fix rewriting #8's line (P3), and a fix closing a regression issue that reported #2 (P4).
    const c10 = commit({ 'docs/x.md': 'x\n' }, 'Added a thing (#10)', '2025-01-12T00:00:00Z');
    const s12 = commit({ 'src/d.py': 'DEE\n' }, 'Handle d (#12)', '2025-01-13T00:00:00Z');
    const s13 = commit({ 'src/e.py': 'e\n' }, 'Restore b (#13)', '2025-01-14T00:00:00Z');
    const s14 = commit({ 'src/d.py': 'DEE!\n' }, 'Tweak d (#14)', '2025-01-15T00:00:00Z');
    const late = commit({ 'src/a.py': 'zero\n' }, 'fix: late (#9)', '2025-04-01T00:00:00Z');
    originals = [
      record(1, c0, o1, '2025-01-02T00:00:00Z'),
      record(2, o1, o2, '2025-01-03T00:00:00Z'),
      record(3, o2, o3, '2025-01-04T00:00:00Z'),
      record(4, o3, f4, '2025-01-05T00:00:00Z', { title: 'fix: crash in parser', body: 'Regression from #1.', labels: ['backport:prev-minor'] }),
      record(5, r2, d5, '2025-01-08T00:00:00Z', { title: 'fix: bump lib', body: 'Fixes a regression from #1', author_login: 'dependabot[bot]' }),
      record(6, d5, p6, '2025-01-09T00:00:00Z', { title: 'Update docs', body: 'See #1 and other/repo#1' }),
      record(8, f7, p8, '2025-01-11T00:00:00Z', { title: 'Close tracker', closing_issues: [51] }),
      record(10, p8, c10, '2025-01-12T00:00:00Z', { title: 'Fixed #36001 -- Added a thing', body: 'Builds on top of #1 and was inadvertently fixed in #2. Adds regression tests for #3.' }),
    ];
    const laterPrs = [
      record(7, p6, f7, '2025-01-10T00:00:00Z', { title: 'Fix edge case', closing_issues: [50] }),
      record(11, f7, f7, '2025-01-10T00:00:00Z', { title: 'Bump pin', closing_issues: [50] }),
      record(9, s14, late, '2025-04-01T00:00:00Z', { title: 'fix: late', body: 'Regression from #1' }),
      record(12, c10, s12, '2025-01-13T00:00:00Z', { title: 'Handle d', closing_issues: [60] }),
      record(13, s12, s13, '2025-01-14T00:00:00Z', { title: 'Restore b', closing_issues: [61, 62] }),
      // Closes a bug-bash issue: not a bug report, so no blame.
      record(14, s13, s14, '2025-01-15T00:00:00Z', { title: 'Tweak d', closing_issues: [63] }),
    ];
    const issue = (n: number, labels: string[], type: string | null = null): [number, IssueMeta] => [n, { url: `https://github.com/${REPO}/issues/${n}`, labels, type }];
    const issues = new Map([issue(50, []), issue(51, []), issue(60, ['triaged'], 'Bug'), issue(61, ['regression']), issue(62, ['not a regression']), issue(63, ['bug-bash'])]);
    const ref = (issue: number, at: string): CrossReference => ({
      createdAtEpoch: Date.parse(at) / 1000, url: `https://github.com/${REPO}/issues/${issue}`, sourceAuthorLogin: null, sourceAuthorType: null, sourceBaseRef: null,
    });
    // Issue 50 reported #1 after it merged; issue 51 tracked #1 before it merged.
    const crossReferences = new Map([
      [1, [ref(50, '2025-01-09T00:00:00Z'), ref(51, '2025-01-01T12:00:00Z')]],
      [2, [ref(61, '2025-01-10T00:00:00Z'), ref(62, '2025-01-10T00:00:00Z')]],
    ]);
    const s2Rows = [s2Row(url(1), 14), s2Row(url(1), 60), s2Row(url(2), 14), s2Row(url(3), 14), s2Row(url(6), 14, true)];
    result = correctiveCorpusRepo(
      { repo: REPO, branch: 'main', originals, laterPrs, from: new Date('2025-01-01T00:00:00Z'), asOf: new Date('2025-06-01T00:00:00Z'), crossReferences, issues, szz: true, s2Rows },
      { runGit, now: () => new Date('2025-06-02T00:00:00Z') },
    );
  });

  it('every record validates against the contract schema', () => {
    for (const record of [...result.candidates, ...result.repairPairs, ...result.corrective]) {
      expect(validate(record), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('links a fix that cites the original with a fix signal (P2), whatever its backport request label', () => {
    const [candidate] = find(1, 'repair_reference').filter((c) => c.fix.pr_url === url(4));
    expect(candidate?.status).toBe('accepted');
    expect(candidate?.evidence.map((e) => e.kind).sort()).toEqual(['cites_original_pr', 'fix_title_prefix', 'regression_in_marker']);
    expect(candidate?.lag_seconds).toBe(3 * 86_400);
  });

  it('needs regression wording at the citation, not just a fix title', () => {
    expect(result.candidates.some((c) => c.fix.pr_url === url(10))).toBe(false);
  });

  it('links a direct-pushed revert commit to the PR it reverts (P1)', () => {
    const [candidate] = find(2, 'revert');
    expect(candidate).toMatchObject({ status: 'accepted', fix: { pr_url: null } });
    expect(candidate?.evidence[0]?.kind).toBe('revert_message');
  });

  it('records the class of the reason a bot gave for a revert', () => {
    expect(find(2, 'revert')[0]?.evidence).toContainEqual({ kind: 'revert_reason', ref: 'public_ci', count: null });
  });

  it('blames a bug fix back to the original that landed the lines it rewrites (P3)', () => {
    const [candidate] = find(8, 'szz');
    expect(candidate).toMatchObject({ status: 'accepted', confidence: 'medium', fix: { pr_url: url(12) } });
    expect(candidate?.evidence).toEqual([
      { kind: 'closes_bug_issue', ref: `https://github.com/${REPO}/issues/60`, count: null },
      { kind: 'blamed_lines', ref: originals.find((o) => o.pr_number === 8)!.merge_sha, count: 1 },
    ]);
    // #14 rewrites #12's line too, but closes only a bug-bash issue, and #12 is not an original.
    expect(result.candidates.some((c) => c.fix.pr_url === url(14))).toBe(false);
  });

  it('links a fix closing a regression issue that reported the original (P4), not a "not a regression" one', () => {
    const p4 = find(2, 'regression_issue');
    expect(p4.map((c) => [c.fix.pr_url, c.status, c.evidence.map((e) => e.kind)])).toEqual([
      [url(13), 'accepted', ['regression_issue_label', 'closes_issue_citing_original']],
    ]);
    expect(p4[0]?.evidence[1]?.ref).toBe(`https://github.com/${REPO}/issues/61`);
  });

  it('rejects a collateral revert as revert_non_defect', () => {
    expect(find(3, 'revert').map((c) => c.exclusion_code)).toEqual(['revert_non_defect']);
  });

  it('rejects a dependency bot fix', () => {
    expect(result.candidates.filter((c) => c.fix.pr_url === url(5)).map((c) => c.exclusion_code)).toEqual(['dependency_bot']);
  });

  it('ignores citations without a fix signal and other repos’ numbers', () => {
    expect(result.candidates.some((c) => c.fix.pr_url === url(6))).toBe(false);
  });

  it('links a fix closing an issue that cited the original after it merged, not a tracking issue or a non-fix', () => {
    expect(find(1, 'repair_reference').filter((c) => c.fix.pr_url === url(7)).map((c) => c.evidence[0]?.kind)).toEqual(['closes_issue_citing_original']);
    expect(result.candidates.some((c) => c.fix.pr_url === url(8))).toBe(false);
    expect(result.candidates.some((c) => c.fix.pr_url === url(11))).toBe(false);
  });

  it('drops fixes later than the longest horizon', () => {
    expect(result.candidates.some((c) => c.fix.pr_url === url(9))).toBe(false);
  });

  it('measures repair pairs from git', () => {
    const pair = result.repairPairs.find((p) => p.fix.pr_url === url(4))!;
    expect(pair.files).toEqual({
      original: ['src/a.py'],
      fix: ['src/a.py', 'src/c.py', 'tests/test_a.py'],
      fix_only: ['src/c.py', 'tests/test_a.py'],
      original_only: [],
      fix_preexisting: ['src/a.py'],
    });
    expect(pair.fix_tests).toEqual({ added: 1, modified: 0, deleted: 0 });
    // #1 added one, two, three, four; #3 rewrote two and three before the fix.
    expect(pair.line_survival).toBe(0.5);
    expect(result.failedPairs).toEqual([]);
  });

  it('derives one corrective row per S2 row from accepted pairs only', () => {
    const rows = new Map(result.corrective.map((r) => [`${r.prUrl}@${r.horizon_days}`, r]));
    expect(rows.get(`${url(1)}@14`)).toMatchObject({ corrective: true, confidence: 'high', reason_codes: ['repair_reference'] });
    expect(rows.get(`${url(2)}@14`)).toMatchObject({ corrective: true, reason_codes: ['revert', 'regression_issue'] });
    expect(rows.get(`${url(3)}@14`)).toMatchObject({ corrective: false, reason_codes: ['no_accepted_fix'] });
    expect(rows.get(`${url(6)}@14`)).toMatchObject({ corrective: null, reason_codes: ['base_label_missing'] });
    expect(rows.get(`${url(1)}@14`)?.base_label_hash).toBe(canonicalHash(s2Row(url(1), 14)));
    expect(result.corrective).toHaveLength(5);
  });

  it('writes no titles or bodies into any record', () => {
    const text = JSON.stringify([...result.candidates, ...result.repairPairs, ...result.corrective]);
    for (const fragment of ['crash in parser', 'Regression from', 'merge conflict', 'breaks trunk', 'Update docs']) expect(text).not.toContain(fragment);
  });
});
