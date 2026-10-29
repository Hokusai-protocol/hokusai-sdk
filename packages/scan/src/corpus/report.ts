/**
 * Corpus sanity report (HOK-3268): per repo × horizon summaries of the S2
 * and corrective outputs, sanity flags, and merge-convention spread.
 *
 * Computed once from the persisted corpus files, so the decision issues that
 * consume it (HOK-2822, HOK-3020) never re-scan the corpus. Reads only
 * derived records: codes, counts, URLs. Pure: rows are passed in as
 * iterables, so large repos stream.
 */

import {
  ADMITTED_PROXIES,
  HORIZONS,
  type ArbiterSurvivalLabelV1,
  type CorrectiveCandidateV1,
  type CorrectiveReworkLabelV1,
} from '@hokusai/core';
import { wilsonInterval, type Interval } from '../report/stats.js';

export const CORPUS_REPORT_VERSION = '1.0.0';

/** Sanity bounds on the 30-day corrective rate (HOK-3268). */
export const DEGENERATE_RATE = 0.005;
export const CHURN_RATE = 0.25;
export const FLAG_HORIZON = 30;
/** Sensitivity: the rate when SZZ links need at least this many blamed lines (a calibration choice, HOK-3269). */
export const SZZ_SENSITIVITY_MIN_LINES = 3;

type AdmittedProxy = (typeof ADMITTED_PROXIES)[number];
const HIGH_PRECISION: readonly AdmittedProxy[] = ['revert', 'repair_reference'];

export interface HorizonSummary {
  horizon_days: number;
  prs: number;
  /** S2 `report_outcome` counts; `missing` is a null outcome. */
  s2_outcomes: Record<string, number>;
  corrective: { true: number; false: number; null: number };
  /** true / (true + false). */
  corrective_rate: number | null;
  corrective_rate_ci95: Interval | null;
  /** Corrective rows each proxy supports (a row can have several), and rows it alone supports. */
  proxy_contribution: Record<string, { rows: number; sole: number }>;
  /** Rate when only P1 (revert) and P2 (repair_reference) count. */
  corrective_rate_high_precision: number | null;
  /** Rate when SZZ links need ≥ {@link SZZ_SENSITIVITY_MIN_LINES} blamed lines. */
  corrective_rate_szz_min_lines: number | null;
  candidates: { total: number; rejected: number; rejection_rate: number | null };
  rejections_by_reason: Record<string, number>;
  rejections_by_proxy: Record<string, { total: number; rejected: number; rejection_rate: number | null }>;
  /** Automated `linkage_error` rejections; the human-measured rate comes from HOK-3269. */
  linkage_error: { rejected: number; rate: number | null };
}

export interface RepoSummary {
  repo: string;
  tier: string | null;
  merge_convention: string | null;
  horizons: HorizonSummary[];
  /** Accepted revert candidates (≤ 60 days) by the class of reason the merge bot gave. */
  revert_reasons: Record<string, number>;
}

export interface RepoSummaryInput {
  repo: string;
  tier?: string | null;
  mergeConvention?: string | null;
  s2Rows: Iterable<ArbiterSurvivalLabelV1>;
  correctiveRows: Iterable<CorrectiveReworkLabelV1>;
  candidates: Iterable<CorrectiveCandidateV1>;
}

const ratio = (k: number, n: number) => (n ? round4(k / n) : null);
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};
const sortKeys = <T>(map: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));

function blamedLines(candidate: CorrectiveCandidateV1): number {
  return candidate.evidence.filter((e) => e.kind === 'blamed_lines').reduce((sum, e) => sum + (e.count ?? 0), 0);
}

