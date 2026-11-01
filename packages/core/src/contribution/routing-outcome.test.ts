/**
 * Conformance for the HOK-3364 routing-outcome block shared by
 * `technical_task_router_row/v3` and `harness_outcome_row/v2`.
 */
import { describe, expect, it } from 'vitest';

import { buildTechnicalTaskRouterContributionRowV3 } from './builder.js';
import {
  ContributionValidationError,
  isTechnicalTaskRouterContributionRowV2,
  isTechnicalTaskRouterContributionRowV3,
  routeRecommendationFollowed,
  routingOutcomeErrors,
  validateContributionRow,
} from './schema.js';
import {
  challengeOverrideRoutingFixture,
  escalationOverrideRoutingFixture,
  followedRecommendationRoutingFixture,
  operatorRerouteRoutingFixture,
  routingOutcomeFixtures,
  unroutedTelemetryRoutingFixture,
} from '../fixtures/routing-outcome.js';

function without(row: object, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

function rejects(row: unknown, message?: RegExp): void {
  expect(() => validateContributionRow(row)).toThrow(ContributionValidationError);
  if (message) expect(() => validateContributionRow(row)).toThrow(message);
}

describe('routing-outcome golden fixtures', () => {
  for (const [name, row] of Object.entries(routingOutcomeFixtures)) {
    it(`${name} validates and stores no recommendation copy`, () => {
      expect(validateContributionRow(row)).toBe(row);
      expect(routingOutcomeErrors(row)).toEqual([]);
      expect(JSON.stringify(Object.keys(row))).not.toMatch(/recommend/i);
    });
  }

  it('derives "recommendation followed" per role instead of storing it', () => {
    expect(routeRecommendationFollowed(followedRecommendationRoutingFixture, 'coder')).toBe(true);
    expect(routeRecommendationFollowed(escalationOverrideRoutingFixture, 'coder')).toBe(false);
    expect(routeRecommendationFollowed(escalationOverrideRoutingFixture, 'reviewer')).toBe(true);
    expect(routeRecommendationFollowed(challengeOverrideRoutingFixture, 'coder')).toBe(false);
    expect(routeRecommendationFollowed(operatorRerouteRoutingFixture, 'reviewer')).toBe(false);
    expect(routeRecommendationFollowed(operatorRerouteRoutingFixture, 'coder')).toBe(true);
    expect(routeRecommendationFollowed(unroutedTelemetryRoutingFixture, 'coder')).toBeUndefined();
  });

  it('the v3 builder reproduces a golden row from its projection', () => {
    const golden = escalationOverrideRoutingFixture;
    const built = buildTechnicalTaskRouterContributionRowV3({
      taskDescriptor: golden.task_descriptor,
      allowedModels: golden.allowed_models,
      selectedModels: golden.selected_models,
      availableModels: golden.available_models,
      candidatePool: golden.candidate_pool,
      sparseCell: golden.sparse_cell,
      budgetUsd: golden.budget_usd!,
      actualCostUsd: golden.actual_cost_usd!,
      wallClockSeconds: golden.wall_clock_seconds!,
      observedSuccess: false,
      budgetCompliant: true,
      observedAt: golden.observed_at,
      harness: golden.harness!,
      inferenceLogId: golden.inference_log_id!,
      routeOverrides: golden.overrides!,
    });
    expect(built).toEqual(golden);
  });

  it('v2 router rows from older writers stay accepted', () => {
    const v2 = {
      ...without(followedRecommendationRoutingFixture, 'inference_log_id', 'overrides'),
      schema_version: 'technical_task_router_row/v2',
    };
    expect(isTechnicalTaskRouterContributionRowV2(v2)).toBe(true);
    expect(validateContributionRow(v2)).toBe(v2);
  });
});

describe('routing-outcome conformance', () => {
  it('fails a routed row that lacks inference_log_id (overrides without a join key)', () => {
    rejects(without(escalationOverrideRoutingFixture, 'inference_log_id'), /overrides require inference_log_id/);
  });

  it('fails a routed row that omits overrides: absence never means "followed"', () => {
    rejects(without(followedRecommendationRoutingFixture, 'overrides'), /must list overrides/);
  });

  it.each([
    ['recommended_model', { recommended_model: 'claude-opus-4-7' }],
    ['recommendation_accepted', { recommendation_accepted: false }],
    ['recommendedModel (camelCase)', { recommendedModel: 'claude-opus-4-7' }],
  ])('fails a row that stores a recommendation copy (%s)', (_label, extra) => {
    rejects({ ...followedRecommendationRoutingFixture, ...extra }, /recommendation copy/);
    rejects({ ...unroutedTelemetryRoutingFixture, ...extra }, /recommendation copy/);
  });

  it('fails an override whose chain does not end at the executed model', () => {
    rejects(
      {
        ...challengeOverrideRoutingFixture,
        selected_models: { coder: 'claude-sonnet-4-6', reviewer: 'claude-sonnet-4-6' },
      },
      /end at selected_models.coder/,
    );
  });

  it('accepts a chained override and fails a broken chain', () => {
    const chained = {
      ...escalationOverrideRoutingFixture,
      overrides: [
        { role: 'coder', source: 'escalation', from: 'claude-haiku-4-5', to: 'claude-sonnet-4-6', reason: 'stage_failed' },
        { role: 'coder', source: 'operator', from: 'claude-sonnet-4-6', to: 'glm-5.3-flash', reason: 'operator_reroute' },
      ],
    };
    expect(isTechnicalTaskRouterContributionRowV3(chained)).toBe(true);
    rejects(
      {
        ...chained,
        overrides: [chained.overrides[0], { ...chained.overrides[1], from: 'claude-opus-4-7' }],
      },
      /previous coder override/,
    );
  });

  it.each([
    ['an unknown source', { source: 'router' }],
    ['an unknown role', { role: 'tester' }],
    ['a no-op change', { to: 'claude-haiku-4-5' }],
    ['a free-text reason', { reason: 'Escalated because the model kept failing' }],
  ])('fails an override with %s', (_label, change) => {
    const [override] = escalationOverrideRoutingFixture.overrides!;
    rejects({ ...escalationOverrideRoutingFixture, overrides: [{ ...override, ...change }] });
  });

  it('a planner override needs an executed planner', () => {
    rejects({
      ...followedRecommendationRoutingFixture,
      selected_models: { coder: 'claude-sonnet-4-6', reviewer: 'claude-sonnet-4-6' },
      overrides: [{ role: 'planner', source: 'launchability', from: 'claude-opus-4-7', to: 'claude-sonnet-4-6', reason: 'provider_unavailable' }],
    });
  });
});
