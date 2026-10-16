/** Frozen, derived-only report envelope shared by scanner and renderers. */
import {
  CANDIDATE_FEATURES_V1_JSON_SCHEMA,
  type CandidateFeaturesV1,
  type CandidateFeatureName,
} from './candidate-features.js';
import {
  canonicalHash,
  deriveReportOutcome,
  HORIZONS,
  MISSING_REASON_CODES,
  REASON_CODES,
  type ArbiterSurvivalLabelV1,
  type ReportOutcome,
  type ReasonCode,
} from './arbiter-survival-label.js';
import {
  TASK_COST_COVERAGES,
  TASK_COST_SOURCES,
  type TaskCostCoverage,
  type TaskCostSource,
} from './task-cost/enums.js';
import type { HokusaiFieldError } from './schemas.js';

export const ARBITER_REPORT_SCHEMA_VERSION = 'arbiter_report/v1' as const;
export const REPORT_SUPPRESSION_REASONS = [
  'n_below_floor',
  'agent_coverage_below_floor',
  'harness_coverage_below_floor',
  'exact_model_coverage_below_floor',
  'harness_only_evidence',
  'cost_coverage_below_floor',
  'reworked_below_floor',
  'no_model_provenance',
  'horizon_not_mature',
] as const;
export type SuppressionReason = (typeof REPORT_SUPPRESSION_REASONS)[number];
export const REPORT_ATTRIBUTION_METHODS = [
  'first_party_route_metadata',
  'bot_author',
  'branch_prefix',
  'co_authored_by_trailer',
  'pr_label',
  'commit_signature',
  'owner_config',
] as const;
export type AttributionMethod = (typeof REPORT_ATTRIBUTION_METHODS)[number];
export const REPORT_FEATURE_BUCKETS = Object.freeze({
  tests_changed: ['true', 'false'],
  files_touched_bucket: ['1', '2_5', '6_15', '16_plus'],
  loc_touched: ['q1', 'q2', 'q3', 'q4'],
} as const);
export const REPORT_FORBIDDEN_KEYS = [
  'title',
  'body',
  'diff',
  'patch',
  'source_code',
  'file_contents',
  'path',
  'paths',
  'files',
  'commit_message',
  'author',
  'author_email',
  'author_name',
  'prompt',
  'raw*',
  'line_ranges',
  'prUrl',
  'sha',
  'merge_sha',
  'pr_head_sha',
] as const;
export const ARBITER_REPORT_INVARIANT_CODES = [
  'suppressed_cell_has_value',
  'shown_cell_missing_value',
  'ci_out_of_order',
  'section_status_mismatch',
  'prediction_without_provenance',
  'descriptive_section_with_prediction_cell',
  'cta_without_exact_model',
  'model_table_ineligible_but_shown',
  'cost_adjusted_needs_actual_cost',
  'coverage_sum_mismatch',
  'horizon_not_declared',
  'horizons_not_ascending',
  'feature_bucket_mismatch',
  'labels_horizon_mismatch',
  'label_outcome_inconsistent',
  'cost_sum_forbidden',
] as const;
export type ReportBasis = 'descriptive' | 'out_of_sample_prediction';
export type ReportCell = {
  basis: ReportBasis;
  n: number;
  value: number | null;
  ci: { low: number; high: number; level: 0.95 } | null;
  suppressed: boolean;
  suppression_reasons: SuppressionReason[];
};
export type ReportSection<T> = {
  basis: ReportBasis;
  status: 'shown' | 'suppressed';
  suppression_reasons: SuppressionReason[];
  rows: T[];
};
export type SurvivalLabelProjectionV1 = {
  horizon_days: 14 | 30 | 60;
  label_provenance: 'harvested' | 'owner_corrected';
  outcome: {
    survived: boolean | null;
    survival_ratio: number | null;
    reverted: boolean | null;
    undone_by: 'human' | 'agent' | null;
    followup: boolean | null;
    report_outcome: ReportOutcome;
    reason_codes: ReasonCode[];
  };
  label_hash: string;
};
export interface ArbiterReportV1 {
  schema_version: typeof ARBITER_REPORT_SCHEMA_VERSION;
  data_origin: 'scan' | 'fixture';
  repo: { host: 'github'; owner: string; name: string };
  scan: {
    scanned_at: string;
    as_of: string;
    scanner: { package: '@hokusai/scan'; version: string };
    integration_branch: string;
    lookback_days: number;
    window: { merged_from: string; merged_to: string };
    horizons_days: (14 | 30 | 60)[];
    contracts: {
      candidate_features: 'candidate_features/v1';
      survival_label: '1.0.0';
      labeller_version: string;
      normalization_version: string;
    };
  };
  policy: ReportPolicy;
  coverage: {
    basis: 'descriptive';
    prs_enumerated: number;
    prs_eligible: number;
    labels_by_horizon: {
      horizon_days: 14 | 30 | 60;
      labelled: number;
      missing: { reason: string; count: number }[];
    }[];
    attribution: {
      agent: {
        identified_agent: number;
        identified_human_signal: number;
        unknown: number;
        rate: number;
      };
      harness: { identified: number; unknown: number; rate: number };
      exact_model: { identified: number; unknown: number; rate: number };
      methods: {
        dimension: 'agent' | 'harness' | 'exact_model';
        method: AttributionMethod;
        count: number;
      }[];
    };
  };
  prs: {
    pr_number: number;
    merged_at: string;
    attribution: {
      agent: {
        status: 'agent' | 'not_agent_signal' | 'unknown';
        confidence: number | null;
        methods: AttributionMethod[];
      };
      harness: {
        id: string | null;
        confidence: number | null;
        methods: AttributionMethod[];
      };
      exact_model: {
        id: string | null;
        confidence: number | null;
        methods: AttributionMethod[];
        evidence: 'first_party_executed' | 'heuristic' | null;
      };
    };
    features: CandidateFeaturesV1;
    labels: SurvivalLabelProjectionV1[];
    cost: {
      actual_usd: number | null;
      estimated_usd: number | null;
      cost_source: TaskCostSource;
      coverage: TaskCostCoverage;
      pricing_revision: string | null;
    } | null;
    prediction: {
      basis: 'out_of_sample_prediction';
      score: number;
      flagged: boolean;
    } | null;
  }[];
  aggregates: {
    survival_by_horizon: ReportSection<{
      horizon_days: 14 | 30 | 60;
      outcome: Exclude<ReportOutcome, null>;
      cell: ReportCell;
    }>;
    risk_ratios: ReportSection<{
      horizon_days: 14 | 30 | 60;
      feature: CandidateFeatureName;
      bucket: string;
      rework_rate: ReportCell;
      baseline_rate: ReportCell;
      ratio: ReportCell;
    }>;
    survival_by_model: ReportSection<{
      horizon_days: 14 | 30 | 60;
      model_id: string;
      cell: ReportCell;
    }>;
    survival_by_harness: ReportSection<{
      horizon_days: 14 | 30 | 60;
      harness_id: string;
      cell: ReportCell;
    }>;
    cost_adjusted_survival_by_model: ReportSection<{
      horizon_days: 14 | 30 | 60;
      model_id: string;
      cost_basis: 'actual';
      cell: ReportCell;
    }>;
  };
  retrospective: {
    basis: 'out_of_sample_prediction';
    horizon_days: 14 | 30 | 60;
    threshold: number;
    calibration: 'portable' | 'repo_calibrated';
    n_reworked: number;
    precision: ReportCell;
    recall: ReportCell;
    flagged_share: ReportCell;
    suppressed: boolean;
    suppression_reasons: SuppressionReason[];
  } | null;
  cost: {
    actual: {
      basis: 'descriptive';
      total_usd: number | null;
      cost_source: 'provider_reported';
      coverage: TaskCostCoverage;
      prs_priced: number;
      prs_unknown: number;
      suppressed: boolean;
      suppression_reasons: SuppressionReason[];
    };
    estimated: {
      basis: 'descriptive';
      kind: 'estimate';
      total_usd: number | null;
      cost_source: 'local_estimate';
      pricing_revision: string | null;
      pricing_timestamp: string | null;
      coverage: TaskCostCoverage;
      prs_priced: number;
      prs_unknown: number;
      unpriced_models: number;
      suppressed: boolean;
      suppression_reasons: SuppressionReason[];
    };
  } | null;
  model_provenance: {
    head_id: string;
    head_version: string;
    trained_on: string;
    training_repo_count: number;
    split: 'time_split' | 'leave_repo_out';
    split_date: string;
    repo_in_training_set: boolean;
    trained_at: string;
  } | null;
  eligibility: {
    exact_model_table: boolean;
    harness_table: boolean;
    cost_adjusted_by_model: boolean;
    retrospective: boolean;
    model_routing_cta: boolean;
    reasons: SuppressionReason[];
  };
}
export type ReportPolicy = {
  policy_version: string;
  min_cell_n: number;
  min_agent_coverage: number;
  min_harness_coverage: number;
  min_exact_model_coverage: number;
  min_cost_coverage: number;
  min_reworked_for_retrospective: number;
  ci_method: 'wilson' | 'katz_log';
  ci_level: 0.95;
};
export function projectSurvivalLabel(
  label: ArbiterSurvivalLabelV1,
): SurvivalLabelProjectionV1 {
  return {
    horizon_days: label.horizon_days,
    label_provenance: label.label_provenance,
    outcome: { ...label.outcome },
    label_hash: canonicalHash(label),
  };
}

