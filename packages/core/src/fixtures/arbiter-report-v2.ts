/**
 * Synthetic, deterministic `arbiter_report/v2` fixtures (HOK-2826 step 1).
 *
 * Built from a suppressed v1 fixture so the descriptive core is identical to
 * v1's. The retrospective is synthetic: scores, outcomes and the artifact are
 * made up, and `data_origin` stays `fixture`. Suppression here mirrors the
 * proposed scanner rule (a cell needs n >= min_cell_n; a result needs
 * positives >= min_reworked_for_retrospective) so the fixtures exercise both
 * states; the scanner remains the owner of suppression.
 */
import type {
  ArbiterReportV1,
  ReportCell,
  SuppressionReason,
} from '../arbiter-report.js';
import {
  ARBITER_REPORT_V2_SCHEMA_VERSION,
  RETROSPECTIVE_SEGMENTS,
  deriveRetrospectiveCounts,
  type ArbiterReportV2,
  type PrPredictionV2,
  type PrRowV2,
  type RetrospectiveCalibrationV2,
  type RetrospectiveHeadV2,
  type RetrospectiveResultV2,
} from '../arbiter-report-v2.js';

export type V2FixtureKind =
  | 'retrospective'
  | 'time_split'
  | 'suppressed'
  | 'unavailable';
export type IntervalFn = (
  k: number,
  n: number,
) => { low: number; high: number } | null;

const TARGET = 'cr-0.2.0';
const HORIZON = 30 as const;
const THRESHOLD = 0.5;
const day = (start: string, days: number) =>
  new Date(Date.parse(start) + days * 86_400_000)
    .toISOString()
    .replace('.000Z', 'Z');

function head(kind: V2FixtureKind, splitAt: string): RetrospectiveHeadV2 {
  const timeSplit = kind === 'time_split';
  return {
    head_ref: 'head-1',
    head_id: 'fixture-head',
    head_version: '1.0.0',
    artifact_sha256: 'a'.repeat(64),
    artifact_format: 'fixture-format',
    feature_contract: { id: 'fixture-features', version: '1.0.0' },
    target: TARGET,
    horizon_days: HORIZON,
    score_direction: 'higher_is_riskier',
    training: {
      corpus_id: 'fixture-corpus',
      dataset_version: '1.0.0',
      repo_count: 20,
      repo_membership: timeSplit ? 'included' : 'excluded',
      split: timeSplit ? 'time_split' : 'leave_repo_out',
      split_manifest_sha256: 'b'.repeat(64),
      rows_merged_before: day(splitAt, -HORIZON),
      labels_observed_by: splitAt,
    },
    trained_at: day(splitAt, 1),
  };
}

const calibrations = (): RetrospectiveCalibrationV2[] => [
  {
    calibration_ref: 'portable',
    head_ref: 'head-1',
    kind: 'portable',
    version: '1.0.0',
    status: 'available',
    unavailable_reasons: [],
    threshold: { value: THRESHOLD, comparison: 'gte' },
    fit: null,
  },
  // Local calibration's N is undefined until HOK-2824: the repo-calibrated result is typed as unavailable, never invented.
  {
    calibration_ref: 'repo',
    head_ref: 'head-1',
    kind: 'repo_calibrated',
    version: null,
    status: 'unavailable',
    unavailable_reasons: ['local_calibration_undefined'],
    threshold: null,
    fit: null,
  },
];

function cell(
  n: number,
  value: number | null,
  k: number,
  minN: number,
  ci: IntervalFn,
  forced: SuppressionReason[],
): ReportCell {
  const reasons: SuppressionReason[] = forced.length
    ? forced
    : n < minN || value === null
      ? ['n_below_floor']
      : [];
  if (reasons.length)
    return {
      basis: 'out_of_sample_prediction',
      n,
      value: null,
      ci: null,
      suppressed: true,
      suppression_reasons: reasons,
    };
  const interval = ci(k, n)!;
  return {
    basis: 'out_of_sample_prediction',
    n,
    value: value!,
    ci: { ...interval, level: 0.95 },
    suppressed: false,
    suppression_reasons: [],
  };
}

