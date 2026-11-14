/**
 * Conformance for `technical_task_router_row/v4` stage facts (HOK-3412).
 * Golden fixtures for the four acceptance shapes live in
 * `fixtures/contribution-v4.ts`; this suite pins the validation rules.
 */
import { describe, expect, it } from 'vitest';

import {
  ContributionValidationError,
  STAGE_EXECUTION_FIELDS,
  TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V4,
  TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS,
  isTechnicalTaskRouterContributionRowV3,
  isTechnicalTaskRouterContributionRowV4,
  stageExecutionErrors,
  validateContributionRow,
  type StageExecution,
  type TechnicalTaskRouterContributionRowV4,
} from './schema.js';
import { followedRecommendationRoutingFixture, routingOutcomeFixtures } from '../fixtures/routing-outcome.js';
import { claudeCodeSimpleFixture } from '../fixtures/task-cost/claude-code-simple.js';
import type { TaskCostSummaryV1 } from '../task-cost/summary.js';

const summary = claudeCodeSimpleFixture.expectedSummaries[0] as TaskCostSummaryV1;
const MODEL = 'claude-sonnet-5';

function stage(overrides: Partial<StageExecution> = {}): StageExecution {
  return {
    stage: 'coding',
    executed_model: MODEL,
    model_evidence: 'session_telemetry',
    harness: 'claude-code',
    task_cost: structuredClone(summary),
    ...overrides,
  };
}

function v4Row(overrides: Record<string, unknown> = {}): TechnicalTaskRouterContributionRowV4 {
  return {
    ...structuredClone(followedRecommendationRoutingFixture),
    schema_version: TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V4,
    task_id: summary.task_id,
    selected_models: { planner: MODEL, coder: MODEL, reviewer: MODEL },
    stage_executions: [stage({ stage: 'planning' }), stage(), stage({ stage: 'review' })],
    ...overrides,
  };
}

function without(value: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

function rejects(row: unknown, message: RegExp): void {
  expect(() => validateContributionRow(row)).toThrow(ContributionValidationError);
  expect(() => validateContributionRow(row)).toThrow(message);
  expect(isTechnicalTaskRouterContributionRowV4(row)).toBe(false);
}

describe('technical_task_router_row/v4', () => {
  it('validates a well-formed row', () => {
    const row = v4Row();
    expect(stageExecutionErrors(row)).toEqual([]);
    expect(isTechnicalTaskRouterContributionRowV4(row)).toBe(true);
    expect(validateContributionRow(row)).toBe(row);
  });

  it('accepts repair stages, a comparison group and an empty integration block', () => {
    const row = v4Row({
      stage_executions: [stage(), stage({ stage: 'review' }), stage({ stage: 'ci-fix', executed_model: 'gpt-6.1-sol', harness: 'codex' })],
      comparison_group: { id: '01a1a6cc-9f0a-7a03-99c4-3a63077de74c', role_varied: 'coder' },
      integration: {},
    });
    expect(validateContributionRow(row)).toBe(row);
  });

  it('still accepts v1–v3 rows unchanged', () => {
    for (const row of Object.values(routingOutcomeFixtures)) {
      expect(validateContributionRow(row)).toBe(row);
    }
    expect(isTechnicalTaskRouterContributionRowV3(v4Row())).toBe(false);
  });

  it('is not a v3 row with extra fields', () => {
    rejects(
      { ...followedRecommendationRoutingFixture, stage_executions: v4Row().stage_executions },
      /does not match a supported redacted schema/,
    );
  });

  it('requires a non-empty stage_executions', () => {
    rejects(v4Row({ stage_executions: [] }), /stage_executions must be a non-empty array/);
    rejects(without(v4Row(), 'stage_executions'), /stage_executions must be a non-empty array/);
  });

  it('requires task_cost on every stage', () => {
    rejects(v4Row({ stage_executions: [without(stage(), 'task_cost')] }), /task_cost is required/);
  });

  it('rejects a task_cost that breaks the task-cost contract', () => {
    rejects(
      v4Row({ stage_executions: [stage({ task_cost: { ...summary, path: '/Users/x/repo' } as TaskCostSummaryV1 })] }),
      /stage_executions\[0\]\.task_cost/,
    );
    rejects(
      v4Row({ stage_executions: [stage({ task_cost: { ...summary, event_count: 99 } })] }),
      /event_count must equal/,
    );
  });

  it('rejects a task_cost for a different task', () => {
    rejects(v4Row({ task_id: 'task-0002' }), /task_cost\.task_id must equal the row's task_id/);
  });

  it('rejects unknown stages, evidence kinds, harness slugs and extra keys', () => {
    rejects(v4Row({ stage_executions: [stage({ stage: 'deploy' as never })] }), /stage must be one of/);
    rejects(v4Row({ stage_executions: [stage({ model_evidence: 'guessed' as never })] }), /model_evidence must be one of/);
    rejects(v4Row({ stage_executions: [stage({ harness: 'Claude Code' })] }), /harness must be a harness slug/);
    rejects(v4Row({ stage_executions: [stage({ executed_model: ' ' })] }), /executed_model must be a non-empty/);
    rejects(
      v4Row({ stage_executions: [{ ...stage(), session_path: 'x' }] }),
      new RegExp(`only: ${STAGE_EXECUTION_FIELDS.join(', ')}`),
    );
  });

  it('requires the last stage per role to match selected_models', () => {
    rejects(
      v4Row({ stage_executions: [stage({ executed_model: 'claude-opus-4-7' })] }),
      /last coding stage's executed_model must equal selected_models\.coder/,
    );
    // A retried stage: only the last coding entry has to match.
    const retried = v4Row({
      stage_executions: [stage({ executed_model: 'claude-haiku-4-5' }), stage()],
    });
    expect(validateContributionRow(retried)).toBe(retried);
    // Repair stages are not checked against any role.
    const repair = v4Row({ stage_executions: [stage(), stage({ stage: 'conflict-resolution', executed_model: 'gpt-6.1-sol' })] });
    expect(validateContributionRow(repair)).toBe(repair);
  });

  it('validates comparison_group', () => {
    rejects(v4Row({ comparison_group: { id: 'pair-1', role_varied: 'coder' } }), /minted pair id/);
    rejects(
      v4Row({ comparison_group: { id: '01a1a6cc-9f0a-7a03-99c4-3a63077de74c', role_varied: 'tester' } }),
      /role_varied must be one of/,
    );
    rejects(
      v4Row({ comparison_group: { id: '01a1a6cc-9f0a-7a03-99c4-3a63077de74c', role_varied: 'coder', arm: 'a' } }),
      /only id and role_varied/,
    );
  });

  it('reserves integration for HOK-3343', () => {
    rejects(v4Row({ integration: { ci_passed: true } }), /integration is reserved/);
  });

  it('keeps the routing-outcome rules', () => {
    rejects(v4Row({ overrides: undefined }), /a routed row must list overrides/);
  });

  it('still rejects a recommendation copy and forbidden keys', () => {
    rejects(v4Row({ recommended_model: MODEL }), /recommendation copy/);
    expect(() =>
      validateContributionRow(v4Row({ stage_executions: [{ ...stage(), prompt: 'x' }] })),
    ).toThrow(/Forbidden field at stage_executions\.0\.prompt/);
  });

  it('exports a field list for the schema export', () => {
    expect(TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS).toContain('stage_executions');
    expect(TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS).toContain('comparison_group');
    expect(TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS).not.toContain('candidate_pools');
    for (const key of Object.keys(v4Row())) {
      expect(TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS).toContain(key);
    }
  });
});
