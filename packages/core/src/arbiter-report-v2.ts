/**
 * `arbiter_report/v2` — PROPOSED (HOK-2826 step 1). Not emitted by any
 * scanner until the site (HOK-2828) and the pipeline store (HOK-3217) accept
 * it; `arbiter_report/v1` stays the emitted version until then.
 *
 * v2 keeps v1's descriptive envelope unchanged and replaces its single
 * retrospective, single provenance block and single per-PR prediction with a
 * retrospective that can be verified from the payload itself:
 *
 * - `retrospective.heads`: each scoring artifact's identity, feature contract,
 *   target, horizon and training provenance (membership, split, cutoffs).
 * - `retrospective.calibrations`: the portable prior and the repo-calibrated
 *   variant, each with its threshold and fit provenance, or a typed reason it
 *   is unavailable.
 * - `retrospective.results`: one per (target, horizon, calibration, segment),
 *   with confusion counts, exclusion reasons and precision/recall/flag-rate
 *   cells whose denominators are declared.
 * - Per PR: target outcomes per (target, horizon), one prediction per
 *   calibration with its eligibility, and agent attribution as of merge.
 *
 * Every result's counts and cell values are recomputed from the per-PR rows
 * by {@link deriveRetrospectiveCounts} during validation, so a payload cannot
 * state a number its rows do not support. The scanner owns floors and
 * suppression, as in v1; the validator checks consistency, not policy.
 */
import {
  ARBITER_REPORT_V1_JSON_SCHEMA,
  descriptiveInvariants,
  reportSchemaKit as k,
  structural,
  type ArbiterReportV1,
  type InvariantAdd,
  type ReportCell,
  type ReportPolicy,
  type SuppressionReason,
} from './arbiter-report.js';
import { CORRECTIVE_REWORK_DEFINITIONS } from './arbiter-corrective-rework.js';
import type { HokusaiFieldError } from './schemas.js';

export const ARBITER_REPORT_V2_SCHEMA_VERSION = 'arbiter_report/v2' as const;

/** Targets a retrospective may be evaluated against: the corrective-rework definitions. */
export const RETROSPECTIVE_TARGETS = Object.freeze(
  Object.keys(CORRECTIVE_REWORK_DEFINITIONS),
);
export type RetrospectiveTarget = string;
export const RETROSPECTIVE_SEGMENTS = ['all', 'agent_attributed'] as const;
export type RetrospectiveSegment = (typeof RETROSPECTIVE_SEGMENTS)[number];
export const RETROSPECTIVE_CALIBRATION_KINDS = [
  'portable',
  'repo_calibrated',
] as const;
export type RetrospectiveCalibrationKind =
  (typeof RETROSPECTIVE_CALIBRATION_KINDS)[number];
/** Outside the evaluation cohort: never counted as eligible. */
export const PREDICTION_EXCLUSION_REASONS = [
  'merged_before_split',
  'in_calibration_rows',
  'dependency_bot',
] as const;
/** In the cohort but not scored. */
export const PREDICTION_NOT_SCORED_REASONS = [
  'missing_merge_time_inputs',
  'unsupported_input',
] as const;
/** Scored but not evaluable against the target. */
export const TARGET_NOT_EVALUABLE_REASONS = [
  'horizon_not_mature',
  'label_missing',
] as const;
export const RETROSPECTIVE_UNAVAILABLE_REASONS = [
  'no_artifact',
  'artifact_unverified',
  'provenance_invalid',
  'target_not_supported',
  'local_calibration_undefined',
  'below_min_local_labels',
  'class_requirements_unmet',
] as const;
export type RetrospectiveUnavailableReason =
  (typeof RETROSPECTIVE_UNAVAILABLE_REASONS)[number];

