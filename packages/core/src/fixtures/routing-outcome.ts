/**
 * Golden routing-outcome rows (HOK-3364): `technical_task_router_row/v3` and
 * `harness_outcome_row/v2` with the shared routing-outcome block. Hand-written:
 * changing one is a contract change. Model ids reproduce the 2026-10-30
 * incident shapes; ids are synthetic.
 */

import type { HokusaiTaskDescriptor } from '../contribution/descriptor-types.js';
import type {
  HarnessOutcomeRowV2,
  TechnicalTaskRouterContributionRowV3,
} from '../contribution/schema.js';

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

const pool = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7', 'glm-5.3-flash'];

function routerRow(
  routing: Pick<TechnicalTaskRouterContributionRowV3, 'selected_models'> &
    Partial<Pick<TechnicalTaskRouterContributionRowV3, 'inference_log_id' | 'overrides'>>,
  success: boolean,
): TechnicalTaskRouterContributionRowV3 {
  return {
    schema_version: 'technical_task_router_row/v3',
    task_descriptor: descriptor,
    allowed_models: pool,
    available_models: { planner_models: pool, coder_models: pool, reviewer_models: pool },
    budget_usd: 5,
    actual_cost_usd: 2.29,
    wall_clock_seconds: 1840,
    success_under_budget: success,
    completion_result: success ? 'success' : 'failure',
    outcome_labels: {
      budget_label: 'under_budget',
      cost_label: 'medium',
      time_label: 'slow',
      success_label: success ? 'success' : 'failure',
    },
    candidate_pool: { scenario_id: 'wavemill-default', scenario_kind: 'production', pool_size: pool.length },
    sparse_cell: { cell_id: 'bugfix-typescript', descriptor_signature: 'bugfix|typescript|backend', observed_count: 41, is_sparse: false },
    observed_at: '2026-10-30T18:00:00.000Z',
    harness: 'wavemill',
    ...routing,
  };
}

/** Hokusai's recommendation was run as given: `overrides: []`. */
export const followedRecommendationRoutingFixture = routerRow(
  {
    inference_log_id: '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a70',
    overrides: [],
    selected_models: { planner: 'claude-sonnet-4-6', coder: 'claude-sonnet-4-6', reviewer: 'claude-sonnet-4-6' },
  },
  true,
);

/** HOK-3329 shape: Hokusai recommended `claude-haiku-4-5`; Wavemill's escalation ran `glm-5.3-flash`. */
export const escalationOverrideRoutingFixture = routerRow(
  {
    inference_log_id: '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a71',
    overrides: [
      { role: 'coder', source: 'escalation', from: 'claude-haiku-4-5', to: 'glm-5.3-flash', reason: 'stage_failed' },
    ],
    selected_models: { coder: 'glm-5.3-flash', reviewer: 'claude-sonnet-4-6' },
  },
  false,
);

/** HOK-3315 shape: Hokusai recommended `claude-opus-4-7`; the challenge program ran `claude-haiku-4-5`. */
export const challengeOverrideRoutingFixture = routerRow(
  {
    inference_log_id: '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a72',
    overrides: [
      { role: 'coder', source: 'challenge', from: 'claude-opus-4-7', to: 'claude-haiku-4-5', reason: 'challenge_arm' },
    ],
    selected_models: { coder: 'claude-haiku-4-5', reviewer: 'claude-sonnet-4-6' },
  },
  false,
);

/** An operator rerouted the reviewer; the coder followed the recommendation. */
export const operatorRerouteRoutingFixture = routerRow(
  {
    inference_log_id: '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a73',
    overrides: [
      { role: 'reviewer', source: 'operator', from: 'claude-haiku-4-5', to: 'claude-opus-4-7', reason: 'operator_reroute' },
    ],
    selected_models: { coder: 'claude-sonnet-4-6', reviewer: 'claude-opus-4-7' },
  },
  true,
);

/** Not routed by Hokusai: plain telemetry, no join key and no overrides. */
export const unroutedTelemetryRoutingFixture = routerRow(
  { selected_models: { coder: 'claude-sonnet-4-6', reviewer: 'claude-sonnet-4-6' } },
  true,
);

/** A plugin harness row that followed the recommendation. */
export const followedRecommendationHarnessRowFixture: HarnessOutcomeRowV2 = {
  schema_version: 'harness_outcome_row/v2',
  task_descriptor: { task_type: 'feature', language: 'typescript' },
  allowed_models: ['claude-sonnet-4-6', 'claude-opus-4-8'],
  selected_models: { coder: 'claude-sonnet-4-6', reviewer: 'claude-sonnet-4-6' },
  completion_result: 'success',
  budget_usd: 1,
  actual_cost_usd: 0.42,
  inference_log_id: '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a74',
  overrides: [],
  harness: 'claude-code',
  task_id: 'task-routed',
  observed_at: '2026-10-30T18:00:00.000Z',
};

export const routingOutcomeFixtures = {
  followedRecommendation: followedRecommendationRoutingFixture,
  escalationOverride: escalationOverrideRoutingFixture,
  challengeOverride: challengeOverrideRoutingFixture,
  operatorReroute: operatorRerouteRoutingFixture,
  unroutedTelemetry: unroutedTelemetryRoutingFixture,
  followedRecommendationHarnessRow: followedRecommendationHarnessRowFixture,
} as const;
