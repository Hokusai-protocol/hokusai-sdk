import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ArbiterSurvivalLabelV1, CorrectiveCandidateV1, CorrectiveReworkLabelV1 } from '@hokusai/core';
import { harvestedSurvivalLabelFixture } from '../../../core/src/fixtures/arbiter-survival-label.js';
import { runCorpusCli, writeJsonl } from './cli.js';
import { conventionSpread, renderCorpusReportMarkdown, sanityFlags, summarizeCorpusRepo, type RepoSummary } from './report.js';

const url = (n: number) => `https://github.com/o/r/pull/${n}`;

function s2(n: number, horizon: number, outcome: ArbiterSurvivalLabelV1['outcome']['report_outcome']): ArbiterSurvivalLabelV1 {
  return { ...harvestedSurvivalLabelFixture, prUrl: url(n), horizon_days: horizon, outcome: { ...harvestedSurvivalLabelFixture.outcome, report_outcome: outcome } } as ArbiterSurvivalLabelV1;
}

function candidate(id: string, proxy: CorrectiveCandidateV1['proxy'], lagDays: number, extra: Partial<CorrectiveCandidateV1> = {}): CorrectiveCandidateV1 {
  return { candidate_id: id, proxy, lag_seconds: lagDays * 86_400, status: 'accepted', exclusion_code: null, evidence: [], ...extra } as CorrectiveCandidateV1;
}

function row(n: number, horizon: number, corrective: boolean | null, reasons: string[], pairs: string[] = []): CorrectiveReworkLabelV1 {
  return { prUrl: url(n), horizon_days: horizon, corrective, reason_codes: reasons, repair_pair_ids: pairs } as CorrectiveReworkLabelV1;
}

/** Four PRs, labelled at 14 and 30 days: #1 reverted (P1), #2 SZZ on one blamed line, #3 clean, #4 missing its base label. */
function fixture(): RepoSummary {
  const horizons = [14, 30];
  return summarizeCorpusRepo({
    repo: 'o/r',
    mergeConvention: 'squash',
    s2Rows: horizons.flatMap((h) => [s2(1, h, 'reverted'), s2(2, h, 'followup'), s2(3, h, 'survived'), s2(4, h, null)]),
    candidates: [
      candidate('rev', 'revert', 3, { evidence: [{ kind: 'revert_reason', ref: 'public_ci', count: null }] }),
      candidate('szz', 'szz', 20, { evidence: [{ kind: 'blamed_lines', ref: 'abc', count: 1 }] }),
      candidate('big', 'szz', 5, { status: 'rejected', exclusion_code: 'fix_too_large' }),
      candidate('bad', 'repair_reference', 25, { status: 'rejected', exclusion_code: 'linkage_error' }),
    ],
    correctiveRows: [
      row(1, 14, true, ['revert'], ['rev']),
      row(2, 14, false, ['no_accepted_fix']),
      row(3, 14, false, ['no_accepted_fix']),
      row(4, 14, null, ['base_label_missing']),
      row(1, 30, true, ['revert'], ['rev']),
      row(2, 30, true, ['szz'], ['szz']),
      row(3, 30, false, ['no_accepted_fix']),
      row(4, 30, null, ['base_label_missing']),
    ],
  });
}

