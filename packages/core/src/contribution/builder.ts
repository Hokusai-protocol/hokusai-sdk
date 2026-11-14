/**
 * Build redacted Hokusai contribution rows from safe Wavemill projections.
 *
 * @module hokusai-contribution-builder
 */

import type { HokusaiAvailableModels, HokusaiTaskDescriptor } from './descriptor-types.js';
import {
  COST_BUCKET_THRESHOLDS_USD,
  HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2,
  TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION,
  TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2,
  TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3,
  TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V4,
  TIME_BUCKET_THRESHOLDS_SECONDS,
  validateContributionRow,
  type CandidatePoolMetadata,
  type HarnessOutcomeRowMetadata,
  type HarnessOutcomeRowV2,
  type ModelEvidence,
  type OutcomeLabels,
  type RouteOverride,
  type RouteRole,
  type RoleAvailableModels,
  type SparseCellMetadata,
  type StageExecution,
  type StageExecutionStage,
  type SubmitDataContributionRow,
  type TechnicalTaskRouterContributionRowV1,
  type TechnicalTaskRouterContributionRowV2,
  type TechnicalTaskRouterContributionRowV3,
  type TechnicalTaskRouterContributionRowV4,
  type TechnicalTaskRouterSelectedModels,
} from './schema.js';
import { TASK_COST_HARNESSES, type TaskCostHarness } from '../task-cost/enums.js';
import type { TaskCostSummaryV1 } from '../task-cost/summary.js';
import { unavailableTaskCostSummary } from '../task-cost/unavailable.js';

type InputScalar = string | number | boolean | null;

export interface FeatureOutcomeDiagnosticProjection {
  outcomeDiagnostic?: 'eligible' | 'ineligible_missing_outcome' | 'ineligible_failed_outcome' | 'unknown';
  outcomeSource?: 'feature_outcome_artifact' | 'reconstructed' | 'unknown';
  outcomeArtifactPresent?: boolean;
  outcomeArtifactValid?: boolean;
  outcomeArtifactUsed?: boolean;
  outcomeMissingFields?: string[];
  outcomeInvalidFields?: string[];
  outcomeFailureReason?: string;
}

export interface RedactedEvalContributionProjection extends FeatureOutcomeDiagnosticProjection {
  taskId?: string;
  runId?: string;
  harness?: string;
  observedAt: string;
  observedSuccess: boolean;
  budgetCompliant: boolean;
  actualCostUsd?: number | null;
  wallClockSeconds?: number;
  inputs?: Record<string, unknown>;
  taskDescriptor?: HokusaiTaskDescriptor;
  allowedModels?: string[];
  selectedModels?: {
    planner?: string;
    coder: string;
    reviewer: string;
  };
  budgetUsd?: number;
  scorerRef?: string;
}

export interface RedactedEvalContributionProjectionV2 extends RedactedEvalContributionProjection {
  availableModels?: HokusaiAvailableModels;
  candidatePool?: CandidatePoolMetadata;
  sparseCell?: SparseCellMetadata;
  outcomeLabelOverrides?: Partial<OutcomeLabels>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toCompactInputValue(value: unknown): InputScalar | InputScalar[] | Record<string, InputScalar> | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const compact = value.filter(
      (entry): entry is InputScalar =>
        entry === null
        || typeof entry === 'string'
        || typeof entry === 'number'
        || typeof entry === 'boolean',
    );
    return compact.length > 0 ? compact : undefined;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const compactEntries = Object.entries(value).flatMap(([key, entry]) => {
    if (
      entry === null
      || typeof entry === 'string'
      || typeof entry === 'number'
      || typeof entry === 'boolean'
    ) {
      return [[key, entry] as const];
    }
    return [];
  });

  return compactEntries.length > 0 ? Object.fromEntries(compactEntries) : undefined;
}

function toCompactInputs(inputs?: Record<string, unknown>): SubmitDataContributionRow['inputs'] {
  if (!inputs) {
    return undefined;
  }

  const compactEntries = Object.entries(inputs).flatMap(([key, value]) => {
    const compactValue = toCompactInputValue(value);
    return compactValue === undefined ? [] : [[key, compactValue] as const];
  });

  return compactEntries.length > 0 ? Object.fromEntries(compactEntries) : undefined;
}

