import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CorrectiveCandidateV1, CorrectiveReworkLabelV1 } from '@hokusai/core';
import {
  classifyCalibrationRepo,
  cohensKappa,
  drawCalibrationSample,
  parseCalibrationPlan,
  parseCsv,
  parseLabelSheet,
  renderCalibrationMarkdown,
  renderLabelSheet,
  scoreCalibration,
  type CalibrationPlan,
  type HumanLabel,
  type PopulationUnit,
  type SampleCell,
  type SampleItem,
} from './calibration.js';
import { runCorpusCli, writeJsonl } from './cli.js';

const SEED = 'a'.repeat(64);
const url = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;

const plan: CalibrationPlan = parseCalibrationPlan({
  plan_version: 'test',
  horizon_days: 30,
  allocation: { revert: 2, repair_reference: 2, regression_issue: 2, szz_strong: 2, szz_weak: 2, rejected: 2, negative: 4 },
  double_label_share: 0.5,
  min_repos: 2,
  szz_strong_min_lines: 3,
  kappa_floor: 0.6,
  definition_precision_floor: 0.8,
});

function candidate(repo: string, original: number, fix: number, proxy: CorrectiveCandidateV1['proxy'], extra: Partial<CorrectiveCandidateV1> & { lines?: number; reason?: string } = {}): CorrectiveCandidateV1 {
  const { lines, reason, ...rest } = extra;
  const evidence = [
    ...(lines !== undefined ? [{ kind: 'blamed_lines', ref: 'x', count: lines }] : []),
    ...(reason ? [{ kind: 'revert_reason', ref: reason, count: null }] : []),
    { kind: 'cites_original_pr', ref: url(repo, original), count: null },
  ];
  return {
    candidate_id: `${repo}#${original}>${fix}:${proxy}`,
    original: { pr_url: url(repo, original), merge_sha: 'm', merged_at: '2025-01-01T00:00:00Z' },
    fix: { pr_url: url(repo, fix), sha: `sha${fix}`, merged_at: '2025-01-05T00:00:00Z' },
    lag_seconds: 4 * 86_400,
    proxy,
    status: 'accepted',
    exclusion_code: null,
    evidence,
    envelope: { as_of: '2026-10-20T00:00:00Z' },
    ...rest,
  } as CorrectiveCandidateV1;
}

function row(repo: string, n: number, corrective: boolean | null, pairs: string[] = [], horizon = 30): CorrectiveReworkLabelV1 {
  return { prUrl: url(repo, n), horizon_days: horizon, corrective, repair_pair_ids: pairs, reason_codes: [] } as unknown as CorrectiveReworkLabelV1;
}

describe('classifyCalibrationRepo', () => {
  const repo = 'o/r';
  const rev = candidate(repo, 1, 101, 'revert');
  const szzOn1 = candidate(repo, 1, 102, 'szz', { lines: 9 });
  const strong = candidate(repo, 2, 103, 'szz', { lines: 5 });
  const weak = candidate(repo, 3, 104, 'szz', { lines: 2 });
  const rejected = candidate(repo, 4, 105, 'repair_reference', { status: 'rejected', exclusion_code: 'backport' });
  const late = candidate(repo, 5, 106, 'revert', { lag_seconds: 45 * 86_400 });
  const units = classifyCalibrationRepo({
    repo,
    horizonDays: 30,
    szzStrongMinLines: 3,
    candidates: [rev, szzOn1, strong, weak, rejected, late],
    correctiveRows: [
      row(repo, 1, true, [rev.candidate_id, szzOn1.candidate_id]),
      row(repo, 2, true, [strong.candidate_id]),
      row(repo, 3, true, [weak.candidate_id]),
      row(repo, 4, false),
      row(repo, 5, false),
      row(repo, 6, null),
      row(repo, 1, true, [rev.candidate_id], 14),
    ],
  });
  const by = (n: number) => units.find((u) => u.pr_url === url(repo, n));

  it('puts each labelled PR in one stratum, by its highest-precision proxy and the SZZ line split', () => {
    expect(units.map((u) => [u.pr_url.split('/').pop(), u.stratum])).toEqual([
      ['1', 'revert'],
      ['2', 'szz_strong'],
      ['3', 'szz_weak'],
      ['4', 'rejected'],
      ['5', 'negative'],
    ]);
    expect(by(1)!.proxies).toEqual(['revert', 'szz']);
  });

  it('keeps only candidates within the horizon, with the evidence the definition variants need', () => {
    expect(by(5)!.candidates).toEqual([]);
    expect(by(2)!.candidates[0]).toMatchObject({ blamed_lines: 5, fix_url: url(repo, 103), lag_days: 4 });
  });
});

