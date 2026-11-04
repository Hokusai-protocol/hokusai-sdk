/**
 * `buildTechnicalTaskRouterRowV4` and `unavailableTaskCostSummary` (HOK-3412).
 */
import { describe, expect, it } from 'vitest';

import {
  buildTechnicalTaskRouterRowV4,
  type RedactedEvalContributionProjectionV4,
  type StageExecutionProjection,
} from './builder.js';
import { isTechnicalTaskRouterContributionRowV4 } from './schema.js';
import { claudeCodeSimpleFixture } from '../fixtures/task-cost/claude-code-simple.js';
import { aggregateTaskCost } from '../task-cost/aggregate.js';
import type { TaskCostSummaryV1 } from '../task-cost/summary.js';
import {
  defaultProviderContractVersion,
  unavailableTaskCostSummary,
} from '../task-cost/unavailable.js';
import { isTaskCostSummaryV1 } from '../task-cost/validators.js';

const MODEL = 'claude-sonnet-5';
const measured: TaskCostSummaryV1 = aggregateTaskCost(claudeCodeSimpleFixture.events);
const TASK_ID = measured.task_id;
const OBSERVED_AT = '2026-11-04T12:00:00.000Z';

function stage(overrides: Partial<StageExecutionProjection> = {}): StageExecutionProjection {
  return {
    stage: 'coding',
    executedModel: MODEL,
    modelEvidence: 'session_telemetry',
    harness: 'claude-code',
    cost: { summaries: [measured] },
    ...overrides,
  };
}

function projection(
  overrides: Partial<RedactedEvalContributionProjectionV4> = {},
): RedactedEvalContributionProjectionV4 {
  return {
    taskId: TASK_ID,
    observedAt: OBSERVED_AT,
    observedSuccess: true,
    budgetCompliant: true,
    taskDescriptor: { task_type: 'bugfix', language: 'typescript' } as never,
    allowedModels: [MODEL, 'claude-opus-4-7'],
    selectedModels: { coder: MODEL, reviewer: MODEL },
    budgetUsd: 5,
    harness: 'claude-code',
    inferenceLogId: '0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a70',
    routeOverrides: [],
    stageExecutions: [stage(), stage({ stage: 'review' })],
    ...overrides,
  };
}

