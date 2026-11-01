/**
 * Validation for redacted Hokusai contribution rows.
 *
 * Queue payloads must only contain already-redacted contribution shapes.
 *
 * @module hokusai-contribution-schema
 */

import type {
  HokusaiAvailableModels,
  HokusaiTaskDescriptor,
} from './descriptor-types.js';

export const TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION = 'technical_task_router_row/v1';
export const TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2 = 'technical_task_router_row/v2';
export const TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3 = 'technical_task_router_row/v3';
export const HARNESS_OUTCOME_ROW_SCHEMA_VERSION = 'harness_outcome_row/v1';
export const HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2 = 'harness_outcome_row/v2';

/** Roles a routing recommendation covers. */
export const ROUTE_ROLES = ['planner', 'coder', 'reviewer'] as const;
export type RouteRole = (typeof ROUTE_ROLES)[number];

/**
 * Who changed Hokusai's recommended model (the actor, per the task-cost
 * contract's "actor on every event" rule). `escalation`: the harness escalated
 * after a failure. `launchability`: the recommended model could not launch.
 * `challenge`: a challenge program deliberately ran a different model.
 * `operator`: a human chose.
 */
export const ROUTE_OVERRIDE_SOURCES = ['escalation', 'launchability', 'challenge', 'operator'] as const;
export type RouteOverrideSource = (typeof ROUTE_OVERRIDE_SOURCES)[number];

/**
 * One change to the model Hokusai recommended for a role. Overrides for a role
 * chain in order: the first `from` is the recommendation, each next `from` is
 * the previous `to`, and the last `to` is the executed model in
 * `selected_models`.
 */
export interface RouteOverride {
  role: RouteRole;
  source: RouteOverrideSource;
  from: string;
  to: string;
  /** Slug, e.g. `budget_exhausted`, `provider_unavailable`. Never free text. */
  reason: string;
}

/**
 * The routing-outcome block shared by `technical_task_router_row/v3` and
 * `harness_outcome_row/v2`:
 *
 * - `inference_log_id`: the Hokusai inference that made the recommendation.
 *   Present iff Hokusai routed the task. Hokusai joins the recommendation
 *   from its inference log, so rows never store a copy of it.
 * - `overrides`: present iff `inference_log_id` is. `[]` means the
 *   recommendation was followed for every role.
 * - `selected_models`: the executed models.
 *
 * "Recommendation accepted" is derived (no override for that role), never
 * stored. See `routeRecommendationFollowed`.
 */
export interface RoutingOutcomeBlock {
  inference_log_id?: string;
  overrides?: RouteOverride[];
  selected_models: TechnicalTaskRouterSelectedModels;
}

/** Keys that would store a copy of the recommendation. Rejected in every row. */
export const RECOMMENDATION_COPY_KEYS = Object.freeze([
  'recommended_model',
  'recommended_models',
  'recommended_model_id',
  'recommendation',
  'recommendation_accepted',
  'recommendedmodel',
  'recommendedmodels',
  'recommendationaccepted',
] as const);

export const HARNESS_OUTCOME_ROW_FIELDS = Object.freeze([
  'schema_version',
  'task_descriptor',
  'allowed_models',
  'selected_models',
  'budget_usd',
  'actual_cost_usd',
  'wall_clock_seconds',
  'completion_result',
  'success_under_budget',
  'inference_log_id',
  'harness',
  'task_id',
  'observed_at',
  'harness_metadata',
] as const);
export const HARNESS_OUTCOME_ROW_V2_FIELDS = Object.freeze([
  ...HARNESS_OUTCOME_ROW_FIELDS,
  'overrides',
] as const);
export const COST_BUCKET_THRESHOLDS_USD = {
  lowUpperBound: 1,
  mediumUpperBound: 5,
} as const;
export const TIME_BUCKET_THRESHOLDS_SECONDS = {
  fastUpperBound: 300,
  mediumUpperBound: 1800,
} as const;

const FORBIDDEN_KEYS = new Set([
  'prompt',
  'messages',
  'task_text',
  'raw_input',
  'eval_record',
  'originalprompt',
  'original_prompt',
  'description',
  'issue_body',
]);