export const ARBITER_REPORT_V2_INVARIANT_CODES = [
  'retrospective_status_mismatch',
  'reference_unknown',
  'reference_duplicate',
  'result_key_duplicate',
  'target_mismatch',
  'split_membership_conflict',
  'training_cutoffs_out_of_order',
  'prediction_before_split',
  'calibration_rows_overlap',
  'calibration_state_inconsistent',
  'local_calibration_below_minimum',
  'prediction_state_inconsistent',
  'prediction_coverage_mismatch',
  'flag_threshold_mismatch',
  'target_label_inconsistent',
  'result_counts_not_reproducible',
  'result_metric_mismatch',
  'zero_denominator_shown',
] as const;
export type ArbiterReportV2InvariantCode =
  (typeof ARBITER_REPORT_V2_INVARIANT_CODES)[number];

export type CountByReason<R extends string> = { reason: R; count: number }[];

export interface RetrospectiveHeadV2 {
  /** Payload-local reference, unique within the report. */
  head_ref: string;
  head_id: string;
  head_version: string;
  artifact_sha256: string;
  artifact_format: string;
  /** The exact input contract the artifact declares; never renamed from another contract. */
  feature_contract: { id: string; version: string };
  target: RetrospectiveTarget;
  horizon_days: 14 | 30 | 60;
  score_direction: 'higher_is_riskier';
  training: {
    corpus_id: string;
    dataset_version: string;
    repo_count: number;
    /** Whether this report's repo is in the training, tuning or calibration data. */
    repo_membership: 'excluded' | 'included';
    split: 'leave_repo_out' | 'time_split';
    split_manifest_sha256: string;
    /** Latest merge time among training rows. */
    rows_merged_before: string;
    /** When the training labels were observed; later than every training merge. */
    labels_observed_by: string;
  };
  trained_at: string;
}

export interface RetrospectiveCalibrationV2 {
  calibration_ref: string;
  head_ref: string;
  kind: RetrospectiveCalibrationKind;
  version: string | null;
  status: 'available' | 'unavailable';
  unavailable_reasons: RetrospectiveUnavailableReason[];
  /** Fixed before the report cohort is evaluated. Comparison: flagged iff score >= value. */
  threshold: { value: number; comparison: 'gte' } | null;
  /** Repo-calibrated only: rows fitted on, all before the evaluation cohort. */
  fit: {
    method: string;
    rows_merged_before: string;
    labels_observed_by: string;
    n_rows: number;
    n_positive: number;
  } | null;
}

