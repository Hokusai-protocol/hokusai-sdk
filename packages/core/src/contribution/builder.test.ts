import { describe, it, expect } from 'vitest';
import {
  buildSubmitDataContributionRow,
  buildTechnicalTaskRouterContributionRow,
  buildTechnicalTaskRouterContributionRowV2,
  deriveOutcomeLabels,
} from './builder.js';
import type {
  RedactedEvalContributionProjection,
  RedactedEvalContributionProjectionV2,
} from './builder.js';

// Allow overrides to explicitly set optional properties to `undefined` under
// exactOptionalPropertyTypes (these tests intentionally clear defaulted fields).
type ProjectionOverrides<T> = { [K in keyof T]?: T[K] | undefined };

function makeProjection(
  overrides: ProjectionOverrides<RedactedEvalContributionProjection> = {},
): RedactedEvalContributionProjection {
  return {
    taskId: 'redacted-task',
    runId: 'redacted-run',
    harness: 'wavemill',
    observedAt: '2026-05-30T12:00:00.000Z',
    observedSuccess: true,
    budgetCompliant: true,
    actualCostUsd: 1.25,
    wallClockSeconds: 30,
    inputs: {
      route_family: 'balanced',
      retries: 2,
      flags: ['a', 'b'],
      nested: {
        compact: 'ok',
        dropped: { not: 'kept' },
      },
    },
    taskDescriptor: {
      task_type: 'feature',
      language: 'typescript',
      domain: 'frontend',
      complexity: 5,
      repo_size_bucket: 'medium',
      files_touched_bucket: '2_5',
      description_length_bucket: 'medium',
      is_greenfield: false,
      is_migration: false,
      requires_tests: true,
      cross_service: false,
      ui_heavy: true,
      risk_level: 'medium',
    },
    allowedModels: ['planner-a', 'coder-a', 'reviewer-a'],
    selectedModels: {
      planner: 'planner-a',
      coder: 'coder-a',
      reviewer: 'reviewer-a',
    },
    budgetUsd: 10,
    scorerRef: 'router-benchmark/v1',
    ...overrides,
  } as RedactedEvalContributionProjection;
}

function makeProjectionV2(
  overrides: ProjectionOverrides<RedactedEvalContributionProjectionV2> = {},
): RedactedEvalContributionProjectionV2 {
  return {
    ...makeProjection(),
    availableModels: {
      planner_models: ['planner-a'],
      coder_models: ['coder-a', 'deepseek-coder-v2'],
      reviewer_models: ['reviewer-a'],
    },
    candidatePool: {
      scenario_id: 'challenger-qwen',
      scenario_kind: 'challenger',
      pool_size: 2,
      baseline_model: 'gpt-5.4',
    },
    sparseCell: {
      cell_id: 'frontend-medium-2_5',
      descriptor_signature: 'frontend|medium|2_5',
      observed_count: 2,
      is_sparse: true,
    },
    ...overrides,
  } as RedactedEvalContributionProjectionV2;
}

describe('hokusai-contribution-builder', () => {
  it('builds a minimal submit-data row', () => {
    const row = buildSubmitDataContributionRow(makeProjection({
      actualCostUsd: undefined,
      wallClockSeconds: undefined,
      inputs: undefined,
      harness: undefined,
      taskId: undefined,
    }));

    expect(row).toEqual({
      success_under_budget: true,
    });
  });

  it('builds a full submit-data row and compacts inputs', () => {
    const row = buildSubmitDataContributionRow(makeProjection());

    expect(row.success_under_budget).toBe(true);
    expect(row.inputs).toEqual({
      route_family: 'balanced',
      retries: 2,
      flags: ['a', 'b'],
      nested: { compact: 'ok' },
    });
  });

  it('preserves null actual cost in submit-data rows', () => {
    const row = buildSubmitDataContributionRow(makeProjection({
      actualCostUsd: null,
      budgetCompliant: false,
    }));

    expect(row.actual_cost_usd).toBe(null);
    expect(row.success_under_budget).toBe(false);
  });

  it('builds a benchmark row', () => {
    const row = buildTechnicalTaskRouterContributionRow(makeProjection());
    expect(row.completion_result).toBe('success');
    expect(row.success_under_budget).toBe(true);
    expect(row.selected_models.coder).toBe('coder-a');
  });

  it('preserves null actual cost in benchmark rows', () => {
    const row = buildTechnicalTaskRouterContributionRow(makeProjection({
      actualCostUsd: null,
      budgetCompliant: false,
    }));

    expect(row.actual_cost_usd).toBe(null);
    expect(row.success_under_budget).toBe(false);
  });

  it('uses observed success plus budget compliance for success_under_budget', () => {
    const row = buildSubmitDataContributionRow(makeProjection({
      observedSuccess: true,
      budgetCompliant: false,
    }));
    expect(row.success_under_budget).toBe(false);
  });

  it('omits unknown raw text fields from inputs', () => {
    const row = buildSubmitDataContributionRow(makeProjection({
      inputs: {
        safe: 'kept',
        large_blob: { body: { deeper: 'dropped' } },
      },
    }));

    expect(row.inputs).toEqual({
      safe: 'kept',
    });
  });

  it('builds a full v2 benchmark row', () => {
    const row = buildTechnicalTaskRouterContributionRowV2(makeProjectionV2());

    expect(row.schema_version).toBe('technical_task_router_row/v2');
    expect(row.available_models.coder_models[1]).toBe('deepseek-coder-v2');
    expect(row.candidate_pool.baseline_model).toBe('gpt-5.4');
    expect(row.sparse_cell.is_sparse).toBe(true);
  });

  it('supports challenger rows with Qwen coder ids', () => {
    const row = buildTechnicalTaskRouterContributionRowV2(makeProjectionV2({
      selectedModels: {
        planner: 'planner-a',
        coder: 'qwen2.5-coder-32b',
        reviewer: 'reviewer-a',
      },
      availableModels: {
        planner_models: ['planner-a'],
        coder_models: ['qwen2.5-coder-32b', 'deepseek-coder-v2'],
        reviewer_models: ['reviewer-a'],
      },
    }));

    expect(row.selected_models.coder).toBe('qwen2.5-coder-32b');
    expect(row.candidate_pool.scenario_kind).toBe('challenger');
  });

  it('derives outcome labels from observed cost and time', () => {
    const labels = deriveOutcomeLabels(makeProjectionV2({
      budgetUsd: 2,
      actualCostUsd: 6,
      wallClockSeconds: 3600,
      observedSuccess: false,
    }));

    expect(labels).toEqual({
      budget_label: 'over_budget',
      cost_label: 'high',
      time_label: 'slow',
      success_label: 'failure',
    });
  });

  it('applies role-pool fallback when role-specific pools are missing', () => {
    const row = buildTechnicalTaskRouterContributionRowV2(makeProjectionV2({
      availableModels: undefined,
      selectedModels: {
        coder: 'coder-a',
        reviewer: 'reviewer-a',
      },
    }));

    expect(row.available_models).toEqual({
      planner_models: [],
      coder_models: ['planner-a', 'coder-a', 'reviewer-a'],
      reviewer_models: ['planner-a', 'coder-a', 'reviewer-a'],
    });
  });

  it('fills default v2 metadata when optional scenario fields are absent', () => {
    const row = buildTechnicalTaskRouterContributionRowV2(makeProjectionV2({
      candidatePool: undefined,
      sparseCell: undefined,
      actualCostUsd: null,
      wallClockSeconds: undefined,
      budgetUsd: undefined,
    }));

    expect(row.candidate_pool).toEqual({
      scenario_id: 'unknown',
      scenario_kind: 'unknown',
      pool_size: 3,
    });
    expect(row.sparse_cell).toEqual({
      cell_id: 'unknown',
      descriptor_signature: 'unknown',
      observed_count: 0,
      is_sparse: false,
    });
    expect(row.outcome_labels).toEqual({
      budget_label: 'unknown',
      cost_label: 'unknown',
      time_label: 'unknown',
      success_label: 'success',
    });
  });
});