export interface SubmitDataContributionRow {
  success_under_budget: boolean;
  inputs?: Record<string, ContributionScalar | ContributionScalar[] | Record<string, ContributionScalar>>;
  actual_cost_usd?: number | null;
  wall_clock_seconds?: number;
  task_id?: string;
  harness?: string;
  outcome_diagnostic?: 'eligible' | 'ineligible_missing_outcome' | 'ineligible_failed_outcome' | 'unknown';
  outcome_source?: 'feature_outcome_artifact' | 'reconstructed' | 'unknown';
  outcome_artifact_present?: boolean;
  outcome_artifact_valid?: boolean;
  outcome_artifact_used?: boolean;
  outcome_missing_fields?: string[];
  outcome_invalid_fields?: string[];
  outcome_failure_reason?: string;
}

export interface TechnicalTaskRouterSelectedModels {
  planner?: string;
  coder: string;
  reviewer: string;
}

export interface TechnicalTaskRouterContributionRowV1 {
  schema_version: typeof TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION;
  task_descriptor: HokusaiTaskDescriptor;
  allowed_models: string[];
  selected_models: TechnicalTaskRouterSelectedModels;
  budget_usd?: number;
  actual_cost_usd?: number | null;
  wall_clock_seconds?: number;
  success_under_budget: boolean;
  completion_result: 'success' | 'failure';
  scorer_ref?: string;
  observed_at: string;
  task_id?: string;
  harness?: string;
}

export type RoleAvailableModels = HokusaiAvailableModels;

export interface OutcomeLabels {
  budget_label: 'under_budget' | 'over_budget' | 'unknown';
  cost_label: 'free' | 'low' | 'medium' | 'high' | 'unknown';
  time_label: 'fast' | 'medium' | 'slow' | 'unknown';
  success_label: 'success' | 'failure';
}

export interface CandidatePoolMetadata {
  scenario_id: string;
  scenario_kind: string;
  pool_size: number;
  baseline_model?: string;
}

export interface SparseCellMetadata {
  cell_id: string;
  descriptor_signature: string;
  observed_count: number;
  is_sparse: boolean;
}

export interface TechnicalTaskRouterContributionRowV2 {
  schema_version: typeof TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2;
  task_descriptor: HokusaiTaskDescriptor;
  allowed_models: string[];
  selected_models: TechnicalTaskRouterSelectedModels;
  available_models: RoleAvailableModels;
  budget_usd?: number;
  actual_cost_usd?: number | null;
  wall_clock_seconds?: number;
  success_under_budget: boolean;
  completion_result: 'success' | 'failure';
  outcome_labels: OutcomeLabels;
  candidate_pool: CandidatePoolMetadata;
  sparse_cell: SparseCellMetadata;
  scorer_ref?: string;
  observed_at: string;
  task_id?: string;
  harness?: string;
}

/**
 * Lighter "harness" contribution row emitted by SDK plugins after a routed
 * task completes. The server classifies fidelity (training_eligible vs
 * partial) from the fields present; the SDK only builds and validates the
 * redacted shape. `task_descriptor` may be a partial descriptor.
 */
export interface HarnessOutcomeRowMetadata {
  harness?: string;
  sdk_version?: string;
}

/** Router row v2 plus the routing-outcome block (HOK-3364). */
export interface TechnicalTaskRouterContributionRowV3
  extends Omit<TechnicalTaskRouterContributionRowV2, 'schema_version'>,
    RoutingOutcomeBlock {
  schema_version: typeof TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3;
}

export interface HarnessOutcomeRowV1 {
  schema_version: typeof HARNESS_OUTCOME_ROW_SCHEMA_VERSION;
  task_descriptor: Partial<HokusaiTaskDescriptor>;
  allowed_models: string[];
  selected_models: TechnicalTaskRouterSelectedModels;
  budget_usd?: number;
  actual_cost_usd?: number;
  wall_clock_seconds?: number;
  completion_result: 'success' | 'failure';
  success_under_budget?: boolean;
  inference_log_id?: string;
  harness?: string;
  task_id?: string;
  observed_at?: string;
  harness_metadata?: HarnessOutcomeRowMetadata;
}

/** Harness row v1 plus the routing-outcome block (HOK-3364). */
export interface HarnessOutcomeRowV2
  extends Omit<HarnessOutcomeRowV1, 'schema_version'>,
    RoutingOutcomeBlock {
  schema_version: typeof HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2;
}

/** Any accepted harness row version. New writers emit v2. */
export type HarnessOutcomeRow = HarnessOutcomeRowV1 | HarnessOutcomeRowV2;

export type ContributionRow =
  | SubmitDataContributionRow
  | TechnicalTaskRouterContributionRowV1
  | TechnicalTaskRouterContributionRowV2
  | TechnicalTaskRouterContributionRowV3
  | HarnessOutcomeRowV1
  | HarnessOutcomeRowV2;