/** One repo's summary per horizon. Streams each iterable once. */
export function summarizeCorpusRepo(input: RepoSummaryInput): RepoSummary {
  const horizons = new Map<number, HorizonSummary>();
  const at = (h: number) => {
    let s = horizons.get(h);
    if (!s) {
      s = {
        horizon_days: h,
        prs: 0,
        s2_outcomes: {},
        corrective: { true: 0, false: 0, null: 0 },
        corrective_rate: null,
        corrective_rate_ci95: null,
        proxy_contribution: Object.fromEntries(ADMITTED_PROXIES.map((p) => [p, { rows: 0, sole: 0 }])),
        corrective_rate_high_precision: null,
        corrective_rate_szz_min_lines: null,
        candidates: { total: 0, rejected: 0, rejection_rate: null },
        rejections_by_reason: {},
        rejections_by_proxy: {},
        linkage_error: { rejected: 0, rate: null },
      };
      horizons.set(h, s);
    }
    return s;
  };
  for (const h of HORIZONS) at(h);

  for (const row of input.s2Rows) {
    const s = at(row.horizon_days);
    s.prs++;
    bump(s.s2_outcomes, row.outcome.report_outcome ?? 'missing');
  }

  // Candidates first: corrective rows name the pairs (= accepted candidates) behind them.
  const accepted = new Map<string, CorrectiveCandidateV1>();
  const revertReasons: Record<string, number> = {};
  for (const c of input.candidates) {
    if (c.status === 'accepted') accepted.set(c.candidate_id, c);
    if (c.status === 'accepted' && c.proxy === 'revert') {
      const reason = c.evidence.find((e) => e.kind === 'revert_reason')?.ref;
      if (reason) bump(revertReasons, reason);
    }
    for (const s of horizons.values()) {
      if (c.lag_seconds > s.horizon_days * 86_400) continue;
      const rejected = c.status === 'rejected';
      s.candidates.total++;
      const byProxy = (s.rejections_by_proxy[c.proxy] ??= { total: 0, rejected: 0, rejection_rate: null });
      byProxy.total++;
      if (!rejected) continue;
      s.candidates.rejected++;
      byProxy.rejected++;
      bump(s.rejections_by_reason, c.exclusion_code ?? 'unknown');
      if (c.exclusion_code === 'linkage_error') s.linkage_error.rejected++;
    }
  }

  const highPrecision = new Map<number, number>();
  const szzMin = new Map<number, number>();
  for (const row of input.correctiveRows) {
    const s = at(row.horizon_days);
    if (row.corrective === null) {
      s.corrective.null++;
      continue;
    }
    if (!row.corrective) {
      s.corrective.false++;
      continue;
    }
    s.corrective.true++;
    const proxies = row.reason_codes.filter((c): c is AdmittedProxy => (ADMITTED_PROXIES as readonly string[]).includes(c));
    for (const p of proxies) {
      const cell = s.proxy_contribution[p]!;
      cell.rows++;
      if (proxies.length === 1) cell.sole++;
    }
    if (proxies.some((p) => HIGH_PRECISION.includes(p))) highPrecision.set(row.horizon_days, (highPrecision.get(row.horizon_days) ?? 0) + 1);
    const pairs = row.repair_pair_ids.map((id) => accepted.get(id)).filter((c): c is CorrectiveCandidateV1 => c !== undefined);
    // A row whose pairs can't be resolved keeps its label in the sensitivity count.
    const kept = pairs.length === 0 || pairs.some((c) => c.proxy !== 'szz' || blamedLines(c) >= SZZ_SENSITIVITY_MIN_LINES);
    if (kept) szzMin.set(row.horizon_days, (szzMin.get(row.horizon_days) ?? 0) + 1);
  }

  for (const s of horizons.values()) {
    const n = s.corrective.true + s.corrective.false;
    s.corrective_rate = ratio(s.corrective.true, n);
    s.corrective_rate_ci95 = wilsonInterval(s.corrective.true, n);
    s.corrective_rate_high_precision = ratio(highPrecision.get(s.horizon_days) ?? 0, n);
    s.corrective_rate_szz_min_lines = ratio(szzMin.get(s.horizon_days) ?? 0, n);
    s.candidates.rejection_rate = ratio(s.candidates.rejected, s.candidates.total);
    s.linkage_error.rate = ratio(s.linkage_error.rejected, s.candidates.total);
    for (const cell of Object.values(s.rejections_by_proxy)) cell.rejection_rate = ratio(cell.rejected, cell.total);
    s.s2_outcomes = sortKeys(s.s2_outcomes);
    s.rejections_by_reason = sortKeys(s.rejections_by_reason);
    s.rejections_by_proxy = sortKeys(s.rejections_by_proxy);
  }
  return {
    repo: input.repo,
    tier: input.tier ?? null,
    merge_convention: input.mergeConvention ?? null,
    horizons: [...horizons.values()].sort((a, b) => a.horizon_days - b.horizon_days),
    revert_reasons: sortKeys(revertReasons),
  };
}