// ────────────────────────────────────────────────────────────────
// Feature outcome diagnostic columns in buildSubmitDataContributionRow (HOK-2262)
// ────────────────────────────────────────────────────────────────

describe('buildSubmitDataContributionRow – outcome diagnostic fields (HOK-2262)', () => {
  it('includes outcome diagnostic fields when all set on projection', () => {
    const projection = makeProjection({
      outcomeDiagnostic: 'eligible',
      outcomeSource: 'feature_outcome_artifact',
      outcomeArtifactPresent: true,
      outcomeArtifactValid: true,
      outcomeArtifactUsed: true,
      outcomeMissingFields: [],
      outcomeInvalidFields: [],
      outcomeFailureReason: undefined,
    });
    const row = buildSubmitDataContributionRow(projection);
    expect(row.outcome_diagnostic).toBe('eligible');
    expect(row.outcome_source).toBe('feature_outcome_artifact');
    expect(row.outcome_artifact_present).toBe(true);
    expect(row.outcome_artifact_valid).toBe(true);
    expect(row.outcome_artifact_used).toBe(true);
    expect(row.outcome_missing_fields).toEqual([]);
    expect(row.outcome_invalid_fields).toEqual([]);
    expect(row.outcome_failure_reason).toBe(undefined);
  });

  it('omits outcome diagnostic fields when not set on projection', () => {
    const projection = makeProjection({
      outcomeDiagnostic: undefined,
      outcomeSource: undefined,
      outcomeArtifactPresent: undefined,
    });
    const row = buildSubmitDataContributionRow(projection);
    expect(row.outcome_diagnostic).toBe(undefined);
    expect(row.outcome_source).toBe(undefined);
    expect(row.outcome_artifact_present).toBe(undefined);
  });

  it('includes failure reason when artifact is invalid', () => {
    const projection = makeProjection({
      outcomeDiagnostic: 'unknown',
      outcomeSource: 'unknown',
      outcomeArtifactPresent: true,
      outcomeArtifactValid: false,
      outcomeArtifactUsed: false,
      outcomeMissingFields: ['merged', 'ciPassed'],
      outcomeFailureReason: 'incomplete_outcome',
    });
    const row = buildSubmitDataContributionRow(projection);
    expect(row.outcome_diagnostic).toBe('unknown');
    expect(row.outcome_artifact_valid).toBe(false);
    expect(row.outcome_missing_fields).toEqual(['merged', 'ciPassed']);
    expect(row.outcome_failure_reason).toBe('incomplete_outcome');
  });

  it('ineligible_failed_outcome flows through', () => {
    const projection = makeProjection({
      outcomeDiagnostic: 'ineligible_failed_outcome',
      outcomeSource: 'feature_outcome_artifact',
      outcomeArtifactPresent: true,
      outcomeArtifactValid: true,
      outcomeArtifactUsed: true,
      outcomeMissingFields: [],
      outcomeInvalidFields: [],
      outcomeFailureReason: 'ineligible_failed_outcome',
    });
    const row = buildSubmitDataContributionRow(projection);
    expect(row.outcome_diagnostic).toBe('ineligible_failed_outcome');
    expect(row.outcome_failure_reason).toBe('ineligible_failed_outcome');
  });
});