function deriveBudgetLabel(projection: RedactedEvalContributionProjection): OutcomeLabels['budget_label'] {
  if (
    projection.budgetUsd === undefined
    || projection.actualCostUsd === undefined
    || projection.actualCostUsd === null
  ) {
    return 'unknown';
  }

  return projection.actualCostUsd <= projection.budgetUsd ? 'under_budget' : 'over_budget';
}

function deriveCostLabel(actualCostUsd?: number | null): OutcomeLabels['cost_label'] {
  if (actualCostUsd === undefined || actualCostUsd === null) {
    return 'unknown';
  }

  if (actualCostUsd === 0) {
    return 'free';
  }

  if (actualCostUsd < COST_BUCKET_THRESHOLDS_USD.lowUpperBound) {
    return 'low';
  }

  if (actualCostUsd < COST_BUCKET_THRESHOLDS_USD.mediumUpperBound) {
    return 'medium';
  }

  return 'high';
}

function deriveTimeLabel(wallClockSeconds?: number): OutcomeLabels['time_label'] {
  if (wallClockSeconds === undefined) {
    return 'unknown';
  }

  if (wallClockSeconds < TIME_BUCKET_THRESHOLDS_SECONDS.fastUpperBound) {
    return 'fast';
  }

  if (wallClockSeconds < TIME_BUCKET_THRESHOLDS_SECONDS.mediumUpperBound) {
    return 'medium';
  }

  return 'slow';
}

export function deriveOutcomeLabels(
  projection: RedactedEvalContributionProjectionV2,
): OutcomeLabels {
  const derived: OutcomeLabels = {
    budget_label: deriveBudgetLabel(projection),
    cost_label: deriveCostLabel(projection.actualCostUsd),
    time_label: deriveTimeLabel(projection.wallClockSeconds),
    success_label: projection.observedSuccess ? 'success' : 'failure',
  };

  return {
    ...derived,
    ...projection.outcomeLabelOverrides,
  };
}

function deriveAvailableModels(
  projection: RedactedEvalContributionProjectionV2,
): RoleAvailableModels {
  if (projection.availableModels) {
    return {
      planner_models: [...projection.availableModels.planner_models],
      coder_models: [...projection.availableModels.coder_models],
      reviewer_models: [...projection.availableModels.reviewer_models],
    };
  }

  const allowedModels = projection.allowedModels ? [...projection.allowedModels] : [];
  const plannerModels = projection.selectedModels?.planner ? allowedModels : [];

  return {
    planner_models: plannerModels,
    coder_models: allowedModels,
    reviewer_models: allowedModels,
  };
}

function deriveCandidatePool(
  projection: RedactedEvalContributionProjectionV2,
): CandidatePoolMetadata {
  if (projection.candidatePool) {
    return { ...projection.candidatePool };
  }

  return {
    scenario_id: 'unknown',
    scenario_kind: 'unknown',
    pool_size: projection.allowedModels?.length ?? 0,
  };
}

function deriveSparseCell(
  projection: RedactedEvalContributionProjectionV2,
): SparseCellMetadata {
  if (projection.sparseCell) {
    return { ...projection.sparseCell };
  }

  return {
    cell_id: 'unknown',
    descriptor_signature: 'unknown',
    observed_count: 0,
    is_sparse: false,
  };
}

export function buildSubmitDataContributionRow(
  projection: RedactedEvalContributionProjection,
): SubmitDataContributionRow {
  const row: SubmitDataContributionRow = {
    success_under_budget: projection.observedSuccess && projection.budgetCompliant,
    ...(projection.actualCostUsd !== undefined
      ? { actual_cost_usd: projection.actualCostUsd }
      : {}),
    ...(projection.wallClockSeconds !== undefined
      ? { wall_clock_seconds: projection.wallClockSeconds }
      : {}),
    ...(projection.taskId ? { task_id: projection.taskId } : {}),
    ...(projection.harness ? { harness: projection.harness } : {}),
    ...(projection.outcomeDiagnostic !== undefined
      ? { outcome_diagnostic: projection.outcomeDiagnostic }
      : {}),
    ...(projection.outcomeSource !== undefined
      ? { outcome_source: projection.outcomeSource }
      : {}),
    ...(projection.outcomeArtifactPresent !== undefined
      ? { outcome_artifact_present: projection.outcomeArtifactPresent }
      : {}),
    ...(projection.outcomeArtifactValid !== undefined
      ? { outcome_artifact_valid: projection.outcomeArtifactValid }
      : {}),
    ...(projection.outcomeArtifactUsed !== undefined
      ? { outcome_artifact_used: projection.outcomeArtifactUsed }
      : {}),
    ...(projection.outcomeMissingFields !== undefined
      ? { outcome_missing_fields: projection.outcomeMissingFields }
      : {}),
    ...(projection.outcomeInvalidFields !== undefined
      ? { outcome_invalid_fields: projection.outcomeInvalidFields }
      : {}),
    ...(projection.outcomeFailureReason !== undefined
      ? { outcome_failure_reason: projection.outcomeFailureReason }
      : {}),
  };

  const inputs = toCompactInputs(projection.inputs);
  if (inputs) {
    row.inputs = inputs;
  }

  return validateContributionRow(row) as SubmitDataContributionRow;
}

