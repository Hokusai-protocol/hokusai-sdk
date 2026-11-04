/**
 * HOK-3412 parity: each stage's `task_cost` in a v4 contribution row equals
 * the `@hokusai/costs` report for that stage's sessions. Every golden v4 row
 * (`contributionV4Fixtures`) is rebuilt end-to-end: replay each stage's
 * HOK-3072 source events through `measureTask`, hand the reports to
 * `buildTechnicalTaskRouterRowV4`, and require the golden row back exactly.
 */

import {
  buildTechnicalTaskRouterRowV4,
  contributionV4Fixtures,
  contributionV4StageSources,
  type ContributionV4FixtureName,
  type TechnicalTaskRouterContributionRowV4,
} from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { measureTask } from './measure/index.js';
import type { TaskCostReport } from './measure/types.js';

const entries = Object.entries(contributionV4Fixtures) as [
  ContributionV4FixtureName,
  TechnicalTaskRouterContributionRowV4,
][];

async function stageReports(name: ContributionV4FixtureName, taskId: string): Promise<TaskCostReport[]> {
  const reports: TaskCostReport[] = [];
  for (const source of contributionV4StageSources[name]) {
    const { cost } = await measureTask({ taskId, events: source.events }, () => undefined);
    reports.push(cost);
  }
  return reports;
}

describe('HOK-3412: v4 stage task_cost parity with @hokusai/costs', () => {
  describe.each(entries)('%s', (name, golden) => {
    const taskId = golden.task_id ?? '';

    it('each stage report has exactly one summary, equal to the stage task_cost', async () => {
      const reports = await stageReports(name, taskId);
      expect(reports).toHaveLength(golden.stage_executions.length);
      golden.stage_executions.forEach((stage, index) => {
        const report = reports[index] as TaskCostReport;
        expect(report.summaries).toHaveLength(1);
        expect(stage.task_cost.usage).toEqual(report.summaries[0]?.usage);
        expect(stage.task_cost).toEqual(report.summaries[0]);
        // The camelCase report view agrees with the wire usage it carries.
        expect(report.usage).toEqual({
          inputTokens: stage.task_cost.usage.input_tokens,
          outputTokens: stage.task_cost.usage.output_tokens,
          cacheReadTokens: stage.task_cost.usage.cache_read_tokens,
          cacheWriteTokens: stage.task_cost.usage.cache_write_tokens,
          reasoningTokens: stage.task_cost.usage.reasoning_tokens,
        });
      });
    });

    it('rebuilds the golden row from measureTask reports', async () => {
      const reports = await stageReports(name, taskId);
      const row = buildTechnicalTaskRouterRowV4({
        taskId,
        observedAt: golden.observed_at,
        observedSuccess: golden.completion_result === 'success',
        budgetCompliant: golden.success_under_budget,
        taskDescriptor: golden.task_descriptor,
        allowedModels: golden.allowed_models,
        availableModels: golden.available_models,
        selectedModels: golden.selected_models,
        candidatePool: golden.candidate_pool,
        sparseCell: golden.sparse_cell,
        ...(golden.budget_usd !== undefined ? { budgetUsd: golden.budget_usd } : {}),
        ...(golden.wall_clock_seconds !== undefined ? { wallClockSeconds: golden.wall_clock_seconds } : {}),
        ...(golden.harness ? { harness: golden.harness } : {}),
        ...(golden.inference_log_id
          ? { inferenceLogId: golden.inference_log_id, routeOverrides: golden.overrides ?? [] }
          : {}),
        ...(golden.comparison_group
          ? { comparisonGroup: { id: golden.comparison_group.id, roleVaried: golden.comparison_group.role_varied } }
          : {}),
        stageExecutions: golden.stage_executions.map((stage, index) => ({
          stage: stage.stage,
          executedModel: stage.executed_model,
          modelEvidence: stage.model_evidence,
          harness: stage.harness,
          cost: reports[index] as TaskCostReport,
        })),
      });
      expect(row).toEqual(golden);
    });
  });

  it('an unmeasured stage (empty report) still yields a task_cost', async () => {
    const golden = contributionV4Fixtures.singleHarness;
    const { cost } = await measureTask({ taskId: 'task-0001' }, () => undefined);
    expect(cost.summaries).toEqual([]);
    const row = buildTechnicalTaskRouterRowV4({
      taskId: 'task-0001',
      observedAt: golden.observed_at,
      observedSuccess: true,
      budgetCompliant: true,
      taskDescriptor: golden.task_descriptor,
      allowedModels: golden.allowed_models,
      selectedModels: { coder: 'claude-sonnet-5', reviewer: 'claude-sonnet-5' },
      stageExecutions: [
        { stage: 'coding', executedModel: 'claude-sonnet-5', modelEvidence: 'requested_only', harness: 'codex', cost },
      ],
    });
    expect(row.stage_executions[0]?.task_cost).toMatchObject({
      task_id: 'task-0001',
      harness: 'codex',
      coverage: 'unavailable',
      event_count: 0,
    });
  });
});