type Schema = Record<string, unknown>;
const str = (pattern: string): Schema => ({ type: 'string', pattern });
const en = (values: readonly unknown[]): Schema => ({ enum: [...values] });
const num = (minimum = 0, maximum?: number): Schema => ({
  type: 'number',
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
const int = (minimum = 0, maximum?: number): Schema => ({
  type: 'integer',
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: 'null' }],
});
const arr = (items: Schema, maxItems?: number): Schema => ({
  type: 'array',
  items,
  ...(maxItems === undefined ? {} : { maxItems }),
});
const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const id = str('^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$');
const modelId = str('^[a-z0-9][a-z0-9._:/@-]{0,119}$');
const timestamp = str(
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
);
const date = str('^\\d{4}-\\d{2}-\\d{2}$');
const semver = str('^\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?$');
const reasons = arr(en(REPORT_SUPPRESSION_REASONS));
const basis = en(['descriptive', 'out_of_sample_prediction']);
const cell = obj({
  basis,
  n: int(),
  value: nullable(num(-1e15, 1e15)),
  ci: nullable(
    obj({
      low: num(-1e15, 1e15),
      high: num(-1e15, 1e15),
      level: { const: 0.95 },
    }),
  ),
  suppressed: { type: 'boolean' },
  suppression_reasons: reasons,
});
const section = (row: Schema) =>
  obj({
    basis,
    status: en(['shown', 'suppressed']),
    suppression_reasons: reasons,
    rows: arr(row),
  });