/** Convert a suppressed v1 fixture into a v2 fixture of the given kind. */
export function buildReportV2Fixture(
  v1: ArbiterReportV1,
  kind: V2FixtureKind,
  ci: IntervalFn,
): ArbiterReportV2 {
  const {
    retrospective: _retrospective,
    model_provenance: _provenance,
    ...core
  } = structuredClone(v1);
  void _retrospective;
  void _provenance;
  const start = v1.scan.window.merged_from;
  // The time-split cutoff falls a third of the way into the PRs, so the earlier third is excluded.
  const splitAt =
    kind === 'time_split'
      ? day(start, Math.floor(v1.prs.length / 3) + 0.5)
      : day(start, -10);
  const available = kind !== 'unavailable';
  const prs: PrRowV2[] = v1.prs.map((pr, i) => {
    const { prediction: _p, ...row } = pr;
    void _p;
    const merged_at = day(start, i + 1);
    let prediction: PrPredictionV2 | null = null;
    if (available) {
      const score = ((i * 37) % 100) / 100;
      if (kind === 'time_split' && Date.parse(merged_at) <= Date.parse(splitAt))
        prediction = {
          calibration_ref: 'portable',
          status: 'excluded',
          reason: 'merged_before_split',
          score: null,
          flagged: null,
        };
      else if (i === 1)
        prediction = {
          calibration_ref: 'portable',
          status: 'excluded',
          reason: 'dependency_bot',
          score: null,
          flagged: null,
        };
      else if (i === 2)
        prediction = {
          calibration_ref: 'portable',
          status: 'not_scored',
          reason: 'missing_merge_time_inputs',
          score: null,
          flagged: null,
        };
      else
        prediction = {
          calibration_ref: 'portable',
          status: 'scored',
          reason: null,
          score,
          flagged: score >= THRESHOLD,
        };
    }
    const immature = i >= v1.prs.length - 4;
    return {
      ...row,
      merged_at,
      agent_at_merge: pr.attribution.agent.status,
      targets: available
        ? [
            {
              target: TARGET,
              horizon_days: HORIZON,
              status: immature ? 'immature' : 'mature',
              positive: immature ? null : i % 3 === 0,
            },
          ]
        : [],
      predictions: prediction ? [prediction] : [],
    };
  });
  const policy = { ...v1.policy, min_local_calibration_labels: null };
  const report: ArbiterReportV2 = {
    ...core,
    schema_version: ARBITER_REPORT_V2_SCHEMA_VERSION,
    policy,
    prs,
    eligibility: { ...v1.eligibility, retrospective: available },
    retrospective: available
      ? {
          status: 'available',
          unavailable_reasons: [],
          heads: [head(kind, splitAt)],
          calibrations: calibrations(),
          results: [],
        }
      : {
          status: 'unavailable',
          unavailable_reasons: ['no_artifact'],
          heads: [],
          calibrations: [],
          results: [],
        },
  };
  if (!available) return report;
  report.retrospective.results = RETROSPECTIVE_SEGMENTS.map(
    (segment): RetrospectiveResultV2 => {
      const key = {
        target: TARGET,
        horizon_days: HORIZON,
        calibration_ref: 'portable',
        segment,
      };
      const d = deriveRetrospectiveCounts(prs, key);
      const forced: SuppressionReason[] =
        d.counts.positive < policy.min_reworked_for_retrospective
          ? ['reworked_below_floor']
          : [];
      return {
        ...key,
        basis: 'out_of_sample_prediction',
        status: forced.length ? 'suppressed' : 'shown',
        suppression_reasons: forced,
        counts: d.counts,
        excluded: d.excluded,
        not_scored: d.not_scored,
        not_evaluable: d.not_evaluable,
        precision: cell(
          d.precision.n,
          d.precision.value,
          d.counts.tp,
          policy.min_cell_n,
          ci,
          forced,
        ),
        recall: cell(
          d.recall.n,
          d.recall.value,
          d.counts.tp,
          policy.min_cell_n,
          ci,
          forced,
        ),
        flag_rate: cell(
          d.flag_rate.n,
          d.flag_rate.value,
          d.counts.flagged,
          policy.min_cell_n,
          ci,
          forced,
        ),
      };
    },
  );
  // Eligibility follows what is shown, with the suppression reason when nothing is.
  const shown = report.retrospective.results.some((r) => r.status === 'shown');
  report.eligibility = {
    ...report.eligibility,
    retrospective: shown,
    reasons: shown
      ? report.eligibility.reasons.filter((r) => r !== 'reworked_below_floor')
      : [
          ...new Set([
            ...report.eligibility.reasons,
            'reworked_below_floor' as const,
          ]),
        ],
  };
  return report;
}