export interface RetrospectiveCountsV2 {
  eligible: number;
  scored: number;
  evaluable: number;
  flagged: number;
  positive: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface RetrospectiveResultV2 {
  target: RetrospectiveTarget;
  horizon_days: 14 | 30 | 60;
  calibration_ref: string;
  segment: RetrospectiveSegment;
  basis: 'out_of_sample_prediction';
  status: 'shown' | 'suppressed';
  suppression_reasons: SuppressionReason[];
  counts: RetrospectiveCountsV2;
  excluded: CountByReason<(typeof PREDICTION_EXCLUSION_REASONS)[number]>;
  not_scored: CountByReason<(typeof PREDICTION_NOT_SCORED_REASONS)[number]>;
  not_evaluable: CountByReason<(typeof TARGET_NOT_EVALUABLE_REASONS)[number]>;
  /** n = tp + fp. */
  precision: ReportCell;
  /** n = tp + fn. */
  recall: ReportCell;
  /** n = scored: flagged share of every scored PR, including immature ones. */
  flag_rate: ReportCell;
}

export interface PrTargetV2 {
  target: RetrospectiveTarget;
  horizon_days: 14 | 30 | 60;
  status: 'mature' | 'immature' | 'missing';
  /** Reverted or repaired within the horizon. Null unless mature. */
  positive: boolean | null;
}

export interface PrPredictionV2 {
  calibration_ref: string;
  status: 'scored' | 'not_scored' | 'excluded';
  reason:
    | (typeof PREDICTION_EXCLUSION_REASONS)[number]
    | (typeof PREDICTION_NOT_SCORED_REASONS)[number]
    | null;
  score: number | null;
  flagged: boolean | null;
}

type PrRowV1 = ArbiterReportV1['prs'][number];
export type PrRowV2 = Omit<PrRowV1, 'prediction'> & {
  /** Agent attribution from evidence that existed at merge time. Unknown is never human. */
  agent_at_merge: 'agent' | 'not_agent_signal' | 'unknown';
  targets: PrTargetV2[];
  predictions: PrPredictionV2[];
};

export type ReportPolicyV2 = ReportPolicy & {
  /** Minimum historical local labels before a repo-calibrated result; null until HOK-2824 defines it. */
  min_local_calibration_labels: number | null;
};

export interface ArbiterReportV2 extends Omit<
  ArbiterReportV1,
  'schema_version' | 'policy' | 'prs' | 'retrospective' | 'model_provenance'
> {
  schema_version: typeof ARBITER_REPORT_V2_SCHEMA_VERSION;
  policy: ReportPolicyV2;
  prs: PrRowV2[];
  retrospective: {
    status: 'available' | 'unavailable';
    unavailable_reasons: RetrospectiveUnavailableReason[];
    heads: RetrospectiveHeadV2[];
    calibrations: RetrospectiveCalibrationV2[];
    results: RetrospectiveResultV2[];
  };
}

// ---------------------------------------------------------------- schema

type Schema = Record<string, unknown>;
const sha256 = k.str('^[0-9a-f]{64}$');
const counted = (values: readonly string[]) =>
  k.arr(k.obj({ reason: k.en(values), count: k.int(1) }));
const horizon = k.horizon;
const target = k.en(RETROSPECTIVE_TARGETS);

const v1 = structuredClone(
  ARBITER_REPORT_V1_JSON_SCHEMA,
) as unknown as Schema & {
  properties: Record<string, Schema>;
  required: string[];
};
const v1Pr = (
  v1.properties.prs as {
    items: Schema & { properties: Record<string, Schema> };
  }
).items;
const v1Policy = v1.properties.policy as Schema & {
  properties: Record<string, Schema>;
};

const without = (
  props: Record<string, Schema>,
  drop: readonly string[],
): Record<string, Schema> =>
  Object.fromEntries(
    Object.entries(props).filter(([key]) => !drop.includes(key)),
  );
const prProps = without(v1Pr.properties, ['prediction']);
const prRow = k.obj({
  ...prProps,
  agent_at_merge: k.en(['agent', 'not_agent_signal', 'unknown']),
  targets: k.arr(
    k.obj({
      target,
      horizon_days: horizon,
      status: k.en(['mature', 'immature', 'missing']),
      positive: k.nullable({ type: 'boolean' }),
    }),
    RETROSPECTIVE_TARGETS.length * 3,
  ),
  predictions: k.arr(
    k.obj({
      calibration_ref: k.id,
      status: k.en(['scored', 'not_scored', 'excluded']),
      reason: k.nullable(
        k.en([
          ...PREDICTION_EXCLUSION_REASONS,
          ...PREDICTION_NOT_SCORED_REASONS,
        ]),
      ),
      score: k.nullable(k.num(0, 1)),
      flagged: k.nullable({ type: 'boolean' }),
    }),
    16,
  ),
});
const policy = k.obj({
  ...v1Policy.properties,
  min_local_calibration_labels: k.nullable(k.int(1)),
});
const unavailable = k.arr(k.en(RETROSPECTIVE_UNAVAILABLE_REASONS));

const head = k.obj({
  head_ref: k.id,
  head_id: k.id,
  head_version: k.semver,
  artifact_sha256: sha256,
  artifact_format: k.id,
  feature_contract: k.obj({ id: k.id, version: k.semver }),
  target,
  horizon_days: horizon,
  score_direction: { const: 'higher_is_riskier' },
  training: k.obj({
    corpus_id: k.id,
    dataset_version: k.semver,
    repo_count: k.int(1),
    repo_membership: k.en(['excluded', 'included']),
    split: k.en(['leave_repo_out', 'time_split']),
    split_manifest_sha256: sha256,
    rows_merged_before: k.timestamp,
    labels_observed_by: k.timestamp,
  }),
  trained_at: k.timestamp,
});
const calibration = k.obj({
  calibration_ref: k.id,
  head_ref: k.id,
  kind: k.en(RETROSPECTIVE_CALIBRATION_KINDS),
  version: k.nullable(k.semver),
  status: k.en(['available', 'unavailable']),
  unavailable_reasons: unavailable,
  threshold: k.nullable(
    k.obj({ value: k.num(0, 1), comparison: { const: 'gte' } }),
  ),
  fit: k.nullable(
    k.obj({
      method: k.id,
      rows_merged_before: k.timestamp,
      labels_observed_by: k.timestamp,
      n_rows: k.int(),
      n_positive: k.int(),
    }),
  ),
});
const result = k.obj({
  target,
  horizon_days: horizon,
  calibration_ref: k.id,
  segment: k.en(RETROSPECTIVE_SEGMENTS),
  basis: { const: 'out_of_sample_prediction' },
  status: k.en(['shown', 'suppressed']),
  suppression_reasons: k.reasons,
  counts: k.obj({
    eligible: k.int(),
    scored: k.int(),
    evaluable: k.int(),
    flagged: k.int(),
    positive: k.int(),
    tp: k.int(),
    fp: k.int(),
    fn: k.int(),
    tn: k.int(),
  }),
  excluded: counted(PREDICTION_EXCLUSION_REASONS),
  not_scored: counted(PREDICTION_NOT_SCORED_REASONS),
  not_evaluable: counted(TARGET_NOT_EVALUABLE_REASONS),
  precision: k.cell,
  recall: k.cell,
  flag_rate: k.cell,
});

const keptProps = without(v1.properties, ['retrospective', 'model_provenance']);
export const ARBITER_REPORT_V2_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.hokus.ai/arbiter_report/v2.json',
  title: 'Hokusai arbiter_report/v2 (proposed)',
  ...k.obj({
    ...keptProps,
    schema_version: { const: ARBITER_REPORT_V2_SCHEMA_VERSION },
    policy,
    prs: k.arr(prRow, 20000),
    retrospective: k.obj({
      status: k.en(['available', 'unavailable']),
      unavailable_reasons: unavailable,
      heads: k.arr(head, 4),
      calibrations: k.arr(calibration, 8),
      results: k.arr(result, 64),
    }),
  }),
  $defs: v1.$defs,
});

