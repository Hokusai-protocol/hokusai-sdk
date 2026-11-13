import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { CorrectiveCandidateV1, CorrectiveReworkLabelV1 } from '@hokusai/core';
import {
  classifyCalibrationRepo,
  cohensKappa,
  drawCalibrationSample,
  extendAudit,
  parseCalibrationPlan,
  parseCsv,
  parseLabelSheet,
  renderCalibrationMarkdown,
  renderLabelSheet,
  scoreCalibration,
  scoreCalibrationRun,
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
  human_audit_share: 0.5,
  labellers: { a: 'model-a', b: 'model-b' },
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

  it('audits per-stratum shares under plan 1.1.0, and a top-up keeps every audited item', () => {
    expect(sample.items.filter((i) => i.audit && i.stratum === 'revert')).toHaveLength(1);
    const wider = parseCalibrationPlan({ ...plan, plan_version: 'test-2', human_audit_share_by_stratum: { revert: 1, negative: 1 } });
    const drawn = drawCalibrationSample(units, wider, SEED);
    expect(drawn.items.map((i) => i.item_id)).toEqual(sample.items.map((i) => i.item_id)); // the audit share never changes the draw
    expect(drawn.items.filter((i) => i.audit && i.stratum === 'revert')).toHaveLength(2);
    expect(drawn.items.filter((i) => i.audit && i.stratum === 'negative')).toHaveLength(4);
    expect(drawn.items.filter((i) => i.audit && i.stratum === 'szz_weak')).toHaveLength(1);
    expect(extendAudit(sample.items, wider, SEED)).toEqual(drawn.items);
    for (const item of sample.items.filter((i) => i.audit)) expect(drawn.items.find((i) => i.item_id === item.item_id)!.audit).toBe(true);
    const narrower = parseCalibrationPlan({ ...plan, plan_version: 'test-3', human_audit_share: 0.1 });
    expect(() => extendAudit(drawn.items, narrower, SEED)).toThrow('would drop an audited item');
    expect(() => parseCalibrationPlan({ ...plan, human_audit_share_by_stratum: { nope: 1 } })).toThrow('unknown stratum');
    expect(() => parseCalibrationPlan({ ...plan, human_audit_share_by_stratum: { revert: 0 } })).toThrow('out of range');
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
    expect(sheet.split('\n')[0]).toBe('item_id,pr_url,candidate_fixes,related_prs,corrective,cause_code,exclusion_code,notes');
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
    audit: true,
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

  it('lets model labels stand in only when the person agrees with model A at the floor', () => {
    const agreeing = scoreCalibrationRun({ plan, items, cells, sheets: { a: sheetA, b: sheetB, h: sheetA }, seed: SEED, resamples: 200 });
    expect(agreeing.models_stand_in).toBe(true);
    expect(agreeing.primary).toBe('model');
    expect(agreeing.human.agreement.corrective.kappa).toBe(1);
    expect(agreeing.gate_label_precision).toMatchObject({ definition: 'cr-0.1.0', precision: { estimate: 1 } });
    // The person disagrees on i3: κ 0.5 < 0.6, so the human audit's own estimates are primary.
    const split = scoreCalibrationRun({ plan, items, cells, sheets: { a: sheetA, b: sheetB, h: sheetB }, seed: SEED, resamples: 200 });
    expect(split.models_stand_in).toBe(false);
    expect(split.primary).toBe('human');
    expect(split.human.definitions[0]!.recall.estimate).toBe(1); // the person's only yes PRs are proxy-positive
  });

  it('under plan 1.1.0, picks only a variant that also clears the floor on the person\'s labels', () => {
    // The person says no on i1 (a revert): κ 0.5, and cr-0.1.0 is 50% precise on their labels.
    const h = new Map(sheetA);
    h.set('i1', { verdict: 'no', cause_code: 'not_rework', exclusion_code: 'revert_non_defect' });
    const lenient = { ...plan, kappa_floor: 0.4 };
    const before = scoreCalibrationRun({ plan: lenient, items, cells, sheets: { a: sheetA, b: sheetB, h }, seed: SEED, resamples: 200 });
    expect(before).toMatchObject({ models_stand_in: true, pick_rule: 'primary', chosen_definition: 'cr-0.1.0' });
    const after = scoreCalibrationRun({ plan: { ...lenient, pick_needs_human_precision: true }, items, cells, sheets: { a: sheetA, b: sheetB, h }, seed: SEED, resamples: 200 });
    // i1 is the internal-build revert, so no_internal_build drops it and clears the floor on the person's labels.
    expect(after).toMatchObject({ models_stand_in: true, pick_rule: 'primary_and_human', chosen_definition: 'no_internal_build' });
    expect(after.gate_label_precision).toMatchObject({ definition: 'no_internal_build', precision: { estimate: 1 } });
    expect(renderCalibrationMarkdown(after)).toContain("cr-0.2.0 pick (precision ≥ 80.0% on the model labels and on the person's): **no_internal_build**");
    // If the person also rejects i2, nothing clears the floor on their labels.
    h.set('i2', { verdict: 'no', cause_code: 'not_rework', exclusion_code: 'revert_non_defect' });
    const none = scoreCalibrationRun({ plan: { ...lenient, kappa_floor: 0.1, pick_needs_human_precision: true }, items, cells, sheets: { a: sheetA, b: sheetB, h }, seed: SEED, resamples: 200 });
    expect(none).toMatchObject({ models_stand_in: true, chosen_definition: null, gate_label_precision: { definition: 'cr-0.1.0' } });
    // When the person agrees, the stricter rule picks what the plain one does.
    expect(scoreCalibrationRun({ plan: { ...lenient, pick_needs_human_precision: true }, items, cells, sheets: { a: sheetA, b: sheetB, h: sheetA }, seed: SEED, resamples: 200 }).chosen_definition).toBe('cr-0.1.0');
  });

  it('renders a table that names no repo', () => {
    const md = renderCalibrationMarkdown(scoreCalibrationRun({ plan, items, cells, sheets: { a: sheetA, b: sheetB, h: sheetA }, seed: SEED, resamples: 200 }));
    expect(md).toContain('| R1 | 4 |');
    expect(md).toContain('Model labels **stand in**');
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

  it('leaves the PRs of an earlier sample out of a new draw and records which sample', () => {
    const dir = corpus();
    expect(run('corpus-calibration-sample', dir, sampleArgs('first')).exitCode).toBe(0);
    const first = JSON.parse(readFileSync(join(dir, 'first', 'sample.json'), 'utf8')) as { items: SampleItem[] };
    const second = run('corpus-calibration-sample', dir, [...sampleArgs('second'), '--exclude-sample', 'first/sample.json']);
    expect(second.exitCode).toBe(0);
    const drawn = JSON.parse(readFileSync(join(dir, 'second', 'sample.json'), 'utf8')) as { items: SampleItem[]; excluded_samples: { items: number }[] };
    const earlier = new Set(first.items.map((i) => i.pr_url));
    expect(drawn.items.some((i) => earlier.has(i.pr_url))).toBe(false);
    expect(drawn.excluded_samples).toEqual([{ sample_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), items: first.items.length }]);
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
    writeFileSync(join(dir, 'private', 'sheet-h.csv'), sheet(sample.items.filter((i) => i.audit)));
    const scored = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(scored.exitCode).toBe(0);
    expect(JSON.parse(scored.out)).toMatchObject({ items: sample.items.length, model_unlabelled: 0, audit_unlabelled: 0, models_stand_in: true });
    const md = readFileSync(join(dir, 'private', 'calibration-table.md'), 'utf8');
    for (const repo of repos) expect(md).not.toContain(repo);
    expect(md).toContain('| cr-0.1.0: all admitted proxies (P1–P4) | 100.0%');

    writeFileSync(join(dir, 'private', 'sheet-b.csv'), 'item_id,corrective,cause_code,exclusion_code\nnope,yes,test_gap,\n');
    const bad = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(bad.exitCode).toBe(2);
    expect(bad.err).toContain('sheet-b: nope: not in the sample');
  });

  it('hides gold rows in the audit sheet, scores them apart, and leaves the estimates unchanged', () => {
    const dir = corpus();
    expect(run('corpus-calibration-sample', dir, sampleArgs('private')).exitCode).toBe(0);
    const p = join(dir, 'private');
    const sample = JSON.parse(readFileSync(join(p, 'sample.json'), 'utf8')) as { items: SampleItem[] };
    const audit = sample.items.filter((i) => i.audit);
    writeFileSync(join(p, 'sheet-h.csv'), renderLabelSheet(audit));
    const goldItem = (n: number, use: string, corrective: string) => ({ item_id: `00000000000${n}`, use, kind: corrective === 'yes' ? 'repair_ref' : 'negative', pr_url: url('z/gold', n), candidate_fixes: corrective === 'yes' ? [url('z/gold', n + 50)] : [], related_prs: [], expected: { corrective, exclusion_code: '', fix_url: '' }, why: 't' });
    writeFileSync(join(dir, 'gold.json'), JSON.stringify({ procedure: 'hok-3269-gold', gold_version: 't', items: [goldItem(1, 'hidden', 'yes'), goldItem(2, 'hidden', 'no'), goldItem(3, 'screening', 'no')] }));

    const inserted = run('corpus-calibration-gold', dir, ['--sample', 'private', '--gold', 'gold.json']);
    expect(inserted.exitCode).toBe(0);
    expect(JSON.parse(inserted.out)).toMatchObject({ hidden: 2, sheet_rows: audit.length + 2 });
    expect(run('corpus-calibration-gold', dir, ['--sample', 'private', '--gold', 'gold.json']).exitCode).toBe(2);
    expect(readFileSync(join(p, 'sheet-h.csv'), 'utf8')).not.toContain('000000000003');

    const label = (i: SampleItem) => (i.proxies.length ? 'yes,test_gap,' : i.candidates.length ? 'no,,unrelated_edit' : 'no,,');
    const sheet = (items: SampleItem[]) => ['item_id,pr_url,candidate_fixes,corrective,cause_code,exclusion_code,notes', ...items.map((i) => `${i.item_id},,,${label(i)},`)].join('\n');
    writeFileSync(join(p, 'sheet-a.csv'), sheet(sample.items));
    writeFileSync(join(p, 'sheet-b.csv'), sheet(sample.items.filter((i) => i.double)));
    const h = parseCsv(readFileSync(join(p, 'sheet-h.csv'), 'utf8'));
    const byId = new Map(audit.map((i) => [i.item_id, i]));
    const filledH = h.map((r, n) => (n === 0 ? r : r[0] === '000000000001' ? [...r.slice(0, 4), 'yes', 'test_gap', '', ''] : r[0] === '000000000002' ? [...r.slice(0, 4), 'yes', 'test_gap', '', ''] : [...r.slice(0, 4), ...label(byId.get(r[0]!)!).split(','), '']));
    writeFileSync(join(p, 'sheet-h.csv'), filledH.map((r) => r.join(',')).join('\n'));

    const scored = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(scored.exitCode).toBe(0);
    expect(JSON.parse(scored.out)).toMatchObject({ audit_unlabelled: 0, models_stand_in: true, audit_check: { correct: 1, items: 2, passed: false } });
    const md = readFileSync(join(p, 'calibration-table.md'), 'utf8');
    expect(md).toContain('**Audit rejected:** the person got 1 of 2');
    expect(md).toContain('| cr-0.1.0: all admitted proxies (P1–P4) | 100.0%');

    const screen = run('corpus-calibration-screen', dir, ['--gold', 'gold.json', '--out', 'screening.csv']);
    expect(screen.exitCode).toBe(0);
    expect(readFileSync(join(dir, 'screening.csv'), 'utf8')).toContain('000000000003');
    writeFileSync(join(dir, 'screening-filled.csv'), readFileSync(join(dir, 'screening.csv'), 'utf8').replace(/,,,,\n$/, ',no,,,looked\n'));
    expect(JSON.parse(run('corpus-calibration-screen', dir, ['--gold', 'gold.json', '--sheet', 'screening-filled.csv']).out)).toMatchObject({ correct: 1, passed: true });
  });
});

describe('corpus-calibration-topup', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const run = (command: string, dir: string, args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const { exitCode } = runCorpusCli(command, args, { cwd: dir, writeStdout: (t) => out.push(t), writeStderr: (t) => err.push(t) });
    return { exitCode, out: out.join(''), err: err.join('') };
  };
  const goldItem = (n: number, corrective: 'yes' | 'no') => ({ item_id: `00000000000${n}`, use: 'hidden', kind: corrective === 'yes' ? 'repair_ref' : 'negative', pr_url: url('z/gold', n), candidate_fixes: corrective === 'yes' ? [url('z/gold', n + 50)] : [], related_prs: [], expected: { corrective, exclusion_code: '', fix_url: '' }, why: 't' });
  const label = (i: SampleItem) => (i.proxies.length ? 'yes,test_gap,' : i.candidates.length ? 'no,,unrelated_edit' : 'no,,');
  const fill = (sheet: string, items: readonly SampleItem[]) => {
    const byId = new Map(items.map((i) => [i.item_id, i]));
    return parseCsv(sheet)
      .map((r, n) => (n === 0 ? r : r[0]!.startsWith('0000000000') ? [...r.slice(0, 4), r[0] === '000000000001' || r[0] === '000000000003' ? 'yes' : 'no', r[0] === '000000000001' || r[0] === '000000000003' ? 'test_gap' : '', '', ''] : [...r.slice(0, 4), ...label(byId.get(r[0]!)!).split(','), '']))
      .map((r) => r.join(','))
      .join('\n');
  };

  it('adds the next audit items and new hidden rows, scores them once returned, and refuses a second run or a changed plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'calibration-topup-'));
    dirs.push(dir);
    const p = join(dir, 'private');
    mkdirSync(p);
    const units = population(['a/one', 'b/two', 'c/three'], 3);
    const drawn = drawCalibrationSample(units, plan, SEED);
    writeFileSync(join(p, 'sample.json'), JSON.stringify({ procedure: 'hok-3269-calibration-sample', sampler_version: '1.0.0', plan, plan_sha256: 'x', seed: SEED, cells: drawn.cells, items: drawn.items, inputs: [] }));
    writeJsonl(join(p, 'evidence.jsonl'), drawn.items.map((i) => ({ item_id: i.item_id, related: [{ url: url('rel/ated', 1), title: null, merged_at: '' }] })));
    writeFileSync(join(p, 'sheet-h.csv'), renderLabelSheet(drawn.items.filter((i) => i.audit)));
    writeFileSync(join(dir, 'gold-1.json'), JSON.stringify({ procedure: 'hok-3269-gold', gold_version: '1.0.0', items: [goldItem(1, 'yes'), goldItem(2, 'no')] }));
    expect(run('corpus-calibration-gold', dir, ['--sample', 'private', '--gold', 'gold-1.json']).exitCode).toBe(0);
    const firstSheet = readFileSync(join(p, 'sheet-h.csv'), 'utf8');
    writeFileSync(join(p, 'sheet-h.csv'), fill(firstSheet, drawn.items));
    writeFileSync(join(p, 'sheet-a.csv'), fill(renderLabelSheet(drawn.items), drawn.items));
    writeFileSync(join(p, 'sheet-b.csv'), fill(renderLabelSheet(drawn.items.filter((i) => i.double)), drawn.items));

    const plan2 = { ...plan, plan_version: 'test-2', human_audit_share_by_stratum: { revert: 1, repair_reference: 1 }, pick_needs_human_precision: true };
    writeFileSync(join(dir, 'plan-2.json'), JSON.stringify(plan2));
    writeFileSync(join(dir, 'plan-bad.json'), JSON.stringify({ ...plan2, kappa_floor: 0.5 }));
    writeFileSync(join(dir, 'gold-2.json'), JSON.stringify({ procedure: 'hok-3269-gold', gold_version: '1.1.0', items: [goldItem(1, 'yes'), goldItem(2, 'no'), goldItem(3, 'yes')] }));
    writeFileSync(join(dir, 'gold-bad.json'), JSON.stringify({ procedure: 'hok-3269-gold', gold_version: '1.1.0', items: [goldItem(1, 'no'), goldItem(2, 'no'), goldItem(3, 'yes')] }));
    const args = (planFile: string, goldFile: string) => ['--sample', 'private', '--plan', planFile, '--gold', goldFile];
    expect(run('corpus-calibration-topup', dir, args('plan-bad.json', 'gold-2.json')).err).toContain('plan.kappa_floor differs');
    expect(run('corpus-calibration-topup', dir, args('plan-2.json', 'gold-bad.json')).err).toContain('must keep every prior gold item unchanged');

    const topup = run('corpus-calibration-topup', dir, args('plan-2.json', 'gold-2.json'));
    expect(topup.exitCode).toBe(0);
    expect(JSON.parse(topup.out)).toMatchObject({ added: 2, added_by_stratum: { revert: 1, repair_reference: 1 }, hidden: 1, sheet_rows: 3 });
    const blank = readFileSync(join(p, 'sheet-h-topup.blank.csv'), 'utf8');
    expect(blank).toContain('000000000003');
    expect(blank).not.toContain('000000000001');
    expect(blank).toContain(url('rel/ated', 1));
    const sample2 = JSON.parse(readFileSync(join(p, 'sample.json'), 'utf8')) as { plan: CalibrationPlan; items: SampleItem[]; audit_topups: unknown[] };
    expect(sample2.plan.plan_version).toBe('test-2');
    expect(sample2.items.filter((i) => i.audit)).toHaveLength(drawn.items.filter((i) => i.audit).length + 2);
    expect(sample2.audit_topups).toMatchObject([{ plan_version: 'test-2', from_plan_version: 'test', added: 2, gold_item_ids: ['000000000003'] }]);
    expect(existsSync(join(p, 'sample.plan-test.json'))).toBe(true);
    expect(existsSync(join(p, 'gold.1.0.0.json'))).toBe(true);
    expect(run('corpus-calibration-topup', dir, args('plan-2.json', 'gold-2.json')).exitCode).toBe(2);

    // Before the top-up is back, its items are unlabelled and its hidden row is not counted against the auditor.
    const pending = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(JSON.parse(pending.out)).toMatchObject({ audit_unlabelled: 2, audit_check: { correct: 2, items: 2, passed: true } });
    writeFileSync(join(p, 'sheet-h-topup.csv'), fill(blank, sample2.items));
    const back = run('corpus-calibration-score', dir, ['--sample', 'private']);
    expect(back.exitCode).toBe(0);
    expect(JSON.parse(back.out)).toMatchObject({ audit_unlabelled: 0, audit_check: { correct: 3, items: 3, passed: true } });
    expect(readFileSync(join(p, 'calibration-table.md'), 'utf8')).toContain("on the model labels and on the person's");
  });
});

describe('labelling guide', () => {
  it('keeps the headings the model labeller extracts (scripts/corpus/label-calibration.mjs)', () => {
    const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/arbiter/corrective-rework-label.md'), 'utf8');
    for (const [from, to] of [['## 1. Definition', '## 2.'], ['## 4. Labelling guide', '### Independence']] as const) {
      expect(doc.indexOf(from)).toBeGreaterThanOrEqual(0);
      expect(doc.indexOf(to, doc.indexOf(from))).toBeGreaterThan(doc.indexOf(from));
    }
  });
});