const horizon = en(HORIZONS);
const label = obj({
  horizon_days: horizon,
  label_provenance: en(['harvested', 'owner_corrected']),
  outcome: obj({
    survived: nullable({ type: 'boolean' }),
    survival_ratio: nullable(num(0, 1)),
    reverted: nullable({ type: 'boolean' }),
    undone_by: nullable(en(['human', 'agent'])),
    followup: nullable({ type: 'boolean' }),
    report_outcome: nullable(
      en(['survived', 'followup', 'substantially_rewritten', 'reverted']),
    ),
    reason_codes: arr(en(REASON_CODES)),
  }),
  label_hash: str('^[0-9a-f]{64}$'),
});
const methods = arr(en(REPORT_ATTRIBUTION_METHODS));
const dimension = en(['agent', 'harness', 'exact_model']);
const costCoverage = en(TASK_COST_COVERAGES);
const costSource = en(TASK_COST_SOURCES);
const featureSchema = { ...CANDIDATE_FEATURES_V1_JSON_SCHEMA };
delete (featureSchema as Record<string, unknown>).$schema;
delete (featureSchema as Record<string, unknown>).$id;
export const ARBITER_REPORT_V1_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.hokus.ai/arbiter_report/v1.json',
  title: 'Hokusai arbiter_report/v1',
  ...obj({
    schema_version: { const: ARBITER_REPORT_SCHEMA_VERSION },
    data_origin: en(['scan', 'fixture']),
    repo: obj({
      host: { const: 'github' },
      owner: str('^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
      name: { ...str('^[A-Za-z0-9._-]{1,100}$'), not: { enum: ['.', '..'] } },
    }),
    scan: obj({
      scanned_at: timestamp,
      as_of: timestamp,
      scanner: obj({ package: { const: '@hokusai/scan' }, version: semver }),
      integration_branch: str('^[A-Za-z0-9._/-]{1,200}$'),
      lookback_days: int(1, 3650),
      window: obj({ merged_from: timestamp, merged_to: timestamp }),
      horizons_days: { ...arr(horizon, 3), minItems: 1, uniqueItems: true },
      contracts: obj({
        candidate_features: { const: 'candidate_features/v1' },
        survival_label: { const: '1.0.0' },
        labeller_version: semver,
        normalization_version: semver,
      }),
    }),
    policy: obj({
      policy_version: semver,
      min_cell_n: int(1),
      min_agent_coverage: num(0, 1),
      min_harness_coverage: num(0, 1),
      min_exact_model_coverage: num(0, 1),
      min_cost_coverage: num(0, 1),
      min_reworked_for_retrospective: int(),
      ci_method: en(['wilson', 'katz_log']),
      ci_level: { const: 0.95 },
    }),
    coverage: obj({
      basis: { const: 'descriptive' },
      prs_enumerated: int(),
      prs_eligible: int(),
      labels_by_horizon: arr(
        obj({
          horizon_days: horizon,
          labelled: int(),
          missing: arr(obj({ reason: en(MISSING_REASON_CODES), count: int() })),
        }),
      ),
      attribution: obj({
        agent: obj({
          identified_agent: int(),
          identified_human_signal: int(),
          unknown: int(),
          rate: num(0, 1),
        }),
        harness: obj({ identified: int(), unknown: int(), rate: num(0, 1) }),
        exact_model: obj({
          identified: int(),
          unknown: int(),
          rate: num(0, 1),
        }),
        methods: arr(
          obj({
            dimension,
            method: en(REPORT_ATTRIBUTION_METHODS),
            count: int(),
          }),
        ),
      }),
    }),
    prs: arr(
      obj({
        pr_number: int(1),
        merged_at: timestamp,
        attribution: obj({
          agent: obj({
            status: en(['agent', 'not_agent_signal', 'unknown']),
            confidence: nullable(num(0, 1)),
            methods,
          }),
          harness: obj({
            id: nullable(id),
            confidence: nullable(num(0, 1)),
            methods,
          }),
          exact_model: obj({
            id: nullable(modelId),
            confidence: nullable(num(0, 1)),
            methods,
            evidence: nullable(en(['first_party_executed', 'heuristic'])),
          }),
        }),
        features: ref('candidateFeatures'),
        labels: arr(label, 3),
        cost: nullable(
          obj({
            actual_usd: nullable(num()),
            estimated_usd: nullable(num()),
            cost_source: costSource,
            coverage: costCoverage,
            pricing_revision: nullable(id),
          }),
        ),
        prediction: nullable(
          obj({
            basis: { const: 'out_of_sample_prediction' },
            score: num(0, 1),
            flagged: { type: 'boolean' },
          }),
        ),
      }),
      20000,
    ),
    aggregates: obj({
      survival_by_horizon: section(
        obj({
          horizon_days: horizon,
          outcome: en([
            'survived',
            'followup',
            'substantially_rewritten',
            'reverted',
          ]),
          cell,
        }),
      ),
      risk_ratios: section(
        obj({
          horizon_days: horizon,
          feature: en(Object.keys(REPORT_FEATURE_BUCKETS)),
          bucket: en([
            ...REPORT_FEATURE_BUCKETS.tests_changed,
            ...REPORT_FEATURE_BUCKETS.files_touched_bucket,
            ...REPORT_FEATURE_BUCKETS.loc_touched,
          ]),
          rework_rate: cell,
          baseline_rate: cell,
          ratio: cell,
        }),
      ),
      survival_by_model: section(
        obj({ horizon_days: horizon, model_id: modelId, cell }),
      ),
      survival_by_harness: section(
        obj({ horizon_days: horizon, harness_id: id, cell }),
      ),
      cost_adjusted_survival_by_model: section(
        obj({
          horizon_days: horizon,
          model_id: modelId,
          cost_basis: { const: 'actual' },
          cell,
        }),
      ),
    }),
    retrospective: nullable(
      obj({
        basis: { const: 'out_of_sample_prediction' },
        horizon_days: horizon,
        threshold: num(0, 1),
        calibration: en(['portable', 'repo_calibrated']),
        n_reworked: int(),
        precision: cell,
        recall: cell,
        flagged_share: cell,
        suppressed: { type: 'boolean' },
        suppression_reasons: reasons,
      }),
    ),
    cost: nullable(
      obj({
        actual: obj({
          basis: { const: 'descriptive' },
          total_usd: nullable(num()),
          cost_source: { const: 'provider_reported' },
          coverage: costCoverage,
          prs_priced: int(),
          prs_unknown: int(),
          suppressed: { type: 'boolean' },
          suppression_reasons: reasons,
        }),
        estimated: obj({
          basis: { const: 'descriptive' },
          kind: { const: 'estimate' },
          total_usd: nullable(num()),
          cost_source: { const: 'local_estimate' },
          pricing_revision: nullable(id),
          pricing_timestamp: nullable(timestamp),
          coverage: costCoverage,
          prs_priced: int(),
          prs_unknown: int(),
          unpriced_models: int(),
          suppressed: { type: 'boolean' },
          suppression_reasons: reasons,
        }),
      }),
    ),
    model_provenance: nullable(
      obj({
        head_id: id,
        head_version: semver,
        trained_on: id,
        training_repo_count: int(),
        split: en(['time_split', 'leave_repo_out']),
        split_date: date,
        repo_in_training_set: { type: 'boolean' },
        trained_at: timestamp,
      }),
    ),
    eligibility: obj({
      exact_model_table: { type: 'boolean' },
      harness_table: { type: 'boolean' },
      cost_adjusted_by_model: { type: 'boolean' },
      retrospective: { type: 'boolean' },
      model_routing_cta: { type: 'boolean' },
      reasons,
    }),
  }),
  $defs: { candidateFeatures: featureSchema },
});