type ContributionScalar = string | number | boolean | null;

export class ContributionValidationError extends Error {
  code: 'schema_validation_failed' | 'forbidden_field';

  constructor(code: 'schema_validation_failed' | 'forbidden_field', message: string) {
    super(message);
    this.name = 'ContributionValidationError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isTechnicalTaskRouterSelectedModels(value: unknown): value is TechnicalTaskRouterSelectedModels {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, ['planner', 'coder', 'reviewer'])) {
    return false;
  }

  if (typeof value.coder !== 'string' || typeof value.reviewer !== 'string') {
    return false;
  }

  return value.planner === undefined || typeof value.planner === 'string';
}

function isRoleAvailableModels(value: unknown): value is RoleAvailableModels {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, ['planner_models', 'coder_models', 'reviewer_models'])) {
    return false;
  }

  return (
    isStringArray(value.planner_models)
    && isStringArray(value.coder_models)
    && isStringArray(value.reviewer_models)
  );
}

function isOutcomeLabels(value: unknown): value is OutcomeLabels {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, ['budget_label', 'cost_label', 'time_label', 'success_label'])) {
    return false;
  }

  return (
    (value.budget_label === 'under_budget' || value.budget_label === 'over_budget' || value.budget_label === 'unknown')
    && (value.cost_label === 'free' || value.cost_label === 'low' || value.cost_label === 'medium' || value.cost_label === 'high' || value.cost_label === 'unknown')
    && (value.time_label === 'fast' || value.time_label === 'medium' || value.time_label === 'slow' || value.time_label === 'unknown')
    && (value.success_label === 'success' || value.success_label === 'failure')
  );
}

function isCandidatePoolMetadata(value: unknown): value is CandidatePoolMetadata {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, ['scenario_id', 'scenario_kind', 'pool_size', 'baseline_model'])) {
    return false;
  }

  return (
    typeof value.scenario_id === 'string'
    && typeof value.scenario_kind === 'string'
    && isFiniteNonNegativeNumber(value.pool_size)
    && (value.baseline_model === undefined || typeof value.baseline_model === 'string')
  );
}

function isSparseCellMetadata(value: unknown): value is SparseCellMetadata {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, ['cell_id', 'descriptor_signature', 'observed_count', 'is_sparse'])) {
    return false;
  }

  return (
    typeof value.cell_id === 'string'
    && typeof value.descriptor_signature === 'string'
    && isFiniteNonNegativeNumber(value.observed_count)
    && typeof value.is_sparse === 'boolean'
  );
}

function assertNoForbiddenKeys(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, [...path, String(index)]);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      throw new ContributionValidationError(
        'forbidden_field',
        `Forbidden field at ${[...path, key].join('.')}`,
      );
    }
    assertNoForbiddenKeys(child, [...path, key]);
  }
}

const OUTCOME_DIAGNOSTIC_VALUES = new Set([
  'eligible',
  'ineligible_missing_outcome',
  'ineligible_failed_outcome',
  'unknown',
]);

const OUTCOME_SOURCE_VALUES = new Set([
  'feature_outcome_artifact',
  'reconstructed',
  'unknown',
]);

export function isSubmitDataContributionRow(value: unknown): value is SubmitDataContributionRow {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, [
    'success_under_budget',
    'inputs',
    'actual_cost_usd',
    'wall_clock_seconds',
    'task_id',
    'harness',
    'outcome_diagnostic',
    'outcome_source',
    'outcome_artifact_present',
    'outcome_artifact_valid',
    'outcome_artifact_used',
    'outcome_missing_fields',
    'outcome_invalid_fields',
    'outcome_failure_reason',
  ])) {
    return false;
  }

  if (typeof value.success_under_budget !== 'boolean') {
    return false;
  }

  if (value.inputs !== undefined && !isPlainObject(value.inputs)) {
    return false;
  }

  if (
    value.actual_cost_usd !== undefined
    && value.actual_cost_usd !== null
    && !isFiniteNonNegativeNumber(value.actual_cost_usd)
  ) {
    return false;
  }

  if (value.wall_clock_seconds !== undefined && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }

  if (value.task_id !== undefined && typeof value.task_id !== 'string') {
    return false;
  }

  if (value.harness !== undefined && typeof value.harness !== 'string') {
    return false;
  }

  if (value.outcome_diagnostic !== undefined && !OUTCOME_DIAGNOSTIC_VALUES.has(value.outcome_diagnostic as string)) {
    return false;
  }

  if (value.outcome_source !== undefined && !OUTCOME_SOURCE_VALUES.has(value.outcome_source as string)) {
    return false;
  }

  if (value.outcome_artifact_present !== undefined && typeof value.outcome_artifact_present !== 'boolean') {
    return false;
  }

  if (value.outcome_artifact_valid !== undefined && typeof value.outcome_artifact_valid !== 'boolean') {
    return false;
  }

  if (value.outcome_artifact_used !== undefined && typeof value.outcome_artifact_used !== 'boolean') {
    return false;
  }

  if (value.outcome_missing_fields !== undefined && !isStringArray(value.outcome_missing_fields)) {
    return false;
  }

  if (value.outcome_invalid_fields !== undefined && !isStringArray(value.outcome_invalid_fields)) {
    return false;
  }

  if (value.outcome_failure_reason !== undefined && typeof value.outcome_failure_reason !== 'string') {
    return false;
  }

  return !('schema_version' in value);
}