describe('summarizeCorpusRepo', () => {
  const summary = fixture();
  const at = (h: number) => summary.horizons.find((s) => s.horizon_days === h)!;

  it('rates corrective rows over labelled rows only, with a Wilson interval', () => {
    expect(at(30)).toMatchObject({ prs: 4, corrective: { true: 2, false: 1, null: 1 }, corrective_rate: 0.6667 });
    expect(at(30).corrective_rate_ci95!.low).toBeLessThan(0.6667);
    expect(at(30).corrective_rate_ci95!.high).toBeGreaterThan(0.6667);
    expect(at(30).s2_outcomes).toEqual({ followup: 1, missing: 1, reverted: 1, survived: 1 });
  });

  it('credits each proxy with the rows it supports, and reports the high-precision and SZZ-minimum sensitivities', () => {
    expect(at(30).proxy_contribution.revert).toEqual({ rows: 1, sole: 1 });
    expect(at(30).proxy_contribution.szz).toEqual({ rows: 1, sole: 1 });
    expect(at(30).corrective_rate_high_precision).toBe(0.3333);
    expect(at(30).corrective_rate_szz_min_lines).toBe(0.3333);
  });

  it('counts rejections by reason and proxy among candidates within the horizon, with linkage_error apart', () => {
    expect(at(14).candidates).toEqual({ total: 2, rejected: 1, rejection_rate: 0.5 });
    expect(at(30).candidates).toEqual({ total: 4, rejected: 2, rejection_rate: 0.5 });
    expect(at(30).rejections_by_reason).toEqual({ fix_too_large: 1, linkage_error: 1 });
    expect(at(30).rejections_by_proxy.szz).toEqual({ total: 2, rejected: 1, rejection_rate: 0.5 });
    expect(at(30).linkage_error).toEqual({ rejected: 1, rate: 0.25 });
    expect(summary.revert_reasons).toEqual({ public_ci: 1 });
  });
});

describe('sanityFlags', () => {
  const repo = (name: string, rate: number, convention = 'squash'): RepoSummary =>
    ({ repo: name, merge_convention: convention, horizons: [{ horizon_days: 30, corrective_rate: rate, corrective_rate_high_precision: rate }] }) as unknown as RepoSummary;

  it('flags degenerate and churn rates only', () => {
    const flags = sanityFlags([repo('a/low', 0.004), repo('a/mid', 0.02), repo('a/high', 0.3), repo('b/solo', 0.4, 'rollup')]);
    expect(flags.map((f) => [f.code, f.repos])).toEqual([
      ['degenerate_rate', ['a/low']],
      ['churn_rate', ['a/high']],
      ['churn_rate', ['b/solo']],
    ]);
    expect(flags.every((f) => f.resolution === null)).toBe(true);
  });

  it('resolves a flag from its note', () => {
    const [flag] = sanityFlags([repo('a/x', 0.3)], [{ code: 'churn_rate', repo: 'a/x', action: 'dropped', note: 'why' }]);
    expect(flag!.resolution).toEqual({ action: 'dropped', note: 'why' });
  });
});

describe('conventionSpread', () => {
  it('reports the lowest and highest 30-day rate per convention, without flagging a wide spread', () => {
    const repo = (name: string, rate: number, hp: number, convention: string): RepoSummary =>
      ({ repo: name, merge_convention: convention, horizons: [{ horizon_days: 30, corrective_rate: rate, corrective_rate_high_precision: hp }] }) as unknown as RepoSummary;
    const repos = [repo('a/x', 0.01, 0.006, 'squash'), repo('a/y', 0.05, 0.04, 'squash'), repo('b/z', 0.03, 0.01, 'rollup')];
    expect(conventionSpread(repos)).toEqual([
      { merge_convention: 'rollup', repos: 1, low: { repo: 'b/z', rate: 0.03 }, high: { repo: 'b/z', rate: 0.03 }, high_precision: { low: 0.01, high: 0.01 } },
      { merge_convention: 'squash', repos: 2, low: { repo: 'a/x', rate: 0.01 }, high: { repo: 'a/y', rate: 0.05 }, high_precision: { low: 0.006, high: 0.04 } },
    ]);
    expect(sanityFlags(repos)).toEqual([]);
  });
});