// ── Flags ──────────────────────────────────────────────────────────────────

export type SanityFlagCode = 'degenerate_rate' | 'churn_rate';

export interface SanityFlag {
  code: SanityFlagCode;
  repos: string[];
  merge_convention: string | null;
  detail: string;
  /** From the notes file: why the flag is acceptable, or that the repo was dropped. Null until explained. */
  resolution: { action: 'explained' | 'dropped'; note: string } | null;
}

export interface FlagNote {
  code: SanityFlagCode;
  repo: string;
  action: 'explained' | 'dropped';
  note: string;
}

const pct = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);
const rateAt = (repo: RepoSummary, field: 'corrective_rate' | 'corrective_rate_high_precision' = 'corrective_rate') =>
  repo.horizons.find((h) => h.horizon_days === FLAG_HORIZON)?.[field] ?? null;

/** Flags on the 30-day corrective rate, each joined to its note when one exists. */
export function sanityFlags(repos: readonly RepoSummary[], notes: readonly FlagNote[] = []): SanityFlag[] {
  const flags: SanityFlag[] = [];
  for (const repo of repos) {
    const rate = rateAt(repo);
    if (rate === null) continue;
    if (rate < DEGENERATE_RATE) flags.push({ code: 'degenerate_rate', repos: [repo.repo], merge_convention: repo.merge_convention, detail: `${pct(rate)} at ${FLAG_HORIZON}d is below ${pct(DEGENERATE_RATE)}`, resolution: null });
    if (rate > CHURN_RATE) flags.push({ code: 'churn_rate', repos: [repo.repo], merge_convention: repo.merge_convention, detail: `${pct(rate)} at ${FLAG_HORIZON}d is above ${pct(CHURN_RATE)}`, resolution: null });
  }
  for (const flag of flags) {
    const note = notes.find((n) => n.code === flag.code && n.repo === flag.repos[0]);
    if (note) flag.resolution = { action: note.action, note: note.note };
  }
  return flags;
}

/**
 * Range of 30-day rates among repos sharing a merge convention. Informational, not a flag:
 * teams with the same convention differ widely in revert culture and in where they track bugs.
 */
export interface ConventionSpread {
  merge_convention: string;
  repos: number;
  low: { repo: string; rate: number };
  high: { repo: string; rate: number };
  /** The same range when only P1 (revert) and P2 (repair_reference) count. */
  high_precision: { low: number; high: number };
}

export function conventionSpread(repos: readonly RepoSummary[]): ConventionSpread[] {
  const groups = new Map<string, RepoSummary[]>();
  for (const repo of repos) if (repo.merge_convention && rateAt(repo) !== null) groups.set(repo.merge_convention, [...(groups.get(repo.merge_convention) ?? []), repo]);
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([convention, members]) => {
      const sorted = [...members].sort((a, b) => rateAt(a)! - rateAt(b)! || a.repo.localeCompare(b.repo));
      const hp = members.map((m) => rateAt(m, 'corrective_rate_high_precision') ?? 0);
      return {
        merge_convention: convention,
        repos: members.length,
        low: { repo: sorted[0]!.repo, rate: rateAt(sorted[0]!)! },
        high: { repo: sorted.at(-1)!.repo, rate: rateAt(sorted.at(-1)!)! },
        high_precision: { low: Math.min(...hp), high: Math.max(...hp) },
      };
    });
}

