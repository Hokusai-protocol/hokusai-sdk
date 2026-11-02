/**
 * Human calibration of the corrective-rework definition (HOK-3269).
 *
 * The sampler draws a stratified sample of original PRs at the calibration
 * horizon from the persisted corpus outputs (HOK-3267/3268), never from a
 * new linkage pass. Strata partition the population, so every estimate is
 * reweighted by cell (repo × stratum) population over cell sample size:
 *
 *   revert, repair_reference, regression_issue   corrective; the highest-precision proxy that fired
 *   szz_strong, szz_weak                         corrective on SZZ alone, split at the blamed-line minimum
 *   rejected                                     not corrective, but a candidate was rejected
 *   negative                                     not corrective, no candidate at all (the recall estimate)
 *
 * The scorer turns the label sheets into precision and recall per proxy,
 * per repo and per candidate definition, Cohen's kappa on the double-labelled
 * subset, the cause distribution, and exclusion validation.
 *
 * Every draw is keyed by sha256(seed ‖ …), so a seed reproduces the sample.
 * The seed, the sample and the labels are private; only the scorer's
 * markdown table, with repos pseudonymized, is meant to be shared.
 * Pure: rows are passed in as iterables, so large repos stream.
 */

import { createHash } from 'node:crypto';
import {
  ADMITTED_PROXIES,
  CALIBRATION_VERDICTS,
  CAUSE_CODES,
  HUMAN_EXCLUSION_CODES,
  type CalibrationVerdict,
  type CorrectiveCandidateV1,
  type CorrectiveReworkLabelV1,
} from '@hokusai/core';
import { wilsonInterval, type Interval } from '../report/stats.js';

export const CALIBRATION_SAMPLER_VERSION = '1.0.0';

export const CALIBRATION_STRATA = ['revert', 'repair_reference', 'regression_issue', 'szz_strong', 'szz_weak', 'rejected', 'negative'] as const;
export type CalibrationStratum = (typeof CALIBRATION_STRATA)[number];

type AdmittedProxy = (typeof ADMITTED_PROXIES)[number];

/** Pre-registered before labelling (fixtures/arbiter/corpus/hok-3269-calibration-plan.json). */
export interface CalibrationPlan {
  plan_version: string;
  horizon_days: number;
  /** Items drawn per stratum, spread round-robin across repos. */
  allocation: Record<CalibrationStratum, number>;
  /** Share of each stratum labelled a second time, independently (sheet B). */
  double_label_share: number;
  /** Share of each stratum a person labels blind (sheet H): validates the labellers, and is the gate's human sample. */
  human_audit_share: number;
  /** Model IDs that label sheets A and B; recorded so results name their labellers. */
  labellers: { a: string; b: string };
  min_repos: number;
  /** SZZ links with at least this many blamed lines are `szz_strong`. */
  szz_strong_min_lines: number;
  /** Cohen's kappa below which a code is merged, split or retired. */
  kappa_floor: number;
  /** cr-0.2.0 is the definition variant with the highest recall whose precision estimate is at least this. */
  definition_precision_floor: number;
}

export function parseCalibrationPlan(raw: unknown): CalibrationPlan {
  const plan = raw as Partial<CalibrationPlan> | null;
  if (!plan || typeof plan !== 'object') throw new Error('plan must be an object');
  const allocation = plan.allocation as Record<string, unknown> | undefined;
  if (!allocation || typeof allocation !== 'object') throw new Error('plan.allocation is required');
  for (const stratum of CALIBRATION_STRATA) {
    if (!Number.isInteger(allocation[stratum]) || (allocation[stratum] as number) < 0) throw new Error(`plan.allocation.${stratum} must be a non-negative integer`);
  }
  const extra = Object.keys(allocation).filter((k) => !(CALIBRATION_STRATA as readonly string[]).includes(k));
  if (extra.length) throw new Error(`plan.allocation has unknown strata: ${extra.join(', ')}`);
  const num = (key: keyof CalibrationPlan, ok: (v: number) => boolean) => {
    const v = plan[key];
    if (typeof v !== 'number' || !ok(v)) throw new Error(`plan.${key} is out of range`);
    return v;
  };
  if (typeof plan.plan_version !== 'string') throw new Error('plan.plan_version is required');
  return {
    plan_version: plan.plan_version,
    horizon_days: num('horizon_days', (v) => Number.isInteger(v) && v > 0),
    allocation: allocation as Record<CalibrationStratum, number>,
    double_label_share: num('double_label_share', (v) => v >= 0 && v <= 1),
    human_audit_share: num('human_audit_share', (v) => v > 0 && v <= 1),
    labellers: parseLabellers(plan.labellers),
    min_repos: num('min_repos', (v) => Number.isInteger(v) && v >= 1),
    szz_strong_min_lines: num('szz_strong_min_lines', (v) => Number.isInteger(v) && v >= 1),
    kappa_floor: num('kappa_floor', (v) => v > 0 && v <= 1),
    definition_precision_floor: num('definition_precision_floor', (v) => v > 0 && v <= 1),
  };
}

function parseLabellers(raw: unknown): CalibrationPlan['labellers'] {
  const l = raw as Partial<CalibrationPlan['labellers']> | undefined;
  if (!l || typeof l.a !== 'string' || typeof l.b !== 'string' || !l.a || !l.b) throw new Error('plan.labellers needs model IDs for a and b');
  if (l.a === l.b) throw new Error('plan.labellers.a and .b must be different models');
  return { a: l.a, b: l.b };
}

