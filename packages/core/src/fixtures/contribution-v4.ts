/**
 * Golden `technical_task_router_row/v4` rows (HOK-3412). Hand-written:
 * changing one is a contract change.
 *
 * Every stage's `task_cost` is an existing golden task-cost summary
 * (HOK-3072). `contributionV4StageSources` names the source fixture of each
 * stage, so `@hokusai/costs` can replay that stage's events and prove its
 * report equals the row's `task_cost` (the HOK-3412 parity acceptance).
 * Ids are synthetic.
 */

import type { HokusaiTaskDescriptor } from '../contribution/descriptor-types.js';
import type {
  StageExecution,
  StageExecutionStage,
  TechnicalTaskRouterContributionRowV4,
} from '../contribution/schema.js';
import type { TaskCostSummaryV1 } from '../task-cost/summary.js';
import type { TaskCostFixture } from './task-cost/builders.js';
import { claudeCodeCacheTiersFixture } from './task-cost/claude-code-cache-tiers.js';
import { claudeCodeModelSwitchFixture } from './task-cost/claude-code-model-switch.js';
import { claudeCodeRetryFixture } from './task-cost/claude-code-retry.js';
import { claudeCodeSimpleFixture } from './task-cost/claude-code-simple.js';
import { codexRealCacheFixture } from './task-cost/codex-real-cache.js';
import { codexSimpleFixture } from './task-cost/codex-simple.js';
import { nativeSimpleFixture } from './task-cost/native-simple.js';

const TASK_ID = 'task-0001';
const INFERENCE_LOG_ID = '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a80';
/** Minted `pair_id` of the challenge pair (task-attempt contract, HOK-3372). */
export const CONTRIBUTION_V4_CHALLENGE_PAIR_ID = '01a1a6d0-0000-7000-8000-000000000001';

const descriptor: HokusaiTaskDescriptor = {
  task_type: 'bugfix',
  language: 'typescript',
  domain: 'backend',
  complexity: 3,
  repo_size_bucket: 'large',
  files_touched_bucket: '2_5',
  description_length_bucket: 'medium',
  is_greenfield: false,
  is_migration: false,
  requires_tests: true,
  cross_service: false,
  ui_heavy: false,
  risk_level: 'medium',
};

const pool = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8', 'gpt-5-codex'];

function summaryOf(fixture: TaskCostFixture): TaskCostSummaryV1 {
  const [summary] = fixture.expectedSummaries;
  if (!summary) throw new Error(`task-cost fixture ${fixture.name} has no summary`);
  return summary;
}

function stage(
  name: StageExecutionStage,
  executedModel: string,
  harness: string,
  source: TaskCostFixture,
  modelEvidence: StageExecution['model_evidence'] = 'session_telemetry',
): StageExecution {
  return {
    stage: name,
    executed_model: executedModel,
    model_evidence: modelEvidence,
    harness,
    task_cost: summaryOf(source),
  };
}

type V4Fields = Pick<
  TechnicalTaskRouterContributionRowV4,
  'selected_models' | 'stage_executions' | 'actual_cost_usd' | 'outcome_labels'
> &
  Partial<
    Pick<TechnicalTaskRouterContributionRowV4, 'inference_log_id' | 'overrides' | 'comparison_group' | 'harness'>
  >;

function v4Row(fields: V4Fields): TechnicalTaskRouterContributionRowV4 {
  return {
    schema_version: 'technical_task_router_row/v4',
    task_descriptor: descriptor,
    allowed_models: pool,
    available_models: { planner_models: pool, coder_models: pool, reviewer_models: pool },
    budget_usd: 5,
    wall_clock_seconds: 1840,
    success_under_budget: true,
    completion_result: 'success',
    candidate_pool: { scenario_id: 'wavemill-default', scenario_kind: 'production', pool_size: pool.length },
    sparse_cell: {
      cell_id: 'bugfix-typescript',
      descriptor_signature: 'bugfix|typescript|backend',
      observed_count: 41,
      is_sparse: false,
    },
    observed_at: '2026-11-04T18:00:00.000Z',
    task_id: TASK_ID,
    harness: 'wavemill',
    ...fields,
  };
}

const lowCostLabels = {
  budget_label: 'under_budget',
  cost_label: 'low',
  time_label: 'slow',
  success_label: 'success',
} as const;

/** Single harness: Claude Code ran every stage; the coder switched opus → sonnet mid-stage. */
export const singleHarnessV4Fixture = v4Row({
  inference_log_id: INFERENCE_LOG_ID,
  overrides: [],
  selected_models: { planner: 'claude-sonnet-5', coder: 'claude-sonnet-5', reviewer: 'claude-opus-4-8' },
  stage_executions: [
    stage('planning', 'claude-sonnet-5', 'claude-code', claudeCodeSimpleFixture),
    stage('coding', 'claude-sonnet-5', 'claude-code', claudeCodeModelSwitchFixture),
    stage('review', 'claude-opus-4-8', 'claude-code', claudeCodeCacheTiersFixture),
  ],
  // 0.0489 + 0.1185 + 0.10925
  actual_cost_usd: 0.27665,
  outcome_labels: lowCostLabels,
});