function isTechnicalTaskRouterContributionRowV1(value: unknown): value is TechnicalTaskRouterContributionRowV1 {
  if (!isPlainObject(value)) {
    return false;
  }

  if (value.schema_version !== TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, [
    'schema_version',
    'task_descriptor',
    'allowed_models',
    'selected_models',
    'budget_usd',
    'actual_cost_usd',
    'wall_clock_seconds',
    'success_under_budget',
    'completion_result',
    'scorer_ref',
    'observed_at',
    'task_id',
    'harness',
    'candidate_pools',
    'current_candidate_pools',
    'audit_metadata',
    'scenario',
    'scenarios',
  ])) {
    return false;
  }

  if (!isPlainObject(value.task_descriptor)) {
    return false;
  }

  if (!isStringArray(value.allowed_models)) {
    return false;
  }

  if (!isTechnicalTaskRouterSelectedModels(value.selected_models)) {
    return false;
  }

  if (value.budget_usd !== undefined && !isFiniteNonNegativeNumber(value.budget_usd)) {
    return false;
  }

  if (
    value.actual_cost_usd !== undefined
    && value.actual_cost_usd !== null
    && !isFiniteNonNegativeNumber(value.actual_cost_usd)
  ) {
    return false;
  }

  if (value.wall_clock_seconds !== undefined && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }

  if (typeof value.success_under_budget !== 'boolean') {
    return false;
  }

  if (value.completion_result !== 'success' && value.completion_result !== 'failure') {
    return false;
  }

  if (!isIsoDateString(value.observed_at)) {
    return false;
  }

  if (value.scorer_ref !== undefined && typeof value.scorer_ref !== 'string') {
    return false;
  }

  if (value.task_id !== undefined && typeof value.task_id !== 'string') {
    return false;
  }

  if (value.harness !== undefined && typeof value.harness !== 'string') {
    return false;
  }

  return true;
}

export function isTechnicalTaskRouterContributionRowV2(
  value: unknown,
): value is TechnicalTaskRouterContributionRowV2 {
  return isRichRouterRow(value, TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2, []);
}

export function isTechnicalTaskRouterContributionRowV3(
  value: unknown,
): value is TechnicalTaskRouterContributionRowV3 {
  return (
    isRichRouterRow(value, TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3, ['inference_log_id', 'overrides'])
    && routingOutcomeErrors(value).length === 0
  );
}

