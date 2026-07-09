import { describe, it, expect } from 'vitest';
import { buildHarnessOutcomeRow } from './builder.js';
import type { HarnessOutcomeRowProjection } from './builder.js';
import {
  ContributionValidationError,
  HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
  isHarnessOutcomeRowV1,
  validateContributionRow,
} from './schema.js';
import type { HokusaiTaskDescriptor } from './descriptor-types.js';

// Allow overrides to explicitly set optional properties to `undefined` under
// exactOptionalPropertyTypes (these tests intentionally clear defaulted fields).
type ProjectionOverrides<T> = { [K in keyof T]?: T[K] | undefined };

function makeProjection(
  overrides: ProjectionOverrides<HarnessOutcomeRowProjection> = {},
): HarnessOutcomeRowProjection {
  return {
    inferenceLogId: 'inf-123',
    taskDescriptor: {
      task_type: 'feature',
      language: 'typescript',
      domain: 'backend',
    },
    allowedModels: ['model-a', 'model-b'],
    selectedModels: { coder: 'model-a', reviewer: 'model-b' },
    budgetUsd: 5,
    actualCostUsd: 1.25,
    wallClockSeconds: 42,
    completionResult: 'success',
    harness: 'claude-code',
    sdkVersion: '0.2.0',
    taskId: 'task-1',
    observedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  } as HarnessOutcomeRowProjection;
}

describe('buildHarnessOutcomeRow', () => {
  it('builds and validates a training-eligible row', () => {
    const row = buildHarnessOutcomeRow(makeProjection());

    expect(row.schema_version).toBe(HARNESS_OUTCOME_ROW_SCHEMA_VERSION);
    expect(row.allowed_models).toEqual(['model-a', 'model-b']);
    expect(row.selected_models).toEqual({ coder: 'model-a', reviewer: 'model-b' });
    expect(row.budget_usd).toBe(5);
    expect(row.actual_cost_usd).toBe(1.25);
    expect(row.completion_result).toBe('success');
    expect(row.inference_log_id).toBe('inf-123');
    expect(row.harness_metadata).toEqual({ harness: 'claude-code', sdk_version: '0.2.0' });
    expect(isHarnessOutcomeRowV1(row)).toBe(true);
    expect(validateContributionRow(row)).toBe(row);
  });

  it('builds a row that omits cost/budget (server marks partial)', () => {
    const row = buildHarnessOutcomeRow(
      makeProjection({ budgetUsd: undefined, actualCostUsd: undefined }),
    );

    expect('budget_usd' in row).toBe(false);
    expect('actual_cost_usd' in row).toBe(false);
    expect(isHarnessOutcomeRowV1(row)).toBe(true);
  });

  it('accepts a partial task descriptor', () => {
    const row = buildHarnessOutcomeRow(
      makeProjection({ taskDescriptor: { task_type: 'bugfix' } }),
    );

    expect(row.task_descriptor).toEqual({ task_type: 'bugfix' });
    expect(isHarnessOutcomeRowV1(row)).toBe(true);
  });

  it('throws when a forbidden key is present in the descriptor', () => {
    expect(() =>
      buildHarnessOutcomeRow(
        makeProjection({
          taskDescriptor: { prompt: 'raw text' } as unknown as Partial<HokusaiTaskDescriptor>,
        }),
      ),
    ).toThrow(ContributionValidationError);
  });

  it('throws when allowedModels is empty', () => {
    expect(() => buildHarnessOutcomeRow(makeProjection({ allowedModels: [] }))).toThrow(
      /allowedModels/,
    );
  });

  it('throws when the task descriptor is empty', () => {
    expect(() => buildHarnessOutcomeRow(makeProjection({ taskDescriptor: {} }))).toThrow(
      /taskDescriptor/,
    );
  });
});