/**
 * The routing-outcome inputs every row builder takes (HOK-3364). When the task
 * was routed by Hokusai, pass its `inferenceLogId` **and** the overrides the
 * harness applied (`[]` if it ran exactly what Hokusai recommended). There is
 * no default: a builder never assumes the recommendation was followed.
 */
export interface RoutingOutcomeProjection {
  inferenceLogId?: string;
  routeOverrides?: RouteOverride[];
}

function routingOutcomeFields(projection: RoutingOutcomeProjection): {
  inference_log_id?: string;
  overrides?: RouteOverride[];
} {
  if (projection.inferenceLogId && projection.routeOverrides === undefined) {
    throw new Error(
      'routeOverrides is required for a routed task: pass [] if the recommendation was followed',
    );
  }
  if (!projection.inferenceLogId && projection.routeOverrides !== undefined) {
    throw new Error('routeOverrides requires inferenceLogId: an unrouted task has no recommendation');
  }
  return projection.inferenceLogId
    ? {
        inference_log_id: projection.inferenceLogId,
        overrides: (projection.routeOverrides ?? []).map((override) => ({ ...override })),
      }
    : {};
}

export interface RedactedEvalContributionProjectionV3
  extends RedactedEvalContributionProjectionV2,
    RoutingOutcomeProjection {}

export interface HarnessOutcomeRowProjection extends RoutingOutcomeProjection {
  taskDescriptor: Partial<HokusaiTaskDescriptor>;
  allowedModels: string[];
  selectedModels: TechnicalTaskRouterSelectedModels;
  budgetUsd?: number;
  actualCostUsd?: number;
  wallClockSeconds?: number;
  completionResult: 'success' | 'failure';
  successUnderBudget?: boolean;
  harness?: string;
  sdkVersion?: string;
  taskId?: string;
  observedAt?: string;
}

export function buildHarnessOutcomeRow(
  projection: HarnessOutcomeRowProjection,
): HarnessOutcomeRowV2 {
  if (
    !projection.taskDescriptor
    || Object.keys(projection.taskDescriptor).length === 0
  ) {
    throw new Error('taskDescriptor must be a non-empty object');
  }

  if (!projection.allowedModels || projection.allowedModels.length === 0) {
    throw new Error('allowedModels must be a non-empty array');
  }

  if (!projection.selectedModels) {
    throw new Error('selectedModels is required');
  }

  const harnessMetadata: HarnessOutcomeRowMetadata = {
    ...(projection.harness ? { harness: projection.harness } : {}),
    ...(projection.sdkVersion ? { sdk_version: projection.sdkVersion } : {}),
  };

  const row: HarnessOutcomeRowV2 = {
    schema_version: HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2,
    task_descriptor: { ...projection.taskDescriptor },
    allowed_models: [...projection.allowedModels],
    selected_models: { ...projection.selectedModels },
    completion_result: projection.completionResult,
    ...(projection.budgetUsd !== undefined ? { budget_usd: projection.budgetUsd } : {}),
    ...(projection.actualCostUsd !== undefined
      ? { actual_cost_usd: projection.actualCostUsd }
      : {}),
    ...(projection.wallClockSeconds !== undefined
      ? { wall_clock_seconds: projection.wallClockSeconds }
      : {}),
    ...(projection.successUnderBudget !== undefined
      ? { success_under_budget: projection.successUnderBudget }
      : {}),
    ...routingOutcomeFields(projection),
    ...(projection.harness ? { harness: projection.harness } : {}),
    ...(projection.taskId ? { task_id: projection.taskId } : {}),
    ...(projection.observedAt ? { observed_at: projection.observedAt } : {}),
    ...(Object.keys(harnessMetadata).length > 0
      ? { harness_metadata: harnessMetadata }
      : {}),
  };

  return validateContributionRow(row) as HarnessOutcomeRowV2;
}