const sha256 = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex');

/** A copy of `list` ordered by a hash key, each key computed once. */
function seededOrder<T>(list: readonly T[], key: (item: T) => string): T[] {
  return list
    .map((item) => [key(item), item] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, item]) => item);
}

// ── Population ─────────────────────────────────────────────────────────────

/** A candidate fix of a sampled PR, within the horizon. */
export interface UnitCandidate {
  candidate_id: string;
  proxy: CorrectiveCandidateV1['proxy'];
  status: CorrectiveCandidateV1['status'];
  exclusion_code: CorrectiveCandidateV1['exclusion_code'];
  fix_url: string;
  lag_days: number;
  /** SZZ: blamed lines in the original. */
  blamed_lines: number | null;
  /** Revert: the merge bot's reason class. */
  revert_reason: string | null;
}

export interface PopulationUnit {
  repo: string;
  pr_url: string;
  stratum: CalibrationStratum;
  /** Proxies of the accepted repair pairs within the horizon. */
  proxies: AdmittedProxy[];
  candidates: UnitCandidate[];
}

const STRATUM_PRIORITY: readonly AdmittedProxy[] = ['revert', 'repair_reference', 'regression_issue', 'szz'];

/** Each labelled original PR at the horizon, in its stratum. Rows with no base label are left out. */
export function classifyCalibrationRepo(input: {
  repo: string;
  horizonDays: number;
  szzStrongMinLines: number;
  candidates: Iterable<CorrectiveCandidateV1>;
  correctiveRows: Iterable<CorrectiveReworkLabelV1>;
}): PopulationUnit[] {
  const horizonSeconds = input.horizonDays * 86_400;
  const byOriginal = new Map<string, UnitCandidate[]>();
  for (const c of input.candidates) {
    if (c.lag_seconds > horizonSeconds) continue;
    const list = byOriginal.get(c.original.pr_url) ?? [];
    list.push({
      candidate_id: c.candidate_id,
      proxy: c.proxy,
      status: c.status,
      exclusion_code: c.exclusion_code,
      fix_url: c.fix.pr_url ?? `https://github.com/${input.repo}/commit/${c.fix.sha}`,
      lag_days: Math.round((c.lag_seconds / 86_400) * 10) / 10,
      blamed_lines: c.evidence.find((e) => e.kind === 'blamed_lines')?.count ?? null,
      revert_reason: c.evidence.find((e) => e.kind === 'revert_reason')?.ref ?? null,
    });
    byOriginal.set(c.original.pr_url, list);
  }
  const units: PopulationUnit[] = [];
  for (const row of input.correctiveRows) {
    if (row.horizon_days !== input.horizonDays || row.corrective === null) continue;
    const candidates = (byOriginal.get(row.prUrl) ?? []).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
    const accepted = new Set(row.repair_pair_ids);
    const acceptedCandidates = candidates.filter((c) => accepted.has(c.candidate_id));
    const proxies = [...new Set(acceptedCandidates.map((c) => c.proxy))].filter((p): p is AdmittedProxy => (ADMITTED_PROXIES as readonly string[]).includes(p)).sort();
    let stratum: CalibrationStratum;
    if (row.corrective) {
      const top = STRATUM_PRIORITY.find((p) => proxies.includes(p));
      if (!top) throw new Error(`${row.prUrl}: corrective row without an accepted pair within ${input.horizonDays} days`);
      if (top === 'szz') {
        const lines = Math.max(...acceptedCandidates.filter((c) => c.proxy === 'szz').map((c) => c.blamed_lines ?? 0));
        stratum = lines >= input.szzStrongMinLines ? 'szz_strong' : 'szz_weak';
      } else stratum = top;
    } else stratum = candidates.length ? 'rejected' : 'negative';
    units.push({ repo: input.repo, pr_url: row.prUrl, stratum, proxies, candidates });
  }
  return units;
}

// ── Draw ───────────────────────────────────────────────────────────────────

export interface SampleItem extends PopulationUnit {
  item_id: string;
  /** Also on sheet B, labelled independently. */
  double: boolean;
  /** Also on sheet H, labelled blind by a person. */
  audit: boolean;
}

export interface SampleCell {
  repo: string;
  stratum: CalibrationStratum;
  population: number;
  sampled: number;
}

export interface CalibrationSample {
  items: SampleItem[];
  cells: SampleCell[];
  /** Strata whose population was smaller than their allocation. */
  shortfalls: { stratum: CalibrationStratum; allocated: number; drawn: number }[];
}

/**
 * Within each stratum, repos take turns (in seeded order), each giving its
 * next PR in seeded order, until the allocation is met or the stratum runs
 * out. Small repos are not crowded out by llvm's 74k PRs, and per-repo
 * estimates stay possible.
 */
