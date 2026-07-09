import { describe, expect, it } from 'vitest';
import { ContributionValidationError, isHarnessOutcomeRowV1 } from '@hokusai/core';
import { FAKE_SECRET, createReferenceHarnessAdapter } from './harness/index.js';
import { runHokusaiLoop } from './hokusai/index.js';
import { MOCK_INFERENCE_LOG_ID, createMockHokusaiClient } from './mock-client.js';
import { runReferenceFlow } from './index.js';

describe('runReferenceFlow', () => {
  it('submits one training_eligible row and one partial row', async () => {
    const { trainingEligible, partial } = await runReferenceFlow();

    expect(trainingEligible.fidelityTier).toBe('training_eligible');
    expect(partial.fidelityTier).toBe('partial');

    // Both are accepted. The tier is the only thing that separates a row that
    // trains the router from a row that is merely stored.
    expect(trainingEligible.response.accepted).toBe(true);
    expect(partial.response.accepted).toBe(true);
    expect(trainingEligible.response.rowsAccepted).toBe(1);
    expect(partial.response.rowsAccepted).toBe(1);
  });

  it('lands partial precisely because actual_cost_usd is absent', async () => {
    const { trainingEligible, partial } = await runReferenceFlow();

    expect(trainingEligible.row.actual_cost_usd).toBeTypeOf('number');
    expect(partial.row.actual_cost_usd).toBeUndefined();

    // Everything else about the two rows is identical.
    expect(partial.row.budget_usd).toBe(trainingEligible.row.budget_usd);
    expect(partial.row.task_descriptor).toEqual(trainingEligible.row.task_descriptor);
    expect(partial.row.allowed_models).toEqual(trainingEligible.row.allowed_models);
  });

  it('threads inference_log_id from the route response into the row', async () => {
    const { trainingEligible } = await runReferenceFlow();

    expect(trainingEligible.inferenceLogId).toBe(MOCK_INFERENCE_LOG_ID);
    expect(trainingEligible.row.inference_log_id).toBe(MOCK_INFERENCE_LOG_ID);
  });

  it('redacts the fake secret before anything is dispatched', async () => {
    const { trainingEligible } = await runReferenceFlow();

    expect(trainingEligible.promptPreview).not.toContain(FAKE_SECRET);
    expect(trainingEligible.redactionCount).toBeGreaterThan(0);
    expect(JSON.stringify(trainingEligible.row)).not.toContain(FAKE_SECRET);
  });

  it('derives a categorical descriptor and never carries raw task text', async () => {
    const { trainingEligible } = await runReferenceFlow();
    const descriptor = trainingEligible.row.task_descriptor;

    expect(descriptor).toMatchObject({
      task_type: 'tests',
      complexity: 'standard',
      repo_size_bucket: 'medium',
    });
    expect(JSON.stringify(descriptor)).not.toContain('checkout');
  });

  it('prices the run from token usage', async () => {
    const { trainingEligible } = await runReferenceFlow();

    // 18.4k input @ $3/M + 12k cache-write @ 1.25x + 96k cache-read @ 0.1x
    // + 3.2k output @ $15/M
    expect(trainingEligible.actualCostUsd).toBeCloseTo(0.177, 6);
    expect(trainingEligible.row.actual_cost_usd).toBeLessThan(
      trainingEligible.row.budget_usd as number,
    );
  });

  it('emits a row the core validator accepts as harness_outcome_row/v1', async () => {
    const { trainingEligible } = await runReferenceFlow();

    expect(isHarnessOutcomeRowV1(trainingEligible.row)).toBe(true);
  });
});

describe('mock client validation', () => {
  it('rejects a row that leaks prompt text, offline', async () => {
    const client = createMockHokusaiClient();
    const adapter = createReferenceHarnessAdapter();

    const leaked = await runHokusaiLoop({
      adapter,
      client,
      models: adapter.discoverModels(),
      budgetUsd: 0.5,
      redactionSalt: 'salt',
      redactionSecret: FAKE_SECRET,
      idempotencyKey: 'leak-test',
    });

    // Simulate a fork that stuffs raw task text into the descriptor.
    const poisoned = {
      ...leaked.row,
      task_descriptor: { ...leaked.row.task_descriptor, prompt: 'raw user text' },
    };

    await expect(
      client.submitContribution({
        rows: [poisoned as typeof leaked.row],
        metadata: { idempotency_key: 'leak-test-2' },
      }),
    ).rejects.toThrow(ContributionValidationError);
  });

  it('classifies a row with no model selection as invalid', async () => {
    const client = createMockHokusaiClient();
    const adapter = createReferenceHarnessAdapter();
    const loop = await runHokusaiLoop({
      adapter,
      client,
      models: adapter.discoverModels(),
      budgetUsd: 0.5,
      redactionSalt: 'salt',
      redactionSecret: FAKE_SECRET,
      idempotencyKey: 'invalid-test',
    });

    const response = await client.submitContribution({
      rows: [{ ...loop.row, allowed_models: [] }],
      metadata: { idempotency_key: 'invalid-test-2' },
    });

    expect(response.rowFidelityTiers).toEqual([]);
    expect(response.rejectedRows).toHaveLength(1);
    expect(response.accepted).toBe(false);
  });
});

describe('createReferenceHarnessAdapter', () => {
  it('reports models that pricing.ts can actually price', async () => {
    const adapter = createReferenceHarnessAdapter();
    const models = adapter.discoverModels();

    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.provider).toBe('anthropic');
    }

    const context = await adapter.collectTaskContext();
    expect(context.task.id).toBe('ref-task-001');
  });

  it('lets a fork override the execution result to change the tier', async () => {
    const adapter = createReferenceHarnessAdapter({
      execution: { completionResult: 'failure' },
    });
    const result = await adapter.executeTask({
      task: (await adapter.collectTaskContext()).task,
      model: { id: 'claude-sonnet-4-6', provider: 'anthropic' },
    });

    expect(result.completionResult).toBe('failure');
  });
});
