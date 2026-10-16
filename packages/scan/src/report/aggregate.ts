import { REPORT_FEATURE_BUCKETS, type ArbiterReportV1, type ReportCell, type SurvivalLabelProjectionV1 } from '@hokusai/core';
import { katzLogRatioInterval, nearestRankQuartiles, quartileOf, wilsonInterval } from './stats.js';

type Pr = ArbiterReportV1['prs'][number];
type H = 14 | 30 | 60;
const OUTCOMES = ['survived', 'followup', 'substantially_rewritten', 'reverted'] as const;
const emptySection = <T>(rows: T[]) => ({ basis: 'descriptive' as const, status: 'shown' as const, suppression_reasons: [] as [], rows });
function makeCell(k: number, n: number): ReportCell {
  const ci = wilsonInterval(k, n);
  return { basis: 'descriptive', n, value: n ? Math.round(k / n * 10_000) / 10_000 : null, ci: ci ? { ...ci, level: 0.95 } : null, suppressed: false, suppression_reasons: [] };
}
function ratioCell(ratio: number, n: number, ci: { low: number; high: number }): ReportCell {
  return { basis: 'descriptive', n, value: ratio, ci: { low: ci.low, high: ci.high, level: 0.95 }, suppressed: false, suppression_reasons: [] };
}
function labelAt(pr: Pr, horizon: H): SurvivalLabelProjectionV1 | undefined { return pr.labels.find((label) => label.horizon_days === horizon); }
function bucketFor(pr: Pr, feature: keyof typeof REPORT_FEATURE_BUCKETS, cuts: [number, number, number] | null): string | null {
  if (feature === 'tests_changed') return pr.features.tests_changed === null ? null : pr.features.tests_changed ? 'true' : 'false';
  if (feature === 'files_touched_bucket') return pr.features.files_touched_bucket;
  if (pr.features.loc_touched === null || !cuts) return null;
  return quartileOf(pr.features.loc_touched, cuts);
}
const reworked = (label: SurvivalLabelProjectionV1) => ['followup', 'substantially_rewritten', 'reverted'].includes(label.outcome.report_outcome ?? '');

/** Build descriptive aggregate sections from already projected and privacy-safe PR rows. */
export function buildAggregates(prs: readonly Pr[], horizons: readonly H[]): ArbiterReportV1['aggregates'] {
  const survival: ArbiterReportV1['aggregates']['survival_by_horizon']['rows'] = [];
  const risks: ArbiterReportV1['aggregates']['risk_ratios']['rows'] = [];
  const models: ArbiterReportV1['aggregates']['survival_by_model']['rows'] = [];
  const harnesses: ArbiterReportV1['aggregates']['survival_by_harness']['rows'] = [];
  for (const h of [...horizons].sort((a, b) => a - b)) {
    const labelled = prs.flatMap((pr) => { const l = labelAt(pr, h); return l?.outcome.report_outcome ? [{ pr, l }] : []; });
    for (const outcome of OUTCOMES) {
      const selected = labelled.filter(({ l }) => l.outcome.report_outcome === outcome);
      survival.push({ horizon_days: h, outcome, cell: makeCell(selected.length, labelled.length) });
    }
    for (const feature of Object.keys(REPORT_FEATURE_BUCKETS) as (keyof typeof REPORT_FEATURE_BUCKETS)[]) {
      const locValues = feature === 'loc_touched' ? labelled.map(({ pr }) => pr.features.loc_touched).filter((v): v is number => v !== null).sort((a, b) => a - b) : [];
      const cuts = nearestRankQuartiles(locValues);
      const buckets = REPORT_FEATURE_BUCKETS[feature] as readonly string[];
      for (const bucket of buckets) {
        const group = labelled.filter(({ pr }) => bucketFor(pr, feature, cuts) === bucket);
        const outside = labelled.filter(({ pr }) => bucketFor(pr, feature, cuts) !== null && bucketFor(pr, feature, cuts) !== bucket);
        const ki = group.filter(({ l }) => reworked(l)).length;
        const ko = outside.filter(({ l }) => reworked(l)).length;
        const ciRate = wilsonInterval(ki, group.length);
        const ciBase = wilsonInterval(ko, outside.length);
        const rr = katzLogRatioInterval(ki, group.length, ko, outside.length);
        risks.push({ horizon_days: h, feature, bucket, rework_rate: makeCell(ki, group.length), baseline_rate: makeCell(ko, outside.length), ratio: ratioCell(rr.ratio, Math.min(group.length, outside.length), rr) });
        // Keep explicit null CIs for empty groups; suppression supplies the reason.
        if (!ciRate || !ciBase) { /* no additional mutation needed */ }
      }
    }
    const modelIds = [...new Set(labelled.map(({ pr }) => pr.attribution.exact_model.id).filter((v): v is string => !!v))].sort();
    for (const id of modelIds) {
      const group = labelled.filter(({ pr }) => pr.attribution.exact_model.id === id);
      models.push({ horizon_days: h, model_id: id, cell: makeCell(group.filter(({ l }) => l.outcome.survived === true).length, group.length) });
    }
    const harnessIds = [...new Set(labelled.map(({ pr }) => pr.attribution.harness.id).filter((v): v is string => !!v))].sort();
    for (const id of harnessIds) {
      const group = labelled.filter(({ pr }) => pr.attribution.harness.id === id);
      harnesses.push({ horizon_days: h, harness_id: id, cell: makeCell(group.filter(({ l }) => l.outcome.survived === true).length, group.length) });
    }
  }
  return {
    survival_by_horizon: emptySection(survival), risk_ratios: emptySection(risks), survival_by_model: emptySection(models),
    survival_by_harness: emptySection(harnesses), cost_adjusted_survival_by_model: emptySection([]),
  };
}

