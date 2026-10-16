import { REPORT_FEATURE_BUCKETS, type ArbiterReportV1, type ReportCell } from '@hokusai/core';
import { katzLogRatioInterval, nearestRankQuartiles, quartileOf, wilsonInterval } from './stats.js';

type Row = ArbiterReportV1['prs'][number];
type Horizon = ArbiterReportV1['scan']['horizons_days'][number];
type Section<T> = { basis: 'descriptive'; status: 'shown'; suppression_reasons: []; rows: T[] };
const section = <T>(rows: T[]): Section<T> => ({ basis: 'descriptive', status: 'shown', suppression_reasons: [], rows });
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const cell = (k: number, n: number): ReportCell => {
  const ci = wilsonInterval(k, n);
  return { basis: 'descriptive', n, value: n ? round4(k / n) : 0, ci: ci && { ...ci, level: 0.95 }, suppressed: false, suppression_reasons: [] };
};
const reworked = (row: Row, h: Horizon): boolean => {
  const outcome = row.labels.find((label) => label.horizon_days === h)?.outcome.report_outcome;
  return outcome === 'followup' || outcome === 'substantially_rewritten' || outcome === 'reverted';
};
const labelled = (row: Row, h: Horizon): boolean => row.labels.find((label) => label.horizon_days === h)?.outcome.report_outcome != null;

/** Compute descriptive aggregates from the final PR set on every scan. */
export function buildAggregates(rows: readonly Row[], horizons: readonly Horizon[]): ArbiterReportV1['aggregates'] {
  const survival: ArbiterReportV1['aggregates']['survival_by_horizon']['rows'] = [];
  const risks: ArbiterReportV1['aggregates']['risk_ratios']['rows'] = [];
  const models: ArbiterReportV1['aggregates']['survival_by_model']['rows'] = [];
  const harnesses: ArbiterReportV1['aggregates']['survival_by_harness']['rows'] = [];
  const outcomes = ['survived', 'followup', 'substantially_rewritten', 'reverted'] as const;
  for (const h of horizons) {
    const eligible = rows.filter((r) => labelled(r, h));
    for (const outcome of outcomes) survival.push({ horizon_days: h, outcome, cell: cell(eligible.filter((r) => r.labels.find((l) => l.horizon_days === h)?.outcome.report_outcome === outcome).length, eligible.length) });
    const cuts = nearestRankQuartiles(eligible.map((r) => r.features.loc_touched).filter((v): v is number => v !== null));
    for (const [feature, buckets] of Object.entries(REPORT_FEATURE_BUCKETS) as [keyof typeof REPORT_FEATURE_BUCKETS, readonly string[]][]) {
      const bucketOf = (r: Row): string | null => {
        if (feature === 'tests_changed') return r.features.tests_changed === null ? null : String(r.features.tests_changed);
        if (feature === 'files_touched_bucket') {
          if (r.features.files_touched_bucket !== null) return r.features.files_touched_bucket;
          const count = r.features.files_touched;
          return count === null ? null : count <= 1 ? '1' : count <= 5 ? '2_5' : count <= 15 ? '6_15' : '16_plus';
        }
        return r.features.loc_touched === null || !cuts ? null : quartileOf(r.features.loc_touched, cuts);
      };
      const known = eligible.filter((r) => bucketOf(r) !== null);
      for (const bucket of buckets) {
        const inside = known.filter((r) => bucketOf(r) === bucket);
        const outside = known.filter((r) => bucketOf(r) !== bucket);
        const k1 = inside.filter((r) => reworked(r, h)).length;
        const k2 = outside.filter((r) => reworked(r, h)).length;
        const ratio = katzLogRatioInterval(k1, inside.length, k2, outside.length);
        risks.push({ horizon_days: h, feature, bucket, rework_rate: cell(k1, inside.length), baseline_rate: cell(k2, outside.length), ratio: { basis: 'descriptive', n: Math.min(inside.length, outside.length), value: ratio?.ratio ?? 0, ci: ratio && { low: ratio.low, high: ratio.high, level: 0.95 }, suppressed: false, suppression_reasons: [] } });
      }
    }
    for (const id of [...new Set(eligible.map((r) => r.attribution.exact_model.id).filter((v): v is string => v !== null))].sort()) {
      const group = eligible.filter((r) => r.attribution.exact_model.id === id);
      models.push({ horizon_days: h, model_id: id, cell: cell(group.filter((r) => !reworked(r, h)).length, group.length) });
    }
    for (const id of [...new Set(eligible.map((r) => r.attribution.harness.id).filter((v): v is string => v !== null))].sort()) {
      const group = eligible.filter((r) => r.attribution.harness.id === id);
      harnesses.push({ horizon_days: h, harness_id: id, cell: cell(group.filter((r) => !reworked(r, h)).length, group.length) });
    }
  }
  return { survival_by_horizon: section(survival), risk_ratios: section(risks), survival_by_model: section(models), survival_by_harness: section(harnesses), cost_adjusted_survival_by_model: section([]) };
}

export function buildCoverage(rows: readonly Row[], horizons: readonly Horizon[]): ArbiterReportV1['coverage'] {
  const n = rows.length;
  const counts = (predicate: (r: Row) => boolean) => {
    const identified = rows.filter(predicate).length;
    return { identified, unknown: n - identified, rate: n ? round4(identified / n) : 0 };
  };
  const agent = counts((r) => r.attribution.agent.status === 'agent');
  const methods = new Map<string, number>();
  for (const row of rows) for (const dimension of ['agent', 'harness', 'exact_model'] as const)
    for (const method of new Set(row.attribution[dimension].methods)) methods.set(`${dimension}:${method}`, (methods.get(`${dimension}:${method}`) ?? 0) + 1);
  return {
    basis: 'descriptive', prs_enumerated: n, prs_eligible: rows.filter((r) => horizons.some((h) => labelled(r, h))).length,
    labels_by_horizon: horizons.map((h) => {
      const present = rows.filter((r) => labelled(r, h)).length;
      const missing = new Map<string, number>();
      for (const row of rows) if (!labelled(row, h)) for (const reason of row.labels.find((l) => l.horizon_days === h)?.outcome.reason_codes ?? ['missing_horizon']) missing.set(reason, (missing.get(reason) ?? 0) + 1);
      return { horizon_days: h, labelled: present, missing: [...missing].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })) };
    }),
    attribution: { agent: { identified_agent: agent.identified, identified_human_signal: 0, unknown: agent.unknown, rate: agent.rate }, harness: counts((r) => r.attribution.harness.id !== null), exact_model: counts((r) => r.attribution.exact_model.id !== null), methods: [...methods].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => { const [dimension, method] = key.split(':') as [ArbiterReportV1['coverage']['attribution']['methods'][number]['dimension'], ArbiterReportV1['coverage']['attribution']['methods'][number]['method']]; return { dimension, method, count }; }) },
  };
}