// ---------------------------------------------------------------- derivation

/** The key of one retrospective result. */
export type RetrospectiveKey = Pick<
  RetrospectiveResultV2,
  'target' | 'horizon_days' | 'calibration_ref' | 'segment'
>;

export interface DerivedRetrospective {
  counts: RetrospectiveCountsV2;
  excluded: RetrospectiveResultV2['excluded'];
  not_scored: RetrospectiveResultV2['not_scored'];
  not_evaluable: RetrospectiveResultV2['not_evaluable'];
  /** Exact values; null when the denominator is zero. */
  precision: { n: number; value: number | null };
  recall: { n: number; value: number | null };
  flag_rate: { n: number; value: number | null };
}

const tally = <R extends string>(
  order: readonly R[],
  seen: R[],
): CountByReason<R> =>
  order.flatMap((reason) => {
    const count = seen.filter((s) => s === reason).length;
    return count ? [{ reason, count }] : [];
  });

/**
 * The single definition of a result's counts, shared by the validator and the
 * scanner (HOK-2826 step 4). The agent segment is PRs attributed to an agent
 * at merge; unknown attribution is in neither the agent segment nor counted
 * as human. Unknown outcomes are never negatives.
 */
export function deriveRetrospectiveCounts(
  prs: readonly PrRowV2[],
  key: RetrospectiveKey,
): DerivedRetrospective {
  const rows = prs.filter(
    (pr) => key.segment === 'all' || pr.agent_at_merge === 'agent',
  );
  const c: RetrospectiveCountsV2 = {
    eligible: 0,
    scored: 0,
    evaluable: 0,
    flagged: 0,
    positive: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
  };
  const excluded: (typeof PREDICTION_EXCLUSION_REASONS)[number][] = [];
  const notScored: (typeof PREDICTION_NOT_SCORED_REASONS)[number][] = [];
  const notEvaluable: (typeof TARGET_NOT_EVALUABLE_REASONS)[number][] = [];
  for (const pr of rows) {
    const p = pr.predictions.find(
      (x) => x.calibration_ref === key.calibration_ref,
    );
    if (!p) continue;
    if (p.status === 'excluded') {
      excluded.push(p.reason as (typeof PREDICTION_EXCLUSION_REASONS)[number]);
      continue;
    }
    c.eligible++;
    if (p.status === 'not_scored') {
      notScored.push(
        p.reason as (typeof PREDICTION_NOT_SCORED_REASONS)[number],
      );
      continue;
    }
    c.scored++;
    if (p.flagged) c.flagged++;
    const t = pr.targets.find(
      (x) => x.target === key.target && x.horizon_days === key.horizon_days,
    );
    if (!t || t.status !== 'mature' || t.positive === null) {
      notEvaluable.push(
        t?.status === 'immature' ? 'horizon_not_mature' : 'label_missing',
      );
      continue;
    }
    c.evaluable++;
    if (t.positive) c.positive++;
    if (p.flagged && t.positive) c.tp++;
    else if (p.flagged) c.fp++;
    else if (t.positive) c.fn++;
    else c.tn++;
  }
  const ratio = (num: number, den: number) => ({
    n: den,
    value: den ? num / den : null,
  });
  return {
    counts: c,
    excluded: tally(PREDICTION_EXCLUSION_REASONS, excluded),
    not_scored: tally(PREDICTION_NOT_SCORED_REASONS, notScored),
    not_evaluable: tally(TARGET_NOT_EVALUABLE_REASONS, notEvaluable),
    precision: ratio(c.tp, c.tp + c.fp),
    recall: ratio(c.tp, c.tp + c.fn),
    flag_rate: ratio(c.flagged, c.scored),
  };
}