/** Produce coverage counts from the final emitted PR rows. */
export function buildCoverage(prs: readonly Pr[], horizons: readonly H[]): ArbiterReportV1['coverage'] {
  const missingByHorizon = [...horizons].sort((a, b) => a - b).map((h) => {
    const labels = prs.map((pr) => labelAt(pr, h)).filter((label): label is SurvivalLabelProjectionV1 => !!label);
    const missing = new Map<string, number>();
    for (const label of labels) if (!label.outcome.report_outcome) for (const reason of label.outcome.reason_codes) missing.set(reason, (missing.get(reason) ?? 0) + 1);
    return { horizon_days: h, labelled: labels.filter((label) => !!label.outcome.report_outcome).length, missing: [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })) };
  });
  const identifiedAgent = prs.filter((pr) => pr.attribution.agent.status === 'agent').length;
  const identifiedHarness = prs.filter((pr) => !!pr.attribution.harness.id).length;
  const identifiedModel = prs.filter((pr) => !!pr.attribution.exact_model.id).length;
  const methods: ArbiterReportV1['coverage']['attribution']['methods'] = [];
  const tallies = new Map<string, number>();
  for (const pr of prs) for (const [dimension, values] of [['agent', pr.attribution.agent.methods], ['harness', pr.attribution.harness.methods], ['exact_model', pr.attribution.exact_model.methods]] as const) for (const method of values) {
    const key = `${dimension}\t${method}`; tallies.set(key, (tallies.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...tallies.entries()].sort(([a], [b]) => a.localeCompare(b))) { const [dimension, method] = key.split('\t'); methods.push({ dimension: dimension as 'agent' | 'harness' | 'exact_model', method: method as ArbiterReportV1['coverage']['attribution']['methods'][number]['method'], count }); }
  return {
    basis: 'descriptive', prs_enumerated: prs.length, prs_eligible: prs.filter((pr) => pr.labels.some((label) => !!label.outcome.report_outcome)).length,
    labels_by_horizon: missingByHorizon,
    attribution: {
      agent: { identified_agent: identifiedAgent, identified_human_signal: 0, unknown: prs.length - identifiedAgent, rate: prs.length ? Math.round(identifiedAgent / prs.length * 10_000) / 10_000 : 0 },
      harness: { identified: identifiedHarness, unknown: prs.length - identifiedHarness, rate: prs.length ? Math.round(identifiedHarness / prs.length * 10_000) / 10_000 : 0 },
      exact_model: { identified: identifiedModel, unknown: prs.length - identifiedModel, rate: prs.length ? Math.round(identifiedModel / prs.length * 10_000) / 10_000 : 0 }, methods,
    },
  };
}