/** A merge-convention observation fed back to HOK-2822, recorded in the notes file. */
export interface ConventionFinding {
  merge_convention: string;
  repos: string[];
  finding: string;
}

// ── Markdown ───────────────────────────────────────────────────────────────

const ci = (i: Interval | null) => (i ? `${(i.low * 100).toFixed(1)}–${(i.high * 100).toFixed(1)}` : 'n/a');

/** The summary table posted to HOK-3268: one row per repo × horizon, then flags. */
export function renderCorpusReportMarkdown(report: {
  run_id: string;
  as_of: string;
  repos: readonly RepoSummary[];
  flags: readonly SanityFlag[];
  spread?: readonly ConventionSpread[];
  conventionFindings?: readonly ConventionFinding[];
}): string {
  const lines = [
    `# Corpus sanity report`,
    '',
    `Run \`${report.run_id}\`, as-of ${report.as_of}. Corrective rate = true / (true + false), 95% Wilson CI. ` +
      `Proxy columns count corrective rows each proxy supports (rows can have several). ` +
      `"P1+P2" is the rate from reverts and repair references alone; "SZZ≥${SZZ_SENSITIVITY_MIN_LINES}" requires SZZ links to blame at least ${SZZ_SENSITIVITY_MIN_LINES} lines. ` +
      `Rejected = share of candidates (lag ≤ horizon) the labeller rejected.`,
    '',
    '| Repo | Convention | H | PRs | S2 survived | Corrective | 95% CI | P1+P2 | SZZ≥3 | revert | repair_ref | szz | regr_issue | Rejected | linkage_error |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const repo of report.repos) {
    for (const h of repo.horizons) {
      const labelled = h.prs - (h.s2_outcomes.missing ?? 0);
      const c = h.proxy_contribution;
      lines.push(
        `| ${repo.repo} | ${repo.merge_convention ?? ''} | ${h.horizon_days} | ${h.prs} | ${pct(ratio(h.s2_outcomes.survived ?? 0, labelled))} | ${pct(h.corrective_rate)} | ${ci(h.corrective_rate_ci95)} | ${pct(h.corrective_rate_high_precision)} | ${pct(h.corrective_rate_szz_min_lines)} | ${c.revert?.rows ?? 0} | ${c.repair_reference?.rows ?? 0} | ${c.szz?.rows ?? 0} | ${c.regression_issue?.rows ?? 0} | ${pct(h.candidates.rejection_rate)} | ${h.linkage_error.rejected} |`,
      );
    }
  }
  lines.push('', '## Sanity flags', '');
  if (!report.flags.length) lines.push('None.');
  for (const flag of report.flags) {
    lines.push(`- **${flag.code}** (${flag.repos.join(', ')}): ${flag.detail}.`);
    lines.push(flag.resolution ? `  - ${flag.resolution.action}: ${flag.resolution.note}` : '  - **unresolved**');
  }
  if (report.spread?.length) {
    lines.push('', `## Spread by merge convention (${FLAG_HORIZON}d, informational)`, '', '| Convention | Repos | Lowest | Highest | P1+P2 range |', '|---|---|---|---|---|');
    for (const g of report.spread) lines.push(`| ${g.merge_convention} | ${g.repos} | ${pct(g.low.rate)} (${g.low.repo}) | ${pct(g.high.rate)} (${g.high.repo}) | ${pct(g.high_precision.low)}–${pct(g.high_precision.high)} |`);
  }
  if (report.conventionFindings?.length) {
    lines.push('', '## Merge-convention findings', '');
    for (const f of report.conventionFindings) lines.push(`- **${f.merge_convention}**${f.repos.length ? ` (${f.repos.join(', ')})` : ''}: ${f.finding}`);
  }
  return `${lines.join('\n')}\n`;
}