function population(repos: string[], perStratum: number): PopulationUnit[] {
  const strata = ['revert', 'repair_reference', 'regression_issue', 'szz_strong', 'szz_weak', 'rejected', 'negative'] as const;
  let n = 0;
  return repos.flatMap((repo) =>
    strata.flatMap((stratum) =>
      Array.from({ length: stratum === 'negative' ? perStratum * 10 : perStratum }, () => {
        n++;
        const proxy = stratum.startsWith('szz') ? 'szz' : stratum;
        const positive = stratum !== 'rejected' && stratum !== 'negative';
        return {
          repo,
          pr_url: url(repo, n),
          stratum,
          proxies: positive ? [proxy] : [],
          candidates:
            stratum === 'negative'
              ? []
              : [{ candidate_id: `c${n}`, proxy: stratum === 'rejected' ? 'repair_reference' : proxy, status: positive ? 'accepted' : 'rejected', exclusion_code: positive ? null : 'backport', fix_url: url(repo, n + 10_000), lag_days: 3, blamed_lines: stratum === 'szz_weak' ? 1 : 4, revert_reason: null }],
        } as PopulationUnit;
      }),
    ),
  );
}

describe('drawCalibrationSample', () => {
  const units = population(['a/one', 'b/two', 'c/three'], 3);
  const sample = drawCalibrationSample(units, plan, SEED);

  it('meets each allocation, spreading every stratum across repos', () => {
    expect(sample.items).toHaveLength(16);
    expect(sample.shortfalls).toEqual([]);
    const negatives = sample.items.filter((i) => i.stratum === 'negative');
    expect(new Set(negatives.map((i) => i.repo)).size).toBe(3);
    const cell = sample.cells.find((c) => c.stratum === 'negative' && c.repo === 'a/one')!;
    expect(cell.population).toBe(30);
    expect(sample.cells.reduce((s, c) => s + c.sampled, 0)).toBe(16);
  });

  it('double-labels the planned share of each stratum', () => {
    expect(sample.items.filter((i) => i.double)).toHaveLength(8);
    expect(sample.items.filter((i) => i.double && i.stratum === 'negative')).toHaveLength(2);
  });

  it('is reproduced by its seed and changed by another', () => {
    expect(drawCalibrationSample(units, plan, SEED).items.map((i) => i.item_id)).toEqual(sample.items.map((i) => i.item_id));
    expect(drawCalibrationSample(units, plan, 'b'.repeat(64)).items.map((i) => i.pr_url).sort()).not.toEqual(sample.items.map((i) => i.pr_url).sort());
  });

  it('reports a stratum too small for its allocation', () => {
    const small = drawCalibrationSample(population(['a/one'], 1), plan, SEED);
    expect(small.shortfalls).toContainEqual({ stratum: 'revert', allocated: 2, drawn: 1 });
  });
});

describe('label sheets', () => {
  const item = (id: string, candidates = 1): SampleItem =>
    ({ item_id: id, repo: 'o/r', pr_url: url('o/r', 1), stratum: 'revert', proxies: [], candidates: Array.from({ length: candidates }, () => ({ fix_url: url('o/r', 2) })), double: false }) as unknown as SampleItem;

  it('round-trips through CSV, quotes included, and is blind to stratum and proxy', () => {
    const sheet = renderLabelSheet([item('i1')]);
    expect(sheet.split('\n')[0]).toBe('item_id,pr_url,candidate_fixes,corrective,cause_code,exclusion_code,notes');
    expect(sheet).not.toContain('revert');
    expect(parseCsv('a,"b, ""c""\nd",e\n')).toEqual([['a', 'b, "c"\nd', 'e']]);
  });

  it('validates verdicts and codes, and counts blank rows as unlabelled', () => {
    const items = new Map([
      ['i1', item('i1')],
      ['i2', item('i2')],
      ['i3', item('i3', 0)],
      ['i4', item('i4')],
      ['i5', item('i5')],
    ]);
    const csv = ['item_id,pr_url,candidate_fixes,corrective,cause_code,exclusion_code,notes', 'i1,,,yes,test_gap,,', 'i2,,,no,,,', 'i3,,,no,,,', 'i4,,,,,,', 'i5,,,yes,,refactor,', 'zz,,,yes,test_gap,,'].join('\n');
    const parsed = parseLabelSheet(csv, items);
    expect(parsed.unlabelled).toEqual(['i4']);
    expect(parsed.labels.get('i1')).toEqual({ verdict: 'yes', cause_code: 'test_gap', exclusion_code: null });
    expect(parsed.labels.get('i3')).toEqual({ verdict: 'no', cause_code: 'not_rework', exclusion_code: null });
    expect(parsed.errors).toEqual([
      'i2: a no on an item with candidate fixes needs an exclusion code',
      'i5: a yes needs a cause code other than not_rework',
      'i5: a yes takes no exclusion code',
      'zz: not in the sample',
    ]);
  });
});