function isRichRouterRow(value: unknown, version: string, extraKeys: readonly string[]): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  if (value.schema_version !== version) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, [
    ...extraKeys,
    'schema_version',
    'task_descriptor',
    'allowed_models',
    'selected_models',
    'available_models',
    'budget_usd',
    'actual_cost_usd',
    'wall_clock_seconds',
    'success_under_budget',
    'completion_result',
    'outcome_labels',
    'candidate_pool',
    'sparse_cell',
    'scorer_ref',
    'observed_at',
    'task_id',
    'harness',
    'candidate_pools',
    'current_candidate_pools',
    'audit_metadata',
    'scenario',
    'scenarios',
  ])) {
    return false;
  }

  if (!isPlainObject(value.task_descriptor)) {
    return false;
  }

  if (!isStringArray(value.allowed_models)) {
    return false;
  }

  if (!isTechnicalTaskRouterSelectedModels(value.selected_models)) {
    return false;
  }

  if (!isRoleAvailableModels(value.available_models)) {
    return false;
  }

  if (value.budget_usd !== undefined && !isFiniteNonNegativeNumber(value.budget_usd)) {
    return false;
  }

  if (
    value.actual_cost_usd !== undefined
    && value.actual_cost_usd !== null
    && !isFiniteNonNegativeNumber(value.actual_cost_usd)
  ) {
    return false;
  }

  if (value.wall_clock_seconds !== undefined && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }

  if (typeof value.success_under_budget !== 'boolean') {
    return false;
  }

  if (value.completion_result !== 'success' && value.completion_result !== 'failure') {
    return false;
  }

  if (!isOutcomeLabels(value.outcome_labels)) {
    return false;
  }

  if (!isCandidatePoolMetadata(value.candidate_pool)) {
    return false;
  }

  if (!isSparseCellMetadata(value.sparse_cell)) {
    return false;
  }

  if (!isIsoDateString(value.observed_at)) {
    return false;
  }

  if (value.scorer_ref !== undefined && typeof value.scorer_ref !== 'string') {
    return false;
  }

  if (value.task_id !== undefined && typeof value.task_id !== 'string') {
    return false;
  }

  if (value.harness !== undefined && typeof value.harness !== 'string') {
    return false;
  }

  return true;
}

function isHarnessOutcomeRowMetadata(value: unknown): value is HarnessOutcomeRowMetadata {
  if (!isPlainObject(value)) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, ['harness', 'sdk_version'])) {
    return false;
  }

  return (
    (value.harness === undefined || typeof value.harness === 'string')
    && (value.sdk_version === undefined || typeof value.sdk_version === 'string')
  );
}

export function isHarnessOutcomeRowV1(value: unknown): value is HarnessOutcomeRowV1 {
  return isHarnessRow(value, HARNESS_OUTCOME_ROW_SCHEMA_VERSION, HARNESS_OUTCOME_ROW_FIELDS);
}

export function isHarnessOutcomeRowV2(value: unknown): value is HarnessOutcomeRowV2 {
  return (
    isHarnessRow(value, HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2, HARNESS_OUTCOME_ROW_V2_FIELDS)
    && routingOutcomeErrors(value).length === 0
  );
}

function isHarnessRow(value: unknown, version: string, fields: readonly string[]): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  if (value.schema_version !== version) {
    return false;
  }

  if (!hasOnlyAllowedKeys(value, fields)) {
    return false;
  }

  // Partial descriptor is allowed, but it must be a non-empty object.
  if (!isPlainObject(value.task_descriptor) || Object.keys(value.task_descriptor).length === 0) {
    return false;
  }

  if (!isStringArray(value.allowed_models) || value.allowed_models.length === 0) {
    return false;
  }

  if (!isTechnicalTaskRouterSelectedModels(value.selected_models)) {
    return false;
  }

  if (value.budget_usd !== undefined && !isFiniteNonNegativeNumber(value.budget_usd)) {
    return false;
  }

  if (value.actual_cost_usd !== undefined && !isFiniteNonNegativeNumber(value.actual_cost_usd)) {
    return false;
  }

  if (value.wall_clock_seconds !== undefined && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }

  if (value.completion_result !== 'success' && value.completion_result !== 'failure') {
    return false;
  }

  if (value.success_under_budget !== undefined && typeof value.success_under_budget !== 'boolean') {
    return false;
  }

  if (value.inference_log_id !== undefined && typeof value.inference_log_id !== 'string') {
    return false;
  }

  if (value.harness !== undefined && typeof value.harness !== 'string') {
    return false;
  }

  if (value.task_id !== undefined && typeof value.task_id !== 'string') {
    return false;
  }

  if (value.observed_at !== undefined && !isIsoDateString(value.observed_at)) {
    return false;
  }

  if (value.harness_metadata !== undefined && !isHarnessOutcomeRowMetadata(value.harness_metadata)) {
    return false;
  }

  return true;
}

const RECOMMENDATION_COPY_KEY_SET = new Set<string>(
  RECOMMENDATION_COPY_KEYS.map((key) => key.replaceAll('_', '')),
);
const ROUTE_SLUG_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;

/**
 * Why a row's routing-outcome block is invalid; `[]` when it is valid. Applies
 * the HOK-3364 rules: `overrides` present iff `inference_log_id` is; each
 * override well-formed; per role, overrides chain and end at the executed
 * model in `selected_models`.
 */