describe('renderCorpusReportMarkdown', () => {
  it('writes a row per repo × horizon and marks unresolved flags', () => {
    const repos = [fixture()];
    const md = renderCorpusReportMarkdown({ run_id: 'r1', as_of: '2026-10-20', repos, flags: sanityFlags(repos) });
    expect(md.split('\n').filter((l) => l.startsWith('| o/r |'))).toHaveLength(3);
    expect(md).toContain('| o/r | squash | 30 | 4 | 33.3% | 66.7% |');
    expect(md).toContain('**churn_rate** (o/r)');
    expect(md).toContain('**unresolved**');
  });
});

describe('corpus-report CLI', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  function corpus(asOf: string) {
    const dir = mkdtempSync(join(tmpdir(), 'corpus-report-'));
    dirs.push(dir);
    const repoDir = join(dir, 'cache', 'o__r');
    mkdirSync(repoDir, { recursive: true });
    const envelope = { as_of: asOf, definition_version: 'cr-0.1.0', labeller_version: '1.0.0' };
    writeJsonl(join(repoDir, 's2.jsonl.gz'), [s2(1, 30, 'survived'), s2(2, 30, 'reverted')], { gzip: true });
    writeJsonl(join(repoDir, 'candidates.jsonl.gz'), [{ ...candidate('rev', 'revert', 2), envelope }], { gzip: true });
    writeJsonl(join(repoDir, 'repair_pairs.jsonl.gz'), [{ candidate_id: 'rev' }], { gzip: true });
    writeJsonl(join(repoDir, 'corrective.jsonl.gz'), [{ ...row(1, 30, false, ['no_accepted_fix']), envelope }, { ...row(2, 30, true, ['revert'], ['rev']), envelope }], { gzip: true });
    const manifest = { manifest_version: '0.1.0', window: { merged_from: '2025-01-01', merged_until: '2025-06-01' }, repos: [{ repo: 'o/r', status: 'kept', observed_merge_convention: 'squash' }], alternates: [] };
    writeFileSync(join(dir, 'cohort.json'), JSON.stringify(manifest));
    return dir;
  }
  const run = (dir: string, extra: string[] = []) => {
    const out: string[] = [];
    const err: string[] = [];
    const { exitCode } = runCorpusCli('corpus-report', ['--manifest', 'cohort.json', '--cache-dir', 'cache', '--as-of', '2026-10-20T00:00:00Z', '--out', 'out', ...extra], {
      cwd: dir,
      writeStdout: (t) => out.push(t),
      writeStderr: (t) => err.push(t),
    });
    return { exitCode, out: out.join(''), err: err.join('') };
  };

  it('writes the report and a run manifest whose ID depends only on the inputs, and exits 1 while a flag is unresolved', () => {
    const dir = corpus('2026-10-20T00:00:00Z');
    const first = run(dir);
    expect(first.exitCode).toBe(1); // a 50% rate is a churn flag
    const manifest = JSON.parse(readFileSync(join(dir, 'out', 'run-manifest.json'), 'utf8'));
    expect(manifest.inputs.map((i: { file: string; rows: number }) => [i.file, i.rows])).toEqual([
      ['s2.jsonl.gz', 2],
      ['candidates.jsonl.gz', 1],
      ['corrective.jsonl.gz', 2],
      ['repair_pairs.jsonl.gz', 1],
    ]);
    expect(manifest.label_versions.corrective).toEqual(['schema undefined, definition cr-0.1.0, labeller 1.0.0']);
    expect(readFileSync(join(dir, 'out', 'corpus-report.md'), 'utf8')).toContain('**churn_rate** (o/r)');
    expect(run(dir).out).toContain(`"run_id":"${manifest.run_id}"`);

    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ notes: [{ code: 'churn_rate', repo: 'o/r', action: 'explained', note: 'tiny fixture' }] }));
    expect(run(dir, ['--notes', 'notes.json']).exitCode).toBe(0);
  });

  it('refuses outputs labelled at a different as-of', () => {
    const result = run(corpus('2026-09-01T00:00:00Z'));
    expect(result.exitCode).toBe(3);
    expect(result.err).toContain('not 2026-10-20');
  });
});