describe('buildTechnicalTaskRouterRowV4', () => {
  it('builds a valid v4 row whose stage costs are the measured summaries', () => {
    const row = buildTechnicalTaskRouterRowV4(projection());
    expect(isTechnicalTaskRouterContributionRowV4(row)).toBe(true);
    expect(row.schema_version).toBe('technical_task_router_row/v4');
    expect(row.task_id).toBe(TASK_ID);
    expect(row.stage_executions.map((s) => s.stage)).toEqual(['coding', 'review']);
    expect(row.stage_executions[0]?.task_cost).toEqual(measured);
    // A copy: mutating the caller's summary later cannot change the row.
    expect(row.stage_executions[0]?.task_cost).not.toBe(measured);
    expect(row.overrides).toEqual([]);
  });

  it('accepts a @hokusai/costs-shaped report (extra fields ignored)', () => {
    const report = { taskId: TASK_ID, totalUsd: 0.0489, summaries: [measured] };
    const row = buildTechnicalTaskRouterRowV4(projection({ stageExecutions: [stage({ cost: report })] }));
    expect(row.stage_executions[0]?.task_cost.usage).toEqual(measured.usage);
  });

  it('turns an empty report into an unavailable summary', () => {
    const row = buildTechnicalTaskRouterRowV4(
      projection({
        stageExecutions: [stage({ harness: 'aider', cost: { summaries: [] }, sessionIds: ['s-2', 's-1', 's-2'] })],
        selectedModels: { coder: MODEL, reviewer: MODEL },
      }),
    );
    const cost = row.stage_executions[0]?.task_cost;
    expect(cost).toMatchObject({
      task_id: TASK_ID,
      harness: 'unknown',
      provider_contract_version: 'unknown/1',
      coverage: 'unavailable',
      total_cost_usd: null,
      event_count: 0,
      session_ids: ['s-1', 's-2'],
      collected_at: OBSERVED_AT,
    });
    expect(row.stage_executions[0]?.harness).toBe('aider');
    expect(row.actual_cost_usd).toBeUndefined();
    expect(row.outcome_labels.cost_label).toBe('unknown');
  });

  it('rejects a stage spanning several harness summaries', () => {
    expect(() =>
      buildTechnicalTaskRouterRowV4(projection({ stageExecutions: [stage({ cost: { summaries: [measured, measured] } })] })),
    ).toThrow(/spans 2 task-cost summaries; split it into one stage per harness/);
  });

  it('derives actual_cost_usd from the stages when every stage resolved', () => {
    const row = buildTechnicalTaskRouterRowV4(projection());
    expect(measured.total_cost_usd).toBe(0.0489);
    expect(row.actual_cost_usd).toBe(0.0978);
    expect(row.outcome_labels.cost_label).toBe('low');
    expect(row.outcome_labels.budget_label).toBe('under_budget');
  });

  it('keeps an explicit actualCostUsd, including null', () => {
    expect(buildTechnicalTaskRouterRowV4(projection({ actualCostUsd: 1.5 })).actual_cost_usd).toBe(1.5);
    expect(buildTechnicalTaskRouterRowV4(projection({ actualCostUsd: null })).actual_cost_usd).toBeNull();
  });

  it('omits the derived total when any stage is unresolved', () => {
    const row = buildTechnicalTaskRouterRowV4(
      projection({ stageExecutions: [stage(), stage({ stage: 'review', cost: { summaries: [] } })] }),
    );
    expect(row.actual_cost_usd).toBeUndefined();
  });

  it('maps the comparison group', () => {
    const row = buildTechnicalTaskRouterRowV4(
      projection({ comparisonGroup: { id: '01a1a6cc-9f0a-7a03-99c4-3a63077de74c', roleVaried: 'coder' } }),
    );
    expect(row.comparison_group).toEqual({ id: '01a1a6cc-9f0a-7a03-99c4-3a63077de74c', role_varied: 'coder' });
  });

  it('requires taskId and at least one stage', () => {
    expect(() => buildTechnicalTaskRouterRowV4(projection({ taskId: '' }))).toThrow(/taskId is required/);
    expect(() => buildTechnicalTaskRouterRowV4(projection({ stageExecutions: [] }))).toThrow(/at least one stage/);
  });

  it('enforces the schema rules through validation', () => {
    expect(() =>
      buildTechnicalTaskRouterRowV4(projection({ stageExecutions: [stage({ executedModel: 'claude-opus-4-7' })] })),
    ).toThrow(/last coding stage's executed_model must equal selected_models\.coder/);
    expect(() => buildTechnicalTaskRouterRowV4(projection({ taskId: 'task-0002' }))).toThrow(
      /task_cost\.task_id must equal the row's task_id/,
    );
  });

  it('keeps the routing-outcome rule: a routed row needs overrides', () => {
    const routedWithoutOverrides = projection();
    delete routedWithoutOverrides.routeOverrides;
    expect(() => buildTechnicalTaskRouterRowV4(routedWithoutOverrides)).toThrow(
      /routeOverrides is required for a routed task/,
    );
  });
});

describe('unavailableTaskCostSummary', () => {
  it('builds a valid summary with nothing measured', () => {
    const summary = unavailableTaskCostSummary({ taskId: 'task-9', harness: 'codex', collectedAt: OBSERVED_AT });
    expect(isTaskCostSummaryV1(summary)).toBe(true);
    expect(summary.provider_contract_version).toBe('codex/2');
    expect(summary.usage).toEqual({
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
    });
    expect(summary.cost_basis).toBe('unknown');
    expect(summary.field_availability.usage).toBe('unavailable');
  });

  it('defaults the provider contract per harness', () => {
    expect(defaultProviderContractVersion('claude-code')).toBe('claude-code/1');
    expect(defaultProviderContractVersion('wavemill')).toBe('wavemill/1');
    expect(defaultProviderContractVersion('unknown')).toBe('unknown/1');
  });

  it('rejects ids the contract rejects', () => {
    expect(() =>
      unavailableTaskCostSummary({ taskId: 'has space', harness: 'native', collectedAt: OBSERVED_AT }),
    ).toThrow();
  });
});

describe('sdk_version on v4 rows', () => {
  it('is stamped when given and validated as a version string', () => {
    const row = buildTechnicalTaskRouterRowV4(projection({ sdkVersion: '0.8.0' }));
    expect(row.sdk_version).toBe('0.8.0');
    expect(() => buildTechnicalTaskRouterRowV4(projection({ sdkVersion: 'not a version' }))).toThrow(
      /sdk_version must be a version string/,
    );
    expect(buildTechnicalTaskRouterRowV4(projection())).not.toHaveProperty('sdk_version');
  });
});