export function drawCalibrationSample(units: readonly PopulationUnit[], plan: CalibrationPlan, seed: string): CalibrationSample {
  const items: SampleItem[] = [];
  const cells = new Map<string, SampleCell>();
  const shortfalls: CalibrationSample['shortfalls'] = [];
  for (const stratum of CALIBRATION_STRATA) {
    const byRepo = new Map<string, PopulationUnit[]>();
    for (const u of units) {
      if (u.stratum !== stratum) continue;
      const list = byRepo.get(u.repo);
      if (list) list.push(u);
      else byRepo.set(u.repo, [u]);
    }
    for (const [repo, list] of byRepo) {
      byRepo.set(repo, seededOrder(list, (u) => sha256(seed, stratum, u.pr_url)));
      cells.set(`${repo}\0${stratum}`, { repo, stratum, population: list.length, sampled: 0 });
    }
    const repos = seededOrder([...byRepo.keys()], (repo) => sha256(seed, 'repo', stratum, repo));
    const want = plan.allocation[stratum];
    const picked: PopulationUnit[] = [];
    for (let round = 0; picked.length < want; round++) {
      let any = false;
      for (const repo of repos) {
        const unit = byRepo.get(repo)![round];
        if (!unit || picked.length >= want) continue;
        picked.push(unit);
        cells.get(`${repo}\0${stratum}`)!.sampled++;
        any = true;
      }
      if (!any) break;
    }
    if (picked.length < want) shortfalls.push({ stratum, allocated: want, drawn: picked.length });
    const doubles = new Set(
      seededOrder(picked, (u) => sha256(seed, 'double', u.pr_url))
        .slice(0, Math.ceil(picked.length * plan.double_label_share))
        .map((u) => u.pr_url),
    );
    const audited = new Set(
      seededOrder(picked, (u) => sha256(seed, 'audit', u.pr_url))
        .slice(0, Math.ceil(picked.length * plan.human_audit_share))
        .map((u) => u.pr_url),
    );
    for (const unit of picked) items.push({ ...unit, item_id: sha256(seed, 'item', unit.pr_url).slice(0, 12), double: doubles.has(unit.pr_url), audit: audited.has(unit.pr_url) });
  }
  // Sheet order mixes strata, so a labeller can't read the stratum off the position.
  return {
    items: seededOrder(items, (i) => sha256(seed, 'order', i.item_id)),
    cells: [...cells.values()].sort((x, y) => x.repo.localeCompare(y.repo) || CALIBRATION_STRATA.indexOf(x.stratum) - CALIBRATION_STRATA.indexOf(y.stratum)),
    shortfalls,
  };
}

// ── Label sheets ───────────────────────────────────────────────────────────

export const SHEET_COLUMNS = ['item_id', 'pr_url', 'candidate_fixes', 'related_prs', 'corrective', 'cause_code', 'exclusion_code', 'notes'] as const;

export const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export type SheetRow = Partial<Record<(typeof SHEET_COLUMNS)[number], string>>;

/**
 * One row per item, blind to stratum, proxy and acceptance: the labeller sees
 * the PR, every candidate fix within the horizon (accepted or rejected), and
 * the later PRs that touched its files. `filled` supplies label columns.
 */
