/**
 * Types for Wavemill's `technical_task_router_row/v4` producer (HOK-3412).
 * The producer itself lands in HOK-3415; it builds rows with
 * `buildTechnicalTaskRouterRowV4` from `@hokusai/core`, passing one
 * `@hokusai/costs` report per stage.
 *
 * @module contribution
 */

export type {
  ComparisonGroup,
  ModelEvidence,
  RedactedEvalContributionProjectionV4 as WavemillContributionProjectionV4,
  StageCostInput,
  StageExecution,
  StageExecutionProjection as WavemillStageExecutionProjection,
  StageExecutionStage,
  TechnicalTaskRouterContributionRowV4,
} from '@hokusai/core';
