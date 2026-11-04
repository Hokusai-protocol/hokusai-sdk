/**
 * The four HOK-3412 acceptance shapes (`fixtures/contribution-v4.ts`): each
 * validates, its contributor-reported total agrees with its stages, and the
 * builder reproduces it exactly from stage reports.
 */
import { describe, expect, it } from 'vitest';

import { buildTechnicalTaskRouterRowV4, type StageExecutionProjection } from './builder.js';
import {
  isTechnicalTaskRouterContributionRowV4,
  stageExecutionErrors,
  validateContributionRow,
  type TechnicalTaskRouterContributionRowV4,
} from './schema.js';
import {
  CONTRIBUTION_V4_CHALLENGE_PAIR_ID,
  contributionV4Fixtures,
  contributionV4StageSources,
  type ContributionV4FixtureName,
} from '../fixtures/contribution-v4.js';

const entries = Object.entries(contributionV4Fixtures) as [
  ContributionV4FixtureName,
  TechnicalTaskRouterContributionRowV4,
][];

/** Rebuild a golden row through the public builder from its stage reports. */
function rebuild(name: ContributionV4FixtureName, row: TechnicalTaskRouterContributionRowV4) {
  const sources = contributionV4StageSources[name];
  const stageExecutions: StageExecutionProjection[] = row.stage_executions.map((stage, index) => ({
    stage: stage.stage,
    executedModel: stage.executed_model,
    modelEvidence: stage.model_evidence,
    harness: stage.harness,
    cost: { summaries: sources[index]?.expectedSummaries ?? [] },
  }));
  return buildTechnicalTaskRouterRowV4({
    taskId: row.task_id ?? '',
    observedAt: row.observed_at,
    observedSuccess: row.completion_result === 'success',
    budgetCompliant: row.success_under_budget,
    taskDescriptor: row.task_descriptor,
    allowedModels: row.allowed_models,
    availableModels: row.available_models,
    selectedModels: row.selected_models,
    candidatePool: row.candidate_pool,
    sparseCell: row.sparse_cell,
    ...(row.budget_usd !== undefined ? { budgetUsd: row.budget_usd } : {}),
    ...(row.wall_clock_seconds !== undefined ? { wallClockSeconds: row.wall_clock_seconds } : {}),
    ...(row.harness ? { harness: row.harness } : {}),
    ...(row.inference_log_id ? { inferenceLogId: row.inference_log_id, routeOverrides: row.overrides ?? [] } : {}),
    ...(row.comparison_group
      ? { comparisonGroup: { id: row.comparison_group.id, roleVaried: row.comparison_group.role_varied } }
      : {}),
    stageExecutions,
  });
}

describe('contribution v4 golden fixtures', () => {
  it('covers the acceptance shapes', () => {
    expect(entries.map(([name]) => name)).toEqual([
      'singleHarness',
      'mixedHarness',
      'challengePrimary',
      'challengeChallenger',
      'ciFixRepair',
    ]);
  });

  describe.each(entries)('%s', (name, row) => {
    it('validates', () => {
      expect(stageExecutionErrors(row)).toEqual([]);
      expect(isTechnicalTaskRouterContributionRowV4(row)).toBe(true);
      expect(validateContributionRow(row)).toBe(row);
    });

    it('has one source fixture per stage, carried verbatim as task_cost', () => {
      const sources = contributionV4StageSources[name];
      expect(sources).toHaveLength(row.stage_executions.length);
      row.stage_executions.forEach((stage, index) => {
        expect(stage.task_cost).toEqual(sources[index]?.expectedSummaries[0]);
      });
    });

    it('reports actual_cost_usd equal to the sum of stage totals', () => {
      const sum = row.stage_executions.reduce((total, stage) => total + (stage.task_cost.total_cost_usd ?? Number.NaN), 0);
      expect(row.actual_cost_usd).toBe(Math.round(sum * 1e9) / 1e9);
    });

    it('is reproduced exactly by buildTechnicalTaskRouterRowV4', () => {
      expect(rebuild(name, row)).toEqual(row);
    });
  });

  it('single harness: one harness for every stage', () => {
    expect(new Set(contributionV4Fixtures.singleHarness.stage_executions.map((s) => s.harness))).toEqual(
      new Set(['claude-code']),
    );
  });

  it('mixed harness: Claude Code planner, native coder', () => {
    const stages = contributionV4Fixtures.mixedHarness.stage_executions;
    expect(stages.find((s) => s.stage === 'planning')?.harness).toBe('claude-code');
    expect(stages.find((s) => s.stage === 'coding')?.harness).toBe('native');
    expect(stages.find((s) => s.stage === 'coding')?.task_cost.harness).toBe('native');
  });

  it('challenge pair: same group and task, only the varied role differs', () => {
    const { challengePrimary: primary, challengeChallenger: challenger } = contributionV4Fixtures;
    expect(primary.comparison_group).toEqual({ id: CONTRIBUTION_V4_CHALLENGE_PAIR_ID, role_varied: 'coder' });
    expect(challenger.comparison_group).toEqual(primary.comparison_group);
    expect(challenger.task_id).toBe(primary.task_id);
    expect(challenger.selected_models.coder).not.toBe(primary.selected_models.coder);
    expect(challenger.selected_models.reviewer).toBe(primary.selected_models.reviewer);
    expect(challenger.overrides).toEqual([
      { role: 'coder', source: 'challenge', from: 'claude-sonnet-5', to: 'gpt-5-codex', reason: 'challenge_arm' },
    ]);
  });

  it('ci-fix repair: the repair stage runs after review and carries its own cost', () => {
    const stages = contributionV4Fixtures.ciFixRepair.stage_executions;
    expect(stages.map((s) => s.stage)).toEqual(['coding', 'review', 'ci-fix']);
    expect(stages[2]?.task_cost.total_cost_usd).toBe(0.605988);
    expect(contributionV4Fixtures.ciFixRepair.inference_log_id).toBeUndefined();
  });
});