export function renderLabelSheet(items: readonly SampleItem[], related: ReadonlyMap<string, readonly string[]> = new Map(), filled: ReadonlyMap<string, SheetRow> = new Map()): string {
  const rows = items.map((item) => {
    const row: SheetRow = {
      item_id: item.item_id,
      pr_url: item.pr_url,
      candidate_fixes: [...new Set(item.candidates.map((c) => c.fix_url))].sort().join(' '),
      related_prs: (related.get(item.item_id) ?? []).join(' '),
      ...filled.get(item.item_id),
    };
    return SHEET_COLUMNS.map((c) => row[c] ?? '');
  });
  return `${[SHEET_COLUMNS as readonly string[], ...rows].map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

/** RFC 4180 rows: quoted cells may hold commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export interface HumanLabel {
  verdict: CalibrationVerdict;
  /** `no` normalizes to `not_rework`, a blank `unclear` to `unclear`. */
  cause_code: string;
  exclusion_code: string | null;
}

/**
 * Labels by item ID. A blank verdict is unlabelled (counted, not scored).
 * `yes` needs a cause code; `no` needs an exclusion code when the item has
 * candidate fixes to exclude.
 */
export function parseLabelSheet(text: string, items: ReadonlyMap<string, SampleItem>): { labels: Map<string, HumanLabel>; unlabelled: string[]; errors: string[] } {
  const [header, ...rows] = parseCsv(text);
  const col = (name: string) => header?.indexOf(name) ?? -1;
  const errors: string[] = [];
  const missing = (['item_id', 'corrective', 'cause_code', 'exclusion_code'] as const).filter((c) => col(c) < 0);
  if (missing.length) return { labels: new Map(), unlabelled: [], errors: [`missing columns: ${missing.join(', ')}`] };
  const labels = new Map<string, HumanLabel>();
  const unlabelled: string[] = [];
  const causes = CAUSE_CODES as readonly string[];
  const exclusions = HUMAN_EXCLUSION_CODES as readonly string[];
  for (const r of rows) {
    const get = (name: string) => (r[col(name)] ?? '').trim().toLowerCase();
    const id = (r[col('item_id')] ?? '').trim();
    const item = items.get(id);
    if (!item) {
      errors.push(`${id || '(blank)'}: not in the sample`);
      continue;
    }
    if (labels.has(id)) {
      errors.push(`${id}: labelled twice on one sheet`);
      continue;
    }
    const verdict = get('corrective');
    const cause = get('cause_code');
    const exclusion = get('exclusion_code') || null;
    if (!verdict) {
      unlabelled.push(id);
      continue;
    }
    if (!(CALIBRATION_VERDICTS as readonly string[]).includes(verdict)) {
      errors.push(`${id}: corrective must be yes, no or unclear, not "${verdict}"`);
      continue;
    }
    if (verdict === 'yes') {
      if (!causes.includes(cause) || cause === 'not_rework') errors.push(`${id}: a yes needs a cause code other than not_rework`);
      if (exclusion) errors.push(`${id}: a yes takes no exclusion code`);
      labels.set(id, { verdict, cause_code: cause, exclusion_code: null });
    } else if (verdict === 'no') {
      if (cause && cause !== 'not_rework') errors.push(`${id}: a no takes cause not_rework (or blank)`);
      if (exclusion && !exclusions.includes(exclusion)) errors.push(`${id}: unknown exclusion code "${exclusion}"`);
      if (!exclusion && item.candidates.length) errors.push(`${id}: a no on an item with candidate fixes needs an exclusion code`);
      labels.set(id, { verdict, cause_code: 'not_rework', exclusion_code: exclusion });
    } else {
      if (cause && cause !== 'unclear') errors.push(`${id}: an unclear takes cause unclear (or blank)`);
      if (exclusion && !exclusions.includes(exclusion)) errors.push(`${id}: unknown exclusion code "${exclusion}"`);
      labels.set(id, { verdict: 'unclear', cause_code: 'unclear', exclusion_code: exclusion });
    }
  }
  return { labels, unlabelled, errors };
}

// ── Agreement ──────────────────────────────────────────────────────────────

/** Cohen's kappa of two raters over paired categories; null when chance agreement is total. */
export function cohensKappa(pairs: readonly (readonly [string, string])[]): number | null {
  if (!pairs.length) return null;
  const n = pairs.length;
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  let agree = 0;
  for (const [x, y] of pairs) {
    if (x === y) agree++;
    a.set(x, (a.get(x) ?? 0) + 1);
    b.set(y, (b.get(y) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [k, count] of a) pe += (count / n) * ((b.get(k) ?? 0) / n);
  if (pe === 1) return null;
  return round4((po - pe) / (1 - pe));
}

export interface KappaResult {
  pairs: number;
  kappa: number | null;
  /** One-vs-rest kappa per code; `not_observed` when neither rater used it. */
  per_code: Record<string, { used: number; kappa: number | null; verdict: 'pass' | 'below_floor' | 'not_observed' | 'undefined' }>;
}

function kappaWithCodes(pairs: readonly (readonly [string, string])[], codes: readonly string[], floor: number): KappaResult {
  const per_code: KappaResult['per_code'] = {};
  for (const code of codes) {
    const used = pairs.filter(([x, y]) => x === code || y === code).length;
    const kappa = used ? cohensKappa(pairs.map(([x, y]) => [String(x === code), String(y === code)] as const)) : null;
    per_code[code] = { used, kappa, verdict: !used ? 'not_observed' : kappa === null ? 'undefined' : kappa >= floor ? 'pass' : 'below_floor' };
  }
  return { pairs: pairs.length, kappa: cohensKappa(pairs), per_code };
}

export interface Agreement {
  corrective: KappaResult;
  cause_code: KappaResult;
  exclusion_code: KappaResult;
}

/** Kappa between two sheets over the items both labelled. */
export function agreementBetween(items: readonly SampleItem[], x: ReadonlyMap<string, HumanLabel>, y: ReadonlyMap<string, HumanLabel>, floor: number): Agreement {
  const both = items.filter((i) => x.has(i.item_id) && y.has(i.item_id));
  const pairs = (pick: (l: HumanLabel) => string | null) =>
    both.flatMap((i) => {
      const a = pick(x.get(i.item_id)!);
      const b = pick(y.get(i.item_id)!);
      return a !== null && b !== null ? [[a, b] as const] : [];
    });
  return {
    corrective: kappaWithCodes(pairs((l) => l.verdict), CALIBRATION_VERDICTS, floor),
    cause_code: kappaWithCodes(pairs((l) => l.cause_code), CAUSE_CODES, floor),
    exclusion_code: kappaWithCodes(pairs((l) => (l.verdict === 'no' ? (l.exclusion_code ?? '(none)') : null)), HUMAN_EXCLUSION_CODES, floor),
  };
}

// ── Estimates ──────────────────────────────────────────────────────────────

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** A definition variant scored against the human labels: which accepted candidates still count. */
export interface DefinitionVariant {
  name: string;
  description: string;
  keep: (c: UnitCandidate) => boolean;
}

export function definitionVariants(plan: CalibrationPlan): DefinitionVariant[] {
  const strongSzz = (c: UnitCandidate) => c.proxy !== 'szz' || (c.blamed_lines ?? 0) >= plan.szz_strong_min_lines;
  const notInternal = (c: UnitCandidate) => c.proxy !== 'revert' || c.revert_reason !== 'internal_build';
  return [
    { name: 'cr-0.1.0', description: 'all admitted proxies (P1–P4)', keep: () => true },
    { name: 'high_precision', description: 'P1 revert and P2 repair_reference only', keep: (c) => c.proxy === 'revert' || c.proxy === 'repair_reference' },
    { name: `szz_min_${plan.szz_strong_min_lines}`, description: `SZZ links need ≥${plan.szz_strong_min_lines} blamed lines`, keep: strongSzz },
    { name: 'no_internal_build', description: 'reverts for internal-build breakage excluded', keep: notInternal },
    { name: `szz_min_${plan.szz_strong_min_lines}+no_internal_build`, description: 'both of the above', keep: (c) => strongSzz(c) && notInternal(c) },
  ];
}

interface Scored {
  item: SampleItem;
  label: HumanLabel;
  /** Cell population / decided items in the cell. */
  weight: number;
}

type Estimator = (rows: readonly Scored[]) => number | null;

const accepted = (item: SampleItem) => item.candidates.filter((c) => c.status === 'accepted' && item.proxies.includes(c.proxy as AdmittedProxy));

/** Weighted share of `yes` among rows where `positive` holds. */
const precisionOf = (positive: (item: SampleItem) => boolean): Estimator => (rows) => {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (!positive(r.item)) continue;
    den += r.weight;
    if (r.label.verdict === 'yes') num += r.weight;
  }
  return den ? num / den : null;
};

/** Weighted share of human `yes` rows that `positive` catches. */
const recallOf = (positive: (item: SampleItem) => boolean): Estimator => (rows) => {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.label.verdict !== 'yes') continue;
    den += r.weight;
    if (positive(r.item)) num += r.weight;
  }
  return den ? num / den : null;
};

/** Seeded PRNG for the bootstrap (mulberry32). */
function prng(seed: string): () => number {
  let a = parseInt(sha256(seed, 'bootstrap').slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Estimate {
  estimate: number | null;
  ci95: { low: number; high: number } | null;
  /** Decided items the estimate rests on. */
  n: number;
}

/** Point estimate and a 95% percentile interval from a bootstrap that resamples items within each cell. */
function bootstrap(rows: readonly Scored[], estimator: Estimator, relevant: (r: Scored) => boolean, seed: string, resamples: number): Estimate {
  const estimate = estimator(rows);
  const n = rows.filter(relevant).length;
  if (estimate === null) return { estimate: null, ci95: null, n };
  const cells = new Map<string, Scored[]>();
  for (const r of rows) {
    const key = `${r.item.repo}\0${r.item.stratum}`;
    const cell = cells.get(key);
    if (cell) cell.push(r);
    else cells.set(key, [r]);
  }
  const groups = [...cells.values()];
  const rand = prng(seed);
  const values: number[] = [];
  for (let b = 0; b < resamples; b++) {
    const resampled: Scored[] = [];
    for (const g of groups) for (let i = 0; i < g.length; i++) resampled.push(g[Math.floor(rand() * g.length)]!);
    const v = estimator(resampled);
    if (v !== null) values.push(v);
  }
  values.sort((x, y) => x - y);
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))]!;
  return { estimate: round4(estimate), ci95: values.length ? { low: round4(at(0.025)), high: round4(at(0.975)) } : null, n };
}

export interface StratumResult {
  stratum: CalibrationStratum;
  sampled: number;
  yes: number;
  no: number;
  unclear: number;
  unlabelled: number;
  /** yes / (yes + no), unweighted: the stratum is a simple random sample within each repo. */
  yes_rate: number | null;
  yes_rate_ci95: Interval | null;
}

export interface CalibrationResults {
  sampler_version: string;
  plan: CalibrationPlan;
  items: number;
  labelled: number;
  unlabelled: number;
  unclear: number;
  /** Population with no decided item in its cell, so no estimate covers it. */
  unrepresented_population: number;
  strata: StratumResult[];
  proxies: Record<string, { precision: Estimate; recall: Estimate }>;
  definitions: { name: string; description: string; precision: Estimate; recall: Estimate }[];
  /** The pre-registered pick: highest recall among variants with precision ≥ the plan's floor, earlier variants winning ties; null if none qualifies. */
  chosen_definition: string | null;
  repos: { repo: string; pseudonym: string; sampled: number; precision: Estimate; recall: Estimate }[];
  rejections: {
    /** Rejected candidates a person judged corrective: wrongly rejected. */
    wrongly_rejected: { yes: number; decided: number; rate: number | null; ci95: Interval | null };
    /** Rejected-stratum items labelled `no`, by automatic code (rows) and human code (columns). */
    by_code: Record<string, Record<string, number>>;
  };
  /** Proxy-positive items a person labelled `no` with linkage_error, per proxy. */
  linkage_error: Record<string, { no: number; linkage_error: number; rate: number | null }>;
  causes: { raw: Record<string, number>; weighted_share: Record<string, number> };
  /** Between the scored sheet and the comparison sheet. */
  agreement: Agreement;
}

/** Estimates from one labelled sheet (`sheetA`), with its agreement against `sheetB`. */
export function scoreCalibration(input: {
  plan: CalibrationPlan;
  items: readonly SampleItem[];
  cells: readonly SampleCell[];
  sheetA: ReadonlyMap<string, HumanLabel>;
  sheetB: ReadonlyMap<string, HumanLabel>;
  seed: string;
  resamples?: number | undefined;
}): CalibrationResults {
  const { plan, items, sheetA, sheetB, seed } = input;
  const resamples = input.resamples ?? 2000;
  const decided = (id: string) => {
    const l = sheetA.get(id);
    return l && l.verdict !== 'unclear' ? l : null;
  };
  const decidedPerCell = new Map<string, number>();
  for (const item of items) if (decided(item.item_id)) decidedPerCell.set(`${item.repo}\0${item.stratum}`, (decidedPerCell.get(`${item.repo}\0${item.stratum}`) ?? 0) + 1);
  const population = new Map(input.cells.map((c) => [`${c.repo}\0${c.stratum}`, c.population]));
  const rows: Scored[] = items.flatMap((item) => {
    const label = decided(item.item_id);
    const key = `${item.repo}\0${item.stratum}`;
    return label ? [{ item, label, weight: (population.get(key) ?? 0) / decidedPerCell.get(key)! }] : [];
  });
  const unrepresented = input.cells.filter((c) => !decidedPerCell.get(`${c.repo}\0${c.stratum}`)).reduce((s, c) => s + c.population, 0);
  const est = (name: string, estimator: Estimator, relevant: (r: Scored) => boolean, subset: readonly Scored[] = rows) => bootstrap(subset, estimator, relevant, `${seed}\0${name}`, resamples);

  const strata: StratumResult[] = CALIBRATION_STRATA.map((stratum) => {
    const inStratum = items.filter((i) => i.stratum === stratum);
    const count = (v: CalibrationVerdict) => inStratum.filter((i) => sheetA.get(i.item_id)?.verdict === v).length;
    const yes = count('yes');
    const no = count('no');
    return {
      stratum,
      sampled: inStratum.length,
      yes,
      no,
      unclear: count('unclear'),
      unlabelled: inStratum.filter((i) => !sheetA.has(i.item_id)).length,
      yes_rate: yes + no ? round4(yes / (yes + no)) : null,
      yes_rate_ci95: wilsonInterval(yes, yes + no),
    };
  });

  const proxies: CalibrationResults['proxies'] = {};
  for (const proxy of ADMITTED_PROXIES) {
    const fired = (item: SampleItem) => item.proxies.includes(proxy);
    proxies[proxy] = {
      precision: est(`p:${proxy}`, precisionOf(fired), (r) => fired(r.item)),
      recall: est(`r:${proxy}`, recallOf(fired), (r) => r.label.verdict === 'yes'),
    };
  }

  const definitions = definitionVariants(plan).map((d) => {
    const positive = (item: SampleItem) => accepted(item).some(d.keep);
    return {
      name: d.name,
      description: d.description,
      precision: est(`dp:${d.name}`, precisionOf(positive), (r) => positive(r.item)),
      recall: est(`dr:${d.name}`, recallOf(positive), (r) => r.label.verdict === 'yes'),
    };
  });

  let chosen: (typeof definitions)[number] | null = null;
  for (const d of definitions) {
    if (d.precision.estimate === null || d.precision.estimate < plan.definition_precision_floor) continue;
    if (!chosen || (d.recall.estimate ?? 0) > (chosen.recall.estimate ?? 0)) chosen = d;
  }

  const repoNames = seededOrder([...new Set(items.map((i) => i.repo))], (repo) => sha256(seed, 'pseudonym', repo));
  const anyProxy = (item: SampleItem) => item.proxies.length > 0;
  const repos = repoNames.map((repo, i) => {
    const subset = rows.filter((r) => r.item.repo === repo);
    return {
      repo,
      pseudonym: `R${i + 1}`,
      sampled: items.filter((it) => it.repo === repo).length,
      precision: est(`rp:${repo}`, precisionOf(anyProxy), (r) => anyProxy(r.item), subset),
      recall: est(`rr:${repo}`, recallOf(anyProxy), (r) => r.label.verdict === 'yes', subset),
    };
  });

  const rejected = items.filter((i) => i.stratum === 'rejected');
  const rejYes = rejected.filter((i) => sheetA.get(i.item_id)?.verdict === 'yes').length;
  const rejDecided = rejected.filter((i) => decided(i.item_id)).length;
  const by_code: Record<string, Record<string, number>> = {};
  for (const item of rejected) {
    const label = sheetA.get(item.item_id);
    if (label?.verdict !== 'no') continue;
    const human = label.exclusion_code ?? '(none)';
    for (const auto of new Set(item.candidates.map((c) => c.exclusion_code ?? '(accepted)'))) {
      by_code[auto] ??= {};
      by_code[auto][human] = (by_code[auto][human] ?? 0) + 1;
    }
  }

  const linkage_error: CalibrationResults['linkage_error'] = {};
  for (const proxy of ADMITTED_PROXIES) {
    const nos = items.filter((i) => i.proxies.includes(proxy) && sheetA.get(i.item_id)?.verdict === 'no');
    const linkage = nos.filter((i) => sheetA.get(i.item_id)?.exclusion_code === 'linkage_error').length;
    linkage_error[proxy] = { no: nos.length, linkage_error: linkage, rate: nos.length ? round4(linkage / nos.length) : null };
  }

  const raw: Record<string, number> = {};
  const weighted: Record<string, number> = {};
  let yesWeight = 0;
  for (const item of items) {
    const label = sheetA.get(item.item_id);
    if (label?.verdict === 'yes') raw[label.cause_code] = (raw[label.cause_code] ?? 0) + 1;
  }
  for (const r of rows) {
    if (r.label.verdict !== 'yes') continue;
    weighted[r.label.cause_code] = (weighted[r.label.cause_code] ?? 0) + r.weight;
    yesWeight += r.weight;
  }
  const weighted_share = Object.fromEntries(Object.entries(weighted).map(([k, v]) => [k, round4(v / yesWeight)]));

  const agreement = agreementBetween(items, sheetA, sheetB, plan.kappa_floor);

  return {
    sampler_version: CALIBRATION_SAMPLER_VERSION,
    plan,
    items: items.length,
    labelled: sheetA.size,
    unlabelled: items.length - sheetA.size,
    unclear: [...sheetA.values()].filter((l) => l.verdict === 'unclear').length,
    unrepresented_population: unrepresented,
    strata,
    proxies,
    definitions,
    chosen_definition: chosen?.name ?? null,
    repos,
    rejections: { wrongly_rejected: { yes: rejYes, decided: rejDecided, rate: rejDecided ? round4(rejYes / rejDecided) : null, ci95: wilsonInterval(rejYes, rejDecided) }, by_code },
    linkage_error,
    causes: { raw, weighted_share },
    agreement,
  };
}

export interface CalibrationRun {
  plan: CalibrationPlan;
  /** Model labeller A's labels on every item; model B's are the agreement check. */
  model: CalibrationResults;
  /** The person's labels on the audit subset, compared with model A. */
  human: CalibrationResults;
  /** The person against model B, for a second view of model–human agreement. */
  human_vs_b: Agreement;
  /** Model labels stand in for the full sample only if the person and model A agree on the verdict at or above the floor. */
  models_stand_in: boolean;
  /** The estimates the pick and the validation table use: the model's if they stand in, else the human audit's. */
  primary: 'model' | 'human';
  chosen_definition: string | null;
  /** HOK-3028 §6 label-noise diagnostic: precision of the chosen definition (else cr-0.1.0) against the person's labels. */
  gate_label_precision: { definition: string; precision: Estimate };
}

export function scoreCalibrationRun(input: {
  plan: CalibrationPlan;
  items: readonly SampleItem[];
  cells: readonly SampleCell[];
  sheets: { a: ReadonlyMap<string, HumanLabel>; b: ReadonlyMap<string, HumanLabel>; h: ReadonlyMap<string, HumanLabel> };
  seed: string;
  resamples?: number | undefined;
}): CalibrationRun {
  const { plan, items, cells, sheets, seed, resamples } = input;
  const model = scoreCalibration({ plan, items, cells, sheetA: sheets.a, sheetB: sheets.b, seed, resamples });
  const audited = items.filter((i) => i.audit);
  const human = scoreCalibration({ plan, items: audited, cells, sheetA: sheets.h, sheetB: sheets.a, seed, resamples });
  const kappa = human.agreement.corrective.kappa;
  const models_stand_in = kappa !== null && kappa >= plan.kappa_floor;
  const primary = models_stand_in ? model : human;
  const gateDefinition = primary.chosen_definition ?? 'cr-0.1.0';
  return {
    plan,
    model,
    human,
    human_vs_b: agreementBetween(audited, sheets.h, sheets.b, plan.kappa_floor),
    models_stand_in,
    primary: models_stand_in ? 'model' : 'human',
    chosen_definition: primary.chosen_definition,
    gate_label_precision: { definition: gateDefinition, precision: human.definitions.find((d) => d.name === gateDefinition)!.precision },
  };
}

// ── Shareable table ────────────────────────────────────────────────────────

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const estCell = (e: Estimate) => (e.estimate === null ? '—' : `${pct(e.estimate)} (${pct(e.ci95?.low)}–${pct(e.ci95?.high)})`);
const kappaCell = (k: number | null) => (k === null ? '—' : k.toFixed(2));

function renderAgreement(lines: string[], title: string, agreement: Agreement, floor: number) {
  lines.push('', `### ${title} (floor κ ≥ ${floor})`, '');
  for (const [field, k] of Object.entries(agreement) as [string, KappaResult][]) {
    lines.push(`**${field}:** κ = ${kappaCell(k.kappa)} over ${k.pairs} pairs`, '', '| Code | Used | κ | Verdict |', '| --- | --- | --- | --- |');
    for (const [code, c] of Object.entries(k.per_code)) lines.push(`| ${code} | ${c.used} | ${kappaCell(c.kappa)} | ${c.verdict} |`);
    lines.push('');
  }
}