/** Mixed harness: Claude Code planner and reviewer, native coder. */
export const mixedHarnessV4Fixture = v4Row({
  inference_log_id: INFERENCE_LOG_ID,
  overrides: [],
  selected_models: { planner: 'claude-sonnet-5', coder: 'claude-haiku-4-5', reviewer: 'claude-sonnet-5' },
  stage_executions: [
    stage('planning', 'claude-sonnet-5', 'claude-code', claudeCodeSimpleFixture),
    stage('coding', 'claude-haiku-4-5', 'native', nativeSimpleFixture, 'provider_response'),
    stage('review', 'claude-sonnet-5', 'claude-code', claudeCodeRetryFixture),
  ],
  // 0.0489 + 0.0027 + 0.0399
  actual_cost_usd: 0.0915,
  outcome_labels: lowCostLabels,
});

/** Challenge pair, primary arm: ran the recommended coder. */
export const challengePrimaryV4Fixture = v4Row({
  inference_log_id: INFERENCE_LOG_ID,
  overrides: [],
  comparison_group: { id: CONTRIBUTION_V4_CHALLENGE_PAIR_ID, role_varied: 'coder' },
  selected_models: { coder: 'claude-sonnet-5', reviewer: 'claude-opus-4-8' },
  stage_executions: [
    stage('coding', 'claude-sonnet-5', 'claude-code', claudeCodeSimpleFixture),
    stage('review', 'claude-opus-4-8', 'claude-code', claudeCodeCacheTiersFixture),
  ],
  // 0.0489 + 0.10925
  actual_cost_usd: 0.15815,
  outcome_labels: lowCostLabels,
});

/** Challenge pair, challenger arm: the challenge program swapped the coder to Codex. */
export const challengeChallengerV4Fixture = v4Row({
  inference_log_id: INFERENCE_LOG_ID,
  overrides: [
    { role: 'coder', source: 'challenge', from: 'claude-sonnet-5', to: 'gpt-5-codex', reason: 'challenge_arm' },
  ],
  comparison_group: { id: CONTRIBUTION_V4_CHALLENGE_PAIR_ID, role_varied: 'coder' },
  selected_models: { coder: 'gpt-5-codex', reviewer: 'claude-opus-4-8' },
  stage_executions: [
    stage('coding', 'gpt-5-codex', 'codex', codexSimpleFixture),
    stage('review', 'claude-opus-4-8', 'claude-code', claudeCodeCacheTiersFixture),
  ],
  // 0.02125 + 0.10925
  actual_cost_usd: 0.1305,
  outcome_labels: lowCostLabels,
});

/** A `ci-fix` repair stage after review; unrouted (no recommendation to override). */
export const ciFixRepairV4Fixture = v4Row({
  selected_models: { coder: 'gpt-5-codex', reviewer: 'claude-opus-4-8' },
  stage_executions: [
    stage('coding', 'gpt-5-codex', 'codex', codexSimpleFixture),
    stage('review', 'claude-opus-4-8', 'claude-code', claudeCodeCacheTiersFixture),
    stage('ci-fix', 'gpt-5-codex', 'codex', codexRealCacheFixture),
  ],
  // 0.02125 + 0.10925 + 0.605988
  actual_cost_usd: 0.736488,
  outcome_labels: lowCostLabels,
});

export const contributionV4Fixtures = {
  singleHarness: singleHarnessV4Fixture,
  mixedHarness: mixedHarnessV4Fixture,
  challengePrimary: challengePrimaryV4Fixture,
  challengeChallenger: challengeChallengerV4Fixture,
  ciFixRepair: ciFixRepairV4Fixture,
} as const;

export type ContributionV4FixtureName = keyof typeof contributionV4Fixtures;

/** The task-cost fixture behind each stage, in `stage_executions` order. */
export const contributionV4StageSources: Readonly<Record<ContributionV4FixtureName, readonly TaskCostFixture[]>> = {
  singleHarness: [claudeCodeSimpleFixture, claudeCodeModelSwitchFixture, claudeCodeCacheTiersFixture],
  mixedHarness: [claudeCodeSimpleFixture, nativeSimpleFixture, claudeCodeRetryFixture],
  challengePrimary: [claudeCodeSimpleFixture, claudeCodeCacheTiersFixture],
  challengeChallenger: [codexSimpleFixture, claudeCodeCacheTiersFixture],
  ciFixRepair: [codexSimpleFixture, claudeCodeCacheTiersFixture, codexRealCacheFixture],
};