// The runtime walker deliberately supports only the JSON Schema keywords used
// above. The exported schema remains the wire authority for other languages.
function structural(
  schema: Schema,
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
  root: Schema,
): void {
  const fail = (
    code: 'invalid_type' | 'invalid_value' | 'required',
    message: string,
  ) => errors.push({ path: path || '$', code, message });
  if ('$ref' in schema) {
    const name = String(schema.$ref).split('/').at(-1)!;
    structural(
      (root.$defs as Record<string, Schema>)[name]!,
      value,
      path,
      errors,
      root,
    );
    return;
  }
  if ('anyOf' in schema) {
    if (
      !(schema.anyOf as Schema[]).some((s) => {
        const e: HokusaiFieldError[] = [];
        structural(s, value, path, e, root);
        return e.length === 0;
      })
    )
      fail('invalid_type', 'No allowed shape matched.');
    return;
  }
  if ('const' in schema && value !== schema.const)
    fail('invalid_value', 'Unexpected constant.');
  if ('enum' in schema && !(schema.enum as unknown[]).includes(value))
    fail('invalid_value', 'Unexpected enum value.');
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail('invalid_type', 'Expected object.');
      return;
    }
    const object = value as Record<string, unknown>,
      props = schema.properties as Record<string, Schema>;
    for (const key of Object.keys(object))
      if (!(key in props))
        errors.push({
          path: path ? `${path}.${key}` : key,
          code: 'invalid_value',
          message: 'Unknown key.',
        });
    for (const key of schema.required as string[])
      if (!(key in object))
        errors.push({
          path: path ? `${path}.${key}` : key,
          code: 'required',
          message: 'Field is required.',
        });
    for (const [key, s] of Object.entries(props))
      if (key in object)
        structural(s, object[key], path ? `${path}.${key}` : key, errors, root);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      fail('invalid_type', 'Expected array.');
      return;
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      fail('invalid_value', 'Too many items.');
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      fail('invalid_value', 'Too few items.');
    if (schema.uniqueItems === true && new Set(value).size !== value.length)
      fail('invalid_value', 'Duplicate items.');
    value.forEach((v, i) =>
      structural(schema.items as Schema, v, `${path}[${i}]`, errors, root),
    );
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      fail('invalid_type', 'Expected string.');
      return;
    }
    if (schema.pattern && !new RegExp(schema.pattern as string).test(value))
      fail('invalid_value', 'String does not match pattern.');
    if (
      schema.not &&
      ((schema.not as Schema).enum as unknown[]).includes(value)
    )
      fail('invalid_value', 'Reserved value.');
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (schema.type === 'integer' && !Number.isInteger(value))
    ) {
      fail('invalid_type', 'Expected finite number.');
      return;
    }
    if (
      (typeof schema.minimum === 'number' && value < schema.minimum) ||
      (typeof schema.maximum === 'number' && value > schema.maximum)
    )
      fail('invalid_value', 'Number out of bounds.');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean')
    fail('invalid_type', 'Expected boolean.');
  else if (schema.type === 'null' && value !== null)
    fail('invalid_type', 'Expected null.');
}
function invariant(report: ArbiterReportV1): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];
  const add = (
    code: (typeof ARBITER_REPORT_INVARIANT_CODES)[number],
    path: string,
  ) => errors.push({ code: 'invalid_value', path, message: code });
  if (
    report.scan.horizons_days.some(
      (horizon, index) =>
        index > 0 && horizon <= report.scan.horizons_days[index - 1]!,
    )
  )
    add('horizons_not_ascending', 'scan.horizons_days');
  const checkCell = (c: ReportCell, path: string, basis?: ReportBasis) => {
    if (
      c.suppressed &&
      (c.value !== null || c.ci !== null || !c.suppression_reasons.length)
    )
      add('suppressed_cell_has_value', path);
    if (!c.suppressed && (c.value === null || c.suppression_reasons.length))
      add('shown_cell_missing_value', path);
    if (
      c.ci &&
      c.value !== null &&
      !(c.ci.low <= c.value && c.value <= c.ci.high)
    )
      add('ci_out_of_order', path);
    if (basis && c.basis !== basis)
      add('descriptive_section_with_prediction_cell', path);
    if (c.basis === 'out_of_sample_prediction' && !report.model_provenance)
      add('prediction_without_provenance', path);
  };
  const sections = report.aggregates as Record<
    string,
    ReportSection<Record<string, unknown>>
  >;
  for (const [name, s] of Object.entries(sections)) {
    if (s.basis === 'out_of_sample_prediction' && !report.model_provenance)
      add('prediction_without_provenance', `aggregates.${name}`);
    if (s.status === 'suppressed' && !s.suppression_reasons.length)
      add('section_status_mismatch', `aggregates.${name}`);
    s.rows.forEach((row, i) => {
      for (const [k, v] of Object.entries(row))
        if (k === 'cell' || k.endsWith('_rate') || k === 'ratio') {
          const c = v as ReportCell;
          checkCell(c, `aggregates.${name}.rows[${i}].${k}`, s.basis);
          if (s.status === 'suppressed' && !c.suppressed)
            add(
              'section_status_mismatch',
              `aggregates.${name}.rows[${i}].${k}`,
            );
        }
      if (
        typeof row.horizon_days === 'number' &&
        !report.scan.horizons_days.includes(row.horizon_days as 14 | 30 | 60)
      )
        add(
          'horizon_not_declared',
          `aggregates.${name}.rows[${i}].horizon_days`,
        );
    });
  }
  report.aggregates.risk_ratios.rows.forEach((row, index) => {
    const allowed =
      REPORT_FEATURE_BUCKETS[
        row.feature as keyof typeof REPORT_FEATURE_BUCKETS
      ];
    if (!allowed || !(allowed as readonly string[]).includes(row.bucket))
      add(
        'feature_bucket_mismatch',
        `aggregates.risk_ratios.rows[${index}].bucket`,
      );
  });
  if (
    report.eligibility.model_routing_cta &&
    !report.eligibility.exact_model_table
  )
    add('cta_without_exact_model', 'eligibility.model_routing_cta');
  for (const [flag, name] of [
    ['exact_model_table', 'survival_by_model'],
    ['harness_table', 'survival_by_harness'],
    ['cost_adjusted_by_model', 'cost_adjusted_survival_by_model'],
  ] as const)
    if (!report.eligibility[flag] && report.aggregates[name].status === 'shown')
      add('model_table_ineligible_but_shown', `aggregates.${name}`);
  if (
    report.eligibility.cost_adjusted_by_model &&
    (!report.cost || report.cost.actual.suppressed)
  )
    add(
      'cost_adjusted_needs_actual_cost',
      'eligibility.cost_adjusted_by_model',
    );
  if (
    report.prs.length !== report.coverage.prs_enumerated ||
    report.coverage.attribution.agent.identified_agent +
      report.coverage.attribution.agent.identified_human_signal +
      report.coverage.attribution.agent.unknown !==
      report.coverage.prs_enumerated ||
    report.coverage.attribution.harness.identified +
      report.coverage.attribution.harness.unknown !==
      report.coverage.prs_enumerated ||
    report.coverage.attribution.exact_model.identified +
      report.coverage.attribution.exact_model.unknown !==
      report.coverage.prs_enumerated
  )
    add('coverage_sum_mismatch', 'coverage');
  report.prs.forEach((pr, i) => {
    if (pr.prediction && !report.model_provenance)
      add('prediction_without_provenance', `prs[${i}].prediction`);
    if (
      pr.labels.length !== report.scan.horizons_days.length ||
      new Set(pr.labels.map((l) => l.horizon_days)).size !==
        report.scan.horizons_days.length ||
      pr.labels.some((l) => !report.scan.horizons_days.includes(l.horizon_days))
    )
      add('labels_horizon_mismatch', `prs[${i}].labels`);
    pr.labels.forEach((l, j) => {
      if (!report.scan.horizons_days.includes(l.horizon_days))
        add('horizon_not_declared', `prs[${i}].labels[${j}].horizon_days`);
      if (l.outcome.report_outcome !== deriveReportOutcome(l.outcome))
        add(
          'label_outcome_inconsistent',
          `prs[${i}].labels[${j}].outcome.report_outcome`,
        );
    });
  });
  if (report.retrospective) {
    if (!report.model_provenance)
      add('prediction_without_provenance', 'retrospective');
    for (const k of ['precision', 'recall', 'flagged_share'] as const)
      checkCell(
        report.retrospective[k],
        `retrospective.${k}`,
        report.retrospective.basis,
      );
    if (!report.eligibility.retrospective && !report.retrospective.suppressed)
      add('model_table_ineligible_but_shown', 'retrospective');
  }
  return errors;
}
export function validateArbiterReportV1(
  input: unknown,
):
  | { ok: true; value: ArbiterReportV1 }
  | { ok: false; errors: readonly HokusaiFieldError[] } {
  try {
    const errors: HokusaiFieldError[] = [];
    structural(
      ARBITER_REPORT_V1_JSON_SCHEMA,
      input,
      '',
      errors,
      ARBITER_REPORT_V1_JSON_SCHEMA,
    );
    if (errors.length) return { ok: false, errors };
    const report = input as ArbiterReportV1;
    return (
      errors.push(...invariant(report)),
      errors.length ? { ok: false, errors } : { ok: true, value: report }
    );
  } catch {
    return {
      ok: false,
      errors: [
        { path: '$', code: 'invalid_value', message: 'Malformed report.' },
      ],
    };
  }
}