function renderEstimates(lines: string[], r: CalibrationResults) {
  lines.push('', `${r.items} items · ${r.labelled} labelled · ${r.unclear} unclear · ${r.repos.length} repos`);
  if (r.unrepresented_population) lines.push('', `${r.unrepresented_population} population PRs sit in cells with no decided item and are not covered by these estimates.`);

  lines.push('', '### Definitions', '', '| Definition | Precision | Recall |', '| --- | --- | --- |');
  for (const d of r.definitions) lines.push(`| ${d.name}: ${d.description} | ${estCell(d.precision)} | ${estCell(d.recall)} |`);
  lines.push('', `Pick under the plan (highest recall with precision ≥ ${pct(r.plan.definition_precision_floor)}): **${r.chosen_definition ?? 'none qualifies'}**`);

  lines.push('', '### Proxies', '', '| Proxy | Precision | n | Recall |', '| --- | --- | --- | --- |');
  for (const [proxy, e] of Object.entries(r.proxies)) lines.push(`| ${proxy} | ${estCell(e.precision)} | ${e.precision.n} | ${estCell(e.recall)} |`);

  lines.push('', '### Strata (unweighted)', '', '| Stratum | Sampled | Yes | No | Unclear | Yes rate (Wilson 95%) |', '| --- | --- | --- | --- | --- | --- |');
  for (const st of r.strata) lines.push(`| ${st.stratum} | ${st.sampled} | ${st.yes} | ${st.no} | ${st.unclear} | ${pct(st.yes_rate)} (${pct(st.yes_rate_ci95?.low)}–${pct(st.yes_rate_ci95?.high)}) |`);

  lines.push('', '### Repos (pseudonymized)', '', '| Repo | Sampled | Precision (any proxy) | Recall |', '| --- | --- | --- | --- |');
  for (const repo of r.repos) lines.push(`| ${repo.pseudonym} | ${repo.sampled} | ${estCell(repo.precision)} | ${estCell(repo.recall)} |`);

  const w = r.rejections.wrongly_rejected;
  lines.push('', '### Rejections', '', `Wrongly rejected (judged corrective): ${w.yes} of ${w.decided} (${pct(w.rate)}, Wilson ${pct(w.ci95?.low)}–${pct(w.ci95?.high)}).`);
  const labelCodes = [...new Set(Object.values(r.rejections.by_code).flatMap((m) => Object.keys(m)))].sort();
  if (labelCodes.length) {
    lines.push('', `| Automatic code \\ labelled code | ${labelCodes.join(' | ')} |`, `| --- |${labelCodes.map(() => ' --- |').join('')}`);
    for (const [auto, m] of Object.entries(r.rejections.by_code).sort()) lines.push(`| ${auto} | ${labelCodes.map((h) => m[h] ?? 0).join(' | ')} |`);
  }
  lines.push('', '| Proxy | Labelled no | linkage_error | Rate |', '| --- | --- | --- | --- |');
  for (const [proxy, l] of Object.entries(r.linkage_error)) lines.push(`| ${proxy} | ${l.no} | ${l.linkage_error} | ${pct(l.rate)} |`);

  lines.push('', '### Causes (items labelled yes)', '', '| Cause | Count | Weighted share |', '| --- | --- | --- |');
  for (const code of CAUSE_CODES) if (r.causes.raw[code]) lines.push(`| ${code} | ${r.causes.raw[code]} | ${pct(r.causes.weighted_share[code])} |`);
}