export function routingOutcomeErrors(row: unknown): string[] {
  if (!isPlainObject(row)) {
    return ['row must be an object'];
  }
  const errors: string[] = [];
  const routed = row.inference_log_id !== undefined;
  if (routed && (typeof row.inference_log_id !== 'string' || row.inference_log_id.trim().length === 0)) {
    errors.push('inference_log_id must be a non-empty string');
  }
  if (routed && row.overrides === undefined) {
    errors.push('a routed row must list overrides ([] when the recommendation was followed)');
  }
  if (!routed && row.overrides !== undefined) {
    errors.push('overrides require inference_log_id: an unrouted row has no recommendation to override');
  }
  if (row.overrides === undefined) {
    return errors;
  }
  if (!Array.isArray(row.overrides)) {
    return [...errors, 'overrides must be an array'];
  }
  const selected = isPlainObject(row.selected_models) ? row.selected_models : {};
  const lastByRole = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of row.overrides.entries()) {
    const label = `overrides[${index}]`;
    if (!isPlainObject(entry) || !hasOnlyAllowedKeys(entry, ['role', 'source', 'from', 'to', 'reason'])) {
      errors.push(`${label} must be an object with role, source, from, to and reason`);
      continue;
    }
    if (!(ROUTE_ROLES as readonly unknown[]).includes(entry.role)) {
      errors.push(`${label}.role must be one of: ${ROUTE_ROLES.join(', ')}`);
    }
    if (!(ROUTE_OVERRIDE_SOURCES as readonly unknown[]).includes(entry.source)) {
      errors.push(`${label}.source must be one of: ${ROUTE_OVERRIDE_SOURCES.join(', ')}`);
    }
    for (const key of ['from', 'to'] as const) {
      const model = entry[key];
      if (typeof model !== 'string' || model.trim().length === 0) {
        errors.push(`${label}.${key} must be a non-empty model id`);
      }
    }
    if (entry.from === entry.to) {
      errors.push(`${label} must change the model (from equals to)`);
    }
    if (typeof entry.reason !== 'string' || !ROUTE_SLUG_PATTERN.test(entry.reason)) {
      errors.push(`${label}.reason must be a slug`);
    }
    const previous = lastByRole.get(String(entry.role));
    if (previous && previous.to !== entry.from) {
      errors.push(`${label}.from must equal the previous ${String(entry.role)} override's to`);
    }
    lastByRole.set(String(entry.role), entry);
  }
  for (const [role, last] of lastByRole) {
    if (selected[role] !== last.to) {
      errors.push(`the last ${role} override must end at selected_models.${role}`);
    }
  }
  return errors;
}

/**
 * Whether the recommendation was followed for `role`: `undefined` for an
 * unrouted row (there was no recommendation), else true iff no override names
 * the role. Derived, never stored.
 */
export function routeRecommendationFollowed(row: RoutingOutcomeBlock, role: RouteRole): boolean | undefined {
  if (row.inference_log_id === undefined) {
    return undefined;
  }
  return !(row.overrides ?? []).some((override) => override.role === role);
}

function findRecommendationCopy(value: unknown, path: string[] = []): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findRecommendationCopy(item, [...path, String(index)]);
      if (found) return found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (RECOMMENDATION_COPY_KEY_SET.has(key.toLowerCase().replaceAll('_', ''))) {
      return [...path, key].join('.');
    }
    const found = findRecommendationCopy(child, [...path, key]);
    if (found) return found;
  }
  return undefined;
}

export function validateContributionRow(row: unknown): ContributionRow {
  assertNoForbiddenKeys(row);

  const copy = findRecommendationCopy(row);
  if (copy) {
    throw new ContributionValidationError(
      'schema_validation_failed',
      `Contribution rows must not store a recommendation copy (${copy}); Hokusai joins it from inference_log_id`,
    );
  }

  if (
    isPlainObject(row)
    && (row.schema_version === TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3
      || row.schema_version === HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2)
  ) {
    const errors = routingOutcomeErrors(row);
    if (errors.length > 0) {
      throw new ContributionValidationError(
        'schema_validation_failed',
        `Invalid routing outcome: ${errors.join('; ')}`,
      );
    }
  }

  if (
    isTechnicalTaskRouterContributionRowV1(row)
    || isTechnicalTaskRouterContributionRowV2(row)
    || isTechnicalTaskRouterContributionRowV3(row)
    || isHarnessOutcomeRowV1(row)
    || isHarnessOutcomeRowV2(row)
    || isSubmitDataContributionRow(row)
  ) {
    return row;
  }

  throw new ContributionValidationError(
    'schema_validation_failed',
    'Contribution row does not match a supported redacted schema',
  );
}