describe('cohensKappa', () => {
  it('matches a worked example and handles degenerate input', () => {
    // 50 items: 20 yes/yes, 15 no/no, 5 yes/no, 10 no/yes → po 0.7, pe 0.5, κ 0.4.
    const pairs = [
      ...Array.from({ length: 20 }, () => ['yes', 'yes'] as const),
      ...Array.from({ length: 15 }, () => ['no', 'no'] as const),
      ...Array.from({ length: 5 }, () => ['yes', 'no'] as const),
      ...Array.from({ length: 10 }, () => ['no', 'yes'] as const),
    ];
    expect(cohensKappa(pairs)).toBe(0.4);
    expect(cohensKappa([['a', 'a']])).toBeNull();
    expect(cohensKappa([])).toBeNull();
  });
});

describe('scoreCalibration', () => {
  // One repo. Revert cell: 10 PRs, 2 sampled, both corrective. Negative cell: 1,000 PRs, 2 sampled, one corrective.
  const unit = (n: number, stratum: 'revert' | 'negative'): SampleItem => ({
    repo: 'o/r',
    pr_url: url('o/r', n),
    stratum,
    proxies: stratum === 'revert' ? ['revert'] : [],
    candidates: stratum === 'revert' ? [{ candidate_id: `c${n}`, proxy: 'revert', status: 'accepted', exclusion_code: null, fix_url: url('o/r', 99), lag_days: 1, blamed_lines: null, revert_reason: n === 1 ? 'internal_build' : 'public_ci' }] : [],
    item_id: `i${n}`,
    double: true,
  });
  const items = [unit(1, 'revert'), unit(2, 'revert'), unit(3, 'negative'), unit(4, 'negative')];
  const cells: SampleCell[] = [
    { repo: 'o/r', stratum: 'revert', population: 10, sampled: 2 },
    { repo: 'o/r', stratum: 'negative', population: 1000, sampled: 2 },
  ];
  const yes = (cause: string): HumanLabel => ({ verdict: 'yes', cause_code: cause, exclusion_code: null });
  const no: HumanLabel = { verdict: 'no', cause_code: 'not_rework', exclusion_code: null };
  const sheetA = new Map([
    ['i1', yes('test_gap')],
    ['i2', yes('plan_error')],
    ['i3', yes('blast_radius')],
    ['i4', no],
  ]);
  const sheetB = new Map([
    ['i1', yes('test_gap')],
    ['i2', yes('test_gap')],
    ['i3', no],
    ['i4', no],
  ]);
  const results = scoreCalibration({ plan, items, cells, sheetA, sheetB, seed: SEED, resamples: 200 });

  it('reweights by cell population, so the negatives drive recall', () => {
    const def = results.definitions.find((d) => d.name === 'cr-0.1.0')!;
    expect(def.precision.estimate).toBe(1);
    expect(def.recall.estimate).toBe(0.0196); // 10 / (10 + 500)
    expect(results.proxies.revert!.precision.n).toBe(2);
    expect(results.definitions.find((d) => d.name === 'no_internal_build')!.recall.estimate).toBe(0.0098); // 5 / 510
    expect(results.chosen_definition).toBe('cr-0.1.0'); // ties on recall go to the earlier variant
  });

  it('reports agreement per field and per code against the floor', () => {
    expect(results.agreement.corrective.pairs).toBe(4);
    expect(results.agreement.corrective.kappa).toBe(0.5);
    expect(results.agreement.cause_code.per_code.test_gap!.verdict).toBe('below_floor');
    expect(results.agreement.cause_code.per_code.review_gap!.verdict).toBe('not_observed');
    expect(results.causes.raw).toEqual({ test_gap: 1, plan_error: 1, blast_radius: 1 });
  });

  it('renders a table that names no repo', () => {
    const md = renderCalibrationMarkdown(results);
    expect(md).toContain('| R1 | 4 |');
    expect(md).not.toContain('o/r');
    expect(md).not.toContain('INCOMPLETE');
  });
});

