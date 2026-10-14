/** Synthetic, deterministic inputs for scanner-owned suppression. */
import {
  projectSurvivalLabel,
  type ArbiterReportV1,
  type ReportCell,
} from '../arbiter-report.js';
import { completeCandidateFeaturesV1Fixture } from './candidate-features.js';
import { harvestedSurvivalLabelFixture } from './arbiter-survival-label.js';

const cell = (
  n: number,
  value: number,
  basis: 'descriptive' | 'out_of_sample_prediction' = 'descriptive',
): ReportCell => ({
  basis,
  n,
  value,
  ci: { low: Math.max(0, value - 0.05), high: value + 0.05, level: 0.95 },
  suppressed: false,
  suppression_reasons: [],
});
const section = <T>(
  rows: T[],
  basis: 'descriptive' | 'out_of_sample_prediction' = 'descriptive',
) => ({ basis, status: 'shown' as const, suppression_reasons: [], rows });
const label = projectSurvivalLabel(harvestedSurvivalLabelFixture);
const policy = {
  policy_version: '1.0.0',
  min_cell_n: 20,
  min_agent_coverage: 0.6,
  min_harness_coverage: 0.6,
  min_exact_model_coverage: 0.6,
  min_cost_coverage: 0.6,
  min_reworked_for_retrospective: 20,
  ci_method: 'wilson' as const,
  ci_level: 0.95 as const,
};
function draft(
  kind: 'full' | 'sparse' | 'harness_only' | 'prediction',
): ArbiterReportV1 {
  const n = kind === 'sparse' ? 12 : kind === 'full' ? 240 : 100;
  const exact = kind === 'harness_only' ? 0 : Math.round(n * 0.8);
  const harness = Math.round(n * 0.9);
  const agents = Math.round(n * 0.8);
  const prs: ArbiterReportV1['prs'] = Array.from({ length: n }, (_, i) => ({
    pr_number: i + 1,
    merged_at: '2026-08-01T00:00:00Z',
    attribution: {
      agent: {
        status: i < agents ? 'agent' : 'unknown',
        confidence: i < agents ? 0.9 : null,
        methods: i < agents ? ['first_party_route_metadata' as const] : [],
      },
      harness: {
        id: i < harness ? 'codex' : null,
        confidence: i < harness ? 0.9 : null,
        methods: i < harness ? ['first_party_route_metadata' as const] : [],
      },
      exact_model: {
        id: i < exact ? 'openai/gpt-6' : null,
        confidence: i < exact ? 1 : null,
        methods: i < exact ? ['first_party_route_metadata' as const] : [],
        evidence: i < exact ? ('first_party_executed' as const) : null,
      },
    },
    features: completeCandidateFeaturesV1Fixture,
    labels: [label],
    cost: {
      actual_usd: i < exact ? 1.25 : null,
      estimated_usd: 1.1,
      cost_source:
        i < exact
          ? ('provider_reported' as const)
          : ('local_estimate' as const),
      coverage: i < exact ? ('complete' as const) : ('partial' as const),
      pricing_revision: 'pricing-2026-09',
    },
    prediction:
      kind === 'prediction'
        ? {
            basis: 'out_of_sample_prediction' as const,
            score: 0.7,
            flagged: i % 3 === 0,
          }
        : null,
  }));
  const base: ArbiterReportV1 = {
    schema_version: 'arbiter_report/v1',
    data_origin: 'fixture',
    repo: {
      host: 'github',
      owner: 'hokusai-fixtures',
      name: kind === 'full' ? '.github' : kind.replaceAll('_', '-'),
    },
    scan: {
      scanned_at: '2026-10-14T00:00:00Z',
      as_of: '2026-10-14T00:00:00Z',
      scanner: { package: '@hokusai/scan', version: '0.4.0' },
      integration_branch: 'auto/integration',
      lookback_days: 180,
      window: {
        merged_from: '2026-04-14T00:00:00Z',
        merged_to: '2026-10-14T00:00:00Z',
      },
      horizons_days: [30],
      contracts: {
        candidate_features: 'candidate_features/v1',
        survival_label: '1.0.0',
        labeller_version: '0.1.0',
        normalization_version: '1.0.0',
      },
    },
    policy,
    coverage: {
      basis: 'descriptive',
      prs_enumerated: n,
      prs_eligible: n,
      labels_by_horizon: [{ horizon_days: 30, labelled: n, missing: [] }],
      attribution: {
        agent: {
          identified_agent: agents,
          identified_human_signal: 0,
          unknown: n - agents,
          rate: agents / n,
        },
        harness: {
          identified: harness,
          unknown: n - harness,
          rate: harness / n,
        },
        exact_model: { identified: exact, unknown: n - exact, rate: exact / n },
        methods: [
          {
            dimension: 'agent',
            method: 'first_party_route_metadata',
            count: agents,
          },
          {
            dimension: 'harness',
            method: 'first_party_route_metadata',
            count: harness,
          },
          {
            dimension: 'exact_model',
            method: 'first_party_route_metadata',
            count: exact,
          },
        ],
      },
    },
    prs,
    aggregates: {
      survival_by_horizon: section([
        { horizon_days: 30, outcome: 'survived' as const, cell: cell(n, 0.75) },
      ]),
      risk_ratios: section([
        {
          horizon_days: 30,
          feature: 'tests_changed' as const,
          bucket: 'true',
          rework_rate: cell(n, 0.2),
          baseline_rate: cell(n, 0.3),
          ratio: cell(n, 0.67),
        },
      ]),
      survival_by_model: section([
        { horizon_days: 30, model_id: 'openai/gpt-6', cell: cell(exact, 0.8) },
      ]),
      survival_by_harness: section([
        { horizon_days: 30, harness_id: 'codex', cell: cell(harness, 0.75) },
      ]),
      cost_adjusted_survival_by_model: section([
        {
          horizon_days: 30,
          model_id: 'openai/gpt-6',
          cost_basis: 'actual' as const,
          cell: cell(exact, 0.65),
        },
      ]),
    },
    retrospective:
      kind === 'prediction'
        ? {
            basis: 'out_of_sample_prediction',
            horizon_days: 30,
            threshold: 0.5,
            calibration: 'portable',
            n_reworked: 30,
            precision: cell(19, 0.7, 'out_of_sample_prediction'),
            recall: cell(30, 0.6, 'out_of_sample_prediction'),
            flagged_share: cell(n, 0.33, 'out_of_sample_prediction'),
            suppressed: false,
            suppression_reasons: [],
          }
        : null,
    cost: {
      actual: {
        basis: 'descriptive',
        total_usd: exact * 1.25,
        cost_source: 'provider_reported',
        coverage: 'partial',
        prs_priced: exact,
        prs_unknown: n - exact,
        suppressed: false,
        suppression_reasons: [],
      },
      estimated: {
        basis: 'descriptive',
        kind: 'estimate',
        total_usd: n * 1.1,
        cost_source: 'local_estimate',
        pricing_revision: 'pricing-2026-09',
        pricing_timestamp: '2026-09-07T00:00:00Z',
        coverage: 'complete',
        prs_priced: n,
        prs_unknown: 0,
        unpriced_models: 0,
        suppressed: false,
        suppression_reasons: [],
      },
    },
    model_provenance:
      kind === 'prediction'
        ? {
            head_id: 'report-head',
            head_version: '1.0.0',
            trained_on: 'arbiter-corpus',
            training_repo_count: 20,
            split: 'leave_repo_out',
            split_date: '2026-09-01',
            repo_in_training_set: false,
            trained_at: '2026-09-15T00:00:00Z',
          }
        : null,
    eligibility: {
      exact_model_table: true,
      harness_table: true,
      cost_adjusted_by_model: true,
      retrospective: kind === 'prediction',
      model_routing_cta: true,
      reasons: [],
    },
  };
  return base;
}
export const reportDraftFixtures = {
  full: () => draft('full'),
  sparse: () => draft('sparse'),
  harness_only: () => draft('harness_only'),
  prediction: () => draft('prediction'),
};