// ---------------------------------------------------------------- invariants

const VALUE_TOLERANCE = 1e-9;
/** Timestamps compare as instants: '…00Z' and '…00.000Z' are the same time. */
const at = (iso: string): number => Date.parse(iso);

function invariantV2(report: ArbiterReportV2): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];
  const add: InvariantAdd = (code, path) =>
    errors.push({ code: 'invalid_value', path, message: code });
  const retro = report.retrospective;
  const hasProvenance = retro.status === 'available' && retro.heads.length > 0;
  const { checkCell } = descriptiveInvariants(report, hasProvenance, add);

  // Status: available needs heads, calibrations and results and no reasons; unavailable has reasons and nothing scored.
  if (
    retro.status === 'available'
      ? retro.unavailable_reasons.length > 0 ||
        !retro.heads.length ||
        !retro.calibrations.length ||
        !retro.results.length
      : !retro.unavailable_reasons.length || retro.results.length > 0
  )
    add('retrospective_status_mismatch', 'retrospective');

  const heads = new Map<string, RetrospectiveHeadV2>();
  retro.heads.forEach((h, i) => {
    if (heads.has(h.head_ref))
      add('reference_duplicate', `retrospective.heads[${i}].head_ref`);
    heads.set(h.head_ref, h);
    const t = h.training;
    if (t.split === 'leave_repo_out' && t.repo_membership === 'included')
      add('split_membership_conflict', `retrospective.heads[${i}].training`);
    if (
      at(t.rows_merged_before) > at(t.labels_observed_by) ||
      at(t.labels_observed_by) > at(h.trained_at)
    )
      add(
        'training_cutoffs_out_of_order',
        `retrospective.heads[${i}].training`,
      );
    if (!report.scan.horizons_days.includes(h.horizon_days))
      add('horizon_not_declared', `retrospective.heads[${i}].horizon_days`);
  });
  const calibrations = new Map<string, RetrospectiveCalibrationV2>();
  retro.calibrations.forEach((c, i) => {
    const path = `retrospective.calibrations[${i}]`;
    if (calibrations.has(c.calibration_ref))
      add('reference_duplicate', `${path}.calibration_ref`);
    calibrations.set(c.calibration_ref, c);
    if (!heads.has(c.head_ref)) add('reference_unknown', `${path}.head_ref`);
    const available = c.status === 'available';
    const stateOk = available
      ? !c.unavailable_reasons.length &&
        c.threshold !== null &&
        c.version !== null &&
        (c.kind === 'portable' || c.fit !== null)
      : c.unavailable_reasons.length > 0 && c.threshold === null;
    if (!stateOk) add('calibration_state_inconsistent', path);
    if (c.kind === 'repo_calibrated' && available && c.fit) {
      const min = report.policy.min_local_calibration_labels;
      if (min === null || c.fit.n_rows < min)
        add('local_calibration_below_minimum', `${path}.fit`);
      if (at(c.fit.rows_merged_before) > at(c.fit.labels_observed_by))
        add('training_cutoffs_out_of_order', `${path}.fit`);
    }
  });

  // Per-PR rows.
  const usedTargets = new Set(
    retro.results.map((r) => `${r.target}@${r.horizon_days}`),
  );
  report.prs.forEach((pr, i) => {
    const path = `prs[${i}]`;
    if (!hasProvenance && pr.predictions.length)
      add('prediction_without_provenance', `${path}.predictions`);
    const targetKeys = pr.targets.map((t) => `${t.target}@${t.horizon_days}`);
    if (
      new Set(targetKeys).size !== targetKeys.length ||
      [...usedTargets].some((key) => !targetKeys.includes(key))
    )
      add('target_label_inconsistent', `${path}.targets`);
    pr.targets.forEach((t, j) => {
      if ((t.status === 'mature') !== (t.positive !== null))
        add('target_label_inconsistent', `${path}.targets[${j}]`);
      if (!report.scan.horizons_days.includes(t.horizon_days))
        add('horizon_not_declared', `${path}.targets[${j}].horizon_days`);
    });
    const refs = pr.predictions.map((p) => p.calibration_ref);
    const expectedRefs = retro.calibrations
      .filter((c) => c.status === 'available')
      .map((c) => c.calibration_ref);
    if (
      new Set(refs).size !== refs.length ||
      refs.length !== expectedRefs.length ||
      expectedRefs.some((ref) => !refs.includes(ref))
    )
      add('prediction_coverage_mismatch', `${path}.predictions`);
    pr.predictions.forEach((p, j) => {
      const pp = `${path}.predictions[${j}]`;
      const cal = calibrations.get(p.calibration_ref);
      if (!cal) {
        add('reference_unknown', `${pp}.calibration_ref`);
        return;
      }
      const reasonOk =
        p.status === 'scored'
          ? p.reason === null
          : p.status === 'excluded'
            ? (PREDICTION_EXCLUSION_REASONS as readonly string[]).includes(
                p.reason ?? '',
              )
            : (PREDICTION_NOT_SCORED_REASONS as readonly string[]).includes(
                p.reason ?? '',
              );
      const valuesOk =
        p.status === 'scored'
          ? p.score !== null && p.flagged !== null
          : p.score === null && p.flagged === null;
      if (!reasonOk || !valuesOk || cal.status !== 'available')
        add('prediction_state_inconsistent', pp);
      if (
        p.status === 'scored' &&
        p.score !== null &&
        cal.threshold &&
        p.flagged !== p.score >= cal.threshold.value
      )
        add('flag_threshold_mismatch', pp);
      if (p.status !== 'excluded') {
        const h = heads.get(cal.head_ref);
        // Time split: nothing the model saw (rows or their labels) may post-date an evaluated merge.
        if (
          h &&
          h.training.split === 'time_split' &&
          at(pr.merged_at) <= at(h.training.labels_observed_by)
        )
          add('prediction_before_split', pp);
        if (
          cal.kind === 'repo_calibrated' &&
          cal.fit &&
          at(pr.merged_at) <= at(cal.fit.labels_observed_by)
        )
          add('calibration_rows_overlap', pp);
      }
    });
  });

  // Results.
  const keys = new Set<string>();
  retro.results.forEach((r, i) => {
    const path = `retrospective.results[${i}]`;
    const key = `${r.target}@${r.horizon_days}/${r.calibration_ref}/${r.segment}`;
    if (keys.has(key)) add('result_key_duplicate', path);
    keys.add(key);
    if (!report.scan.horizons_days.includes(r.horizon_days))
      add('horizon_not_declared', `${path}.horizon_days`);
    const cal = calibrations.get(r.calibration_ref);
    if (!cal) {
      add('reference_unknown', `${path}.calibration_ref`);
      return;
    }
    const h = heads.get(cal.head_ref);
    if (h && (h.target !== r.target || h.horizon_days !== r.horizon_days))
      add('target_mismatch', path);
    if (cal.status !== 'available') add('calibration_state_inconsistent', path);
    if (r.status === 'suppressed' && !r.suppression_reasons.length)
      add('section_status_mismatch', path);
    if (r.status === 'shown' && r.suppression_reasons.length)
      add('section_status_mismatch', path);
    if (r.status === 'shown' && !report.eligibility.retrospective)
      add('model_table_ineligible_but_shown', path);

    const d = deriveRetrospectiveCounts(report.prs, r);
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    if (
      !same(d.counts, r.counts) ||
      !same(d.excluded, r.excluded) ||
      !same(d.not_scored, r.not_scored) ||
      !same(d.not_evaluable, r.not_evaluable)
    )
      add('result_counts_not_reproducible', `${path}.counts`);
    for (const m of ['precision', 'recall', 'flag_rate'] as const) {
      const cell = r[m];
      checkCell(cell, `${path}.${m}`, 'out_of_sample_prediction');
      if (r.status === 'suppressed' && !cell.suppressed)
        add('section_status_mismatch', `${path}.${m}`);
      if (cell.n !== d[m].n) add('result_metric_mismatch', `${path}.${m}`);
      if (!cell.suppressed) {
        if (d[m].value === null) add('zero_denominator_shown', `${path}.${m}`);
        else if (
          cell.value === null ||
          Math.abs(cell.value - d[m].value) > VALUE_TOLERANCE
        )
          add('result_metric_mismatch', `${path}.${m}`);
      }
    }
  });
  return errors;
}

/** Validate a proposed `arbiter_report/v2` payload: closed schema, then invariants. */
export function validateArbiterReportV2(
  input: unknown,
):
  | { ok: true; value: ArbiterReportV2 }
  | { ok: false; errors: readonly HokusaiFieldError[] } {
  try {
    const errors: HokusaiFieldError[] = [];
    structural(
      ARBITER_REPORT_V2_JSON_SCHEMA,
      input,
      '',
      errors,
      ARBITER_REPORT_V2_JSON_SCHEMA,
    );
    if (errors.length) return { ok: false, errors };
    const report = input as ArbiterReportV2;
    errors.push(...invariantV2(report));
    return errors.length ? { ok: false, errors } : { ok: true, value: report };
  } catch {
    return {
      ok: false,
      errors: [
        { path: '$', code: 'invalid_value', message: 'Malformed report.' },
      ],
    };
  }
}