/**
 * The validation table to post. Repos appear only as pseudonyms, and no cell
 * populations are shown: populations would identify repos, and the repo set
 * would narrow down which repos the evaluation slice holds.
 */
/** `auditCheck`: the auditor's score on hidden known-answer rows, when the sheet had them. */
export function renderCalibrationMarkdown(run: CalibrationRun, auditCheck?: { correct: number; items: number; min_correct: number; passed: boolean }): string {
  const { plan, model, human } = run;
  const lines: string[] = [];
  const complete = model.unlabelled === 0 && human.unlabelled === 0;
  lines.push(`# HOK-3269 calibration results${complete ? '' : ' (INCOMPLETE)'}`, '');
  if (auditCheck && !auditCheck.passed) lines.push(`**Audit rejected:** the person got ${auditCheck.correct} of ${auditCheck.items} known-answer items right (needs ${auditCheck.min_correct}). Every result below that uses the person's labels is void until another auditor relabels the subset.`, '');
  lines.push(`Horizon ${plan.horizon_days} days · plan ${plan.plan_version} · sampler ${CALIBRATION_SAMPLER_VERSION} · labellers: A ${plan.labellers.a}, B ${plan.labellers.b}, H a person (audit subset)`);
  lines.push('', 'Estimates are reweighted by cell (repo × stratum) population; 95% intervals are a stratified bootstrap. `unclear` labels are left out of rates.');

  const k = human.agreement.corrective.kappa;
  lines.push('', '## Verdict', '');
  if (auditCheck) lines.push(`- Audit check: the person got ${auditCheck.correct} of ${auditCheck.items} hidden known-answer items right (needs ${auditCheck.min_correct}); audit ${auditCheck.passed ? 'accepted' : '**rejected**'}.`);
  lines.push(`- Person vs model A on the verdict: κ = ${kappaCell(k)} over ${human.agreement.corrective.pairs} items (floor ${plan.kappa_floor}). Model labels ${run.models_stand_in ? '**stand in** for the full sample' : '**do not** stand in; estimates come from the human audit alone'}.`);
  lines.push(`- cr-0.2.0 pick (from the ${run.primary} labels): **${run.chosen_definition ?? 'none qualifies'}**`);
  lines.push(`- HOK-3028 §6 label precision (${run.gate_label_precision.definition} against the person's labels): ${estCell(run.gate_label_precision.precision)}; the diagnostic's bar is 80%.`);

  lines.push('', `## Full sample, model A labels${run.primary === 'model' ? ' (primary)' : ''}`);
  renderEstimates(lines, model);
  lines.push('', `## Human audit${run.primary === 'human' ? ' (primary)' : ''}`);
  renderEstimates(lines, human);

  lines.push('', '## Agreement');
  renderAgreement(lines, 'Person vs model A (audit subset)', human.agreement, plan.kappa_floor);
  renderAgreement(lines, 'Person vs model B (audit subset)', run.human_vs_b, plan.kappa_floor);
  renderAgreement(lines, 'Model A vs model B', model.agreement, plan.kappa_floor);
  return `${lines.join('\n').trimEnd()}\n`;
}