export function buildTechnicalTaskRouterContributionRow(
  projection: RedactedEvalContributionProjection,
): TechnicalTaskRouterContributionRowV1 {
  if (!projection.taskDescriptor || !projection.allowedModels || !projection.selectedModels) {
    throw new Error('taskDescriptor, allowedModels, and selectedModels are required');
  }

  const row: TechnicalTaskRouterContributionRowV1 = {
    schema_version: TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION,
    task_descriptor: projection.taskDescriptor,
    allowed_models: [...projection.allowedModels],
    selected_models: { ...projection.selectedModels },
    success_under_budget: projection.observedSuccess && projection.budgetCompliant,
    completion_result: projection.observedSuccess ? 'success' : 'failure',
    observed_at: projection.observedAt,
    ...(projection.budgetUsd !== undefined ? { budget_usd: projection.budgetUsd } : {}),
    ...(projection.actualCostUsd !== undefined
      ? { actual_cost_usd: projection.actualCostUsd }
      : {}),
    ...(projection.wallClockSeconds !== undefined
      ? { wall_clock_seconds: projection.wallClockSeconds }
      : {}),
    ...(projection.scorerRef ? { scorer_ref: projection.scorerRef } : {}),
    ...(projection.taskId ? { task_id: projection.taskId } : {}),
    ...(projection.harness ? { harness: projection.harness } : {}),
  };

  return validateContributionRow(row) as TechnicalTaskRouterContributionRowV1;
}

export function buildTechnicalTaskRouterContributionRowV2(
  projection: RedactedEvalContributionProjectionV2,
): TechnicalTaskRouterContributionRowV2 {
  if (!projection.taskDescriptor || !projection.allowedModels || !projection.selectedModels) {
    throw new Error('taskDescriptor, allowedModels, and selectedModels are required');
  }

  const row: TechnicalTaskRouterContributionRowV2 = {
    schema_version: TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2,
    task_descriptor: projection.taskDescriptor,
    allowed_models: [...projection.allowedModels],
    selected_models: { ...projection.selectedModels },
    available_models: deriveAvailableModels(projection),
    success_under_budget: projection.observedSuccess && projection.budgetCompliant,
    completion_result: projection.observedSuccess ? 'success' : 'failure',
    outcome_labels: deriveOutcomeLabels(projection),
    candidate_pool: deriveCandidatePool(projection),
    sparse_cell: deriveSparseCell(projection),
    observed_at: projection.observedAt,
    ...(projection.budgetUsd !== undefined ? { budget_usd: projection.budgetUsd } : {}),
    ...(projection.actualCostUsd !== undefined
      ? { actual_cost_usd: projection.actualCostUsd }
      : {}),
    ...(projection.wallClockSeconds !== undefined
      ? { wall_clock_seconds: projection.wallClockSeconds }
      : {}),
    ...(projection.scorerRef ? { scorer_ref: projection.scorerRef } : {}),
    ...(projection.taskId ? { task_id: projection.taskId } : {}),
    ...(projection.harness ? { harness: projection.harness } : {}),
  };

  return validateContributionRow(row) as TechnicalTaskRouterContributionRowV2;
}

/**
 * Router row v3: v2 plus the routing-outcome block. New writers (Wavemill's
 * export, HOK-3363) emit this; v1/v2 rows stay accepted.
 */
export function buildTechnicalTaskRouterContributionRowV3(
  projection: RedactedEvalContributionProjectionV3,
): TechnicalTaskRouterContributionRowV3 {
  const row: TechnicalTaskRouterContributionRowV3 = {
    ...buildTechnicalTaskRouterContributionRowV2(projection),
    schema_version: TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3,
    ...routingOutcomeFields(projection),
  };

  return validateContributionRow(row) as TechnicalTaskRouterContributionRowV3;
}

/**
 * A stage's measured cost. Structural, so a `@hokusai/costs` `TaskCostReport`
 * (from `measureTask` or `tracker.summary()`) satisfies it directly: core never
 * imports `@hokusai/costs`.
 */