describe('corpus-calibration CLI', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const repos = ['a/one', 'b/two', 'c/three', 'held/out'];

  function corpus() {
    const dir = mkdtempSync(join(tmpdir(), 'calibration-'));
    dirs.push(dir);
    for (const [r, repo] of repos.entries()) {
      const repoDir = join(dir, 'cache', repo.replace('/', '__'));
      mkdirSync(repoDir, { recursive: true });
      const base = r * 1000;
      const rev = candidate(repo, base + 1, base + 900, 'revert');
      const szz = candidate(repo, base + 2, base + 901, 'szz', { lines: 4 });
      const rej = candidate(repo, base + 3, base + 902, 'repair_reference', { status: 'rejected', exclusion_code: 'backport' });
      writeJsonl(join(repoDir, 'candidates.jsonl.gz'), [rev, szz, rej], { gzip: true });
      const negatives = Array.from({ length: 6 }, (_, i) => row(repo, base + 10 + i, false));
      writeJsonl(join(repoDir, 'corrective.jsonl.gz'), [row(repo, base + 1, true, [rev.candidate_id]), row(repo, base + 2, true, [szz.candidate_id]), row(repo, base + 3, false), ...negatives], { gzip: true });
    }
    const manifest = { manifest_version: '0.1.0', window: { merged_from: '2025-01-01', merged_until: '2025-06-01' }, repos: repos.map((repo) => ({ repo, status: 'kept' })), alternates: [] };
    writeFileSync(join(dir, 'cohort.json'), JSON.stringify(manifest));
    writeFileSync(join(dir, 'slice.json'), JSON.stringify({ repos: ['held/out'] }));
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({ ...plan, min_repos: 3 }));
    return dir;
  }
  const run = (command: string, dir: string, args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const { exitCode } = runCorpusCli(command, args, { cwd: dir, writeStdout: (t) => out.push(t), writeStderr: (t) => err.push(t) });
    return { exitCode, out: out.join(''), err: err.join('') };
  };
  const sampleArgs = (out: string) => ['--manifest', 'cohort.json', '--cache-dir', 'cache', '--plan', 'plan.json', '--exclude-slice', 'slice.json', '--out', out, '--seed', SEED];

  it('draws a private sample without the slice repos, prints aggregates only, and never overwrites it', () => {
    const dir = corpus();
    const first = run('corpus-calibration-sample', dir, sampleArgs('private'));
    expect(first.exitCode).toBe(0);
    for (const repo of repos) expect(first.out + first.err).not.toContain(repo);
    expect(JSON.parse(first.out)).toMatchObject({ repos: 3, strata: { revert: 2, szz_strong: 2, rejected: 2, negative: 4 } });
    const sample = JSON.parse(readFileSync(join(dir, 'private', 'sample.json'), 'utf8'));
    expect(sample.items.some((i: SampleItem) => i.repo === 'held/out')).toBe(false);
    expect(sample.inputs.some((i: { repo: string }) => i.repo === 'held/out')).toBe(false);
    expect(statSync(join(dir, 'private', 'sample.json')).mode & 0o777).toBe(0o600);
    expect(run('corpus-calibration-sample', dir, sampleArgs('private')).exitCode).toBe(2);
  });

  it('refuses an output directory inside a git work tree', () => {
    const dir = corpus();
    mkdirSync(join(dir, '.git'));
    const result = run('corpus-calibration-sample', dir, sampleArgs('private'));
    expect(result.exitCode).toBe(2);
    expect(result.err).toContain('outside any git work tree');
    expect(existsSync(join(dir, 'private'))).toBe(false);
  });

  it('scores labelled sheets, refusing invalid labels', () => {
    const dir = corpus();
    expect(run('corpus-calibration-sample', dir, sampleArgs('private')).exitCode).toBe(0);
    const sample = JSON.parse(readFileSync(join(dir, 'private', 'sample.json'), 'utf8')) as { items: SampleItem[] };
    const label = (i: SampleItem) => (i.proxies.length ? 'yes,test_gap,' : i.candidates.length ? 'no,,unrelated_edit' : 'no,,');
    const sheet = (items: SampleItem[]) => ['item_id,pr_url,candidate_fixes,corrective,cause_code,exclusion_code,notes', ...items.map((i) => `${i.item_id},,,${label(i)},`)].join('\n');
    writeFileSync(join(dir, 'private', 'sheet-a.csv'), sheet(sample.items));
    writeFileSync(join(dir, 'private', 'sheet-b.csv'), sheet(sample.items.filter((i) => i.double)));
    const scored = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(scored.exitCode).toBe(0);
    expect(JSON.parse(scored.out)).toMatchObject({ items: sample.items.length, unlabelled: 0 });
    const md = readFileSync(join(dir, 'private', 'calibration-table.md'), 'utf8');
    for (const repo of repos) expect(md).not.toContain(repo);
    expect(md).toContain('| cr-0.1.0: all admitted proxies (P1–P4) | 100.0%');

    writeFileSync(join(dir, 'private', 'sheet-b.csv'), 'item_id,corrective,cause_code,exclusion_code\nnope,yes,test_gap,\n');
    const bad = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(bad.exitCode).toBe(2);
    expect(bad.err).toContain('sheet-b: nope: not in the sample');
  });
});