export interface StageCostInput {
  summaries: readonly TaskCostSummaryV1[];
}

export interface StageExecutionProjection {
  stage: StageExecutionStage;
  executedModel: string;
  modelEvidence: ModelEvidence;
  /** Harness slug that ran the stage. */
  harness: string;
  /**
   * The report over this stage's sessions. One summary per stage: a report that
   * spans several harnesses must be split into one stage per harness. An empty
   * report becomes an `unavailable` summary, so every stage carries a cost.
   */
  cost: StageCostInput;
  /** Sessions the stage used; recorded on an unavailable summary. */
  sessionIds?: readonly string[];
}

export interface RedactedEvalContributionProjectionV4 extends RedactedEvalContributionProjectionV3 {
  /** Required on v4: every stage's `task_cost` is keyed on it. */
  taskId: string;
  /** One entry per stage that ran, in run order. */
  stageExecutions: readonly StageExecutionProjection[];
  comparisonGroup?: { id: string; roleVaried: RouteRole };
  /** Version of the SDK writing the row (`SDK_VERSION`). */
  sdkVersion?: string;
}

function toTaskCostHarness(harness: string): TaskCostHarness {
  return (TASK_COST_HARNESSES as readonly string[]).includes(harness)
    ? (harness as TaskCostHarness)
    : 'unknown';
}

function stageTaskCost(
  stage: StageExecutionProjection,
  taskId: string,
  collectedAt: string,
): TaskCostSummaryV1 {
  const { summaries } = stage.cost;
  if (summaries.length > 1) {
    throw new Error(
      `stage ${stage.stage} spans ${String(summaries.length)} task-cost summaries; split it into one stage per harness`,
    );
  }
  const [summary] = summaries;
  if (summary) {
    return structuredClone(summary);
  }
  return unavailableTaskCostSummary({
    taskId,
    harness: toTaskCostHarness(stage.harness),
    collectedAt,
    ...(stage.sessionIds ? { sessionIds: stage.sessionIds } : {}),
  });
}

/** Sum of every stage's resolved total, or `undefined` unless all resolved. */
function sumStageTotals(stages: readonly StageExecution[]): number | undefined {
  let sum = 0;
  for (const stage of stages) {
    const total = stage.task_cost.total_cost_usd;
    if (total === null) return undefined;
    sum += total;
  }
  return Math.round(sum * 1e9) / 1e9;
}

/**
 * Router row v4: v3 plus per-stage execution and token facts (HOK-3412). Pass
 * each stage's `measureTask` / tracker report as its `cost`; this builder does
 * all token handling, so a harness never writes its own.
 *
 * When `actualCostUsd` is omitted and every stage's cost resolved, it is set to
 * their sum (so `outcome_labels.cost_label` is known). It stays
 * contributor-reported evidence: Hokusai reprices from the stages.
 */
export function buildTechnicalTaskRouterRowV4(
  projection: RedactedEvalContributionProjectionV4,
): TechnicalTaskRouterContributionRowV4 {
  if (!projection.taskId) {
    throw new Error('taskId is required for a v4 row');
  }
  if (projection.stageExecutions.length === 0) {
    throw new Error('stageExecutions must list at least one stage');
  }

  const stageExecutions: StageExecution[] = projection.stageExecutions.map((stage) => ({
    stage: stage.stage,
    executed_model: stage.executedModel,
    model_evidence: stage.modelEvidence,
    harness: stage.harness,
    task_cost: stageTaskCost(stage, projection.taskId, projection.observedAt),
  }));

  const actualCostUsd =
    projection.actualCostUsd !== undefined ? projection.actualCostUsd : sumStageTotals(stageExecutions);

  const row: TechnicalTaskRouterContributionRowV4 = {
    ...buildTechnicalTaskRouterContributionRowV3({
      ...projection,
      ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
    }),
    schema_version: TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V4,
    stage_executions: stageExecutions,
    ...(projection.comparisonGroup
      ? {
          comparison_group: {
            id: projection.comparisonGroup.id,
            role_varied: projection.comparisonGroup.roleVaried,
          },
        }
      : {}),
    ...(projection.sdkVersion ? { sdk_version: projection.sdkVersion } : {}),
  };

  return validateContributionRow(row) as TechnicalTaskRouterContributionRowV4;
}
