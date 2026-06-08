import { describe, expect, it } from 'vitest';
import {
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
} from '@hokusai/core';
import { FAKE_OUTCOME, FAKE_TASK_CONTEXT } from './fake-data.js';
import {
  createMockHokusaiClient,
  type MockHokusaiClient,
} from './mock-client.js';
import { createReferenceHarnessAdapter, REFERENCE_MODEL, runReferenceFlow } from './index.js';

describe('createReferenceHarnessAdapter', () => {
  it('returns fake task, fake outcome, and preview metadata', async () => {
    const adapter = createReferenceHarnessAdapter();
    const contextResult = await adapter.context.collectTaskContext({});
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) {
      return;
    }

    expect(contextResult.value.task).toEqual(FAKE_TASK_CONTEXT.task);

    const outcomeResult = await adapter.outcomes.collectOutcome({
      task: FAKE_TASK_CONTEXT.task,
      model: {
        id: REFERENCE_MODEL.id,
        provider: REFERENCE_MODEL.provider,
        capabilities: [...REFERENCE_MODEL.capabilities],
      },
    });
    expect(outcomeResult.ok).toBe(true);
    if (!outcomeResult.ok) {
      return;
    }

    expect(outcomeResult.value.status).toBe(FAKE_OUTCOME.status);

    const builder = new HokusaiDispatchBuilder({
      consent: {
        subjectId: FAKE_TASK_CONTEXT.task.id,
        grantedScopes: ['task-execution'],
      },
      modelRegistry: new InMemoryModelRegistry([REFERENCE_MODEL]),
      clock: () => new Date('2026-06-08T00:00:00.000Z'),
    });
    const payload = await builder.prepareDispatch(
      FAKE_TASK_CONTEXT.task,
      REFERENCE_MODEL.id,
    );
    const previewResult = await adapter.payloads.previewPayload({ payload });
    expect(previewResult.ok).toBe(true);
    if (!previewResult.ok) {
      return;
    }

    expect(previewResult.value.redactionCount).toBeGreaterThanOrEqual(0);
  });
});

describe('runReferenceFlow', () => {
  it('runs the full mocked route/report flow with anonymized previews', async () => {
    const summary = await runReferenceFlow();

    expect(summary.correlationId).toBe('mock-decision-0001');
    expect(summary.routeStatus).toBe('accepted');
    expect(summary.reportStatus).toBe('recorded');
    expect(summary.packetPrompt).not.toContain('fake-secret-DO-NOT-USE');
    expect(summary.reportNotes).not.toContain('fake-secret-DO-NOT-USE');
    expect(summary.storedDecisionId).toBe(summary.submittedCorrelationId);
  });
});

describe('createMockHokusaiClient', () => {
  it('returns deterministic route and report acknowledgements', async () => {
    const client: MockHokusaiClient = createMockHokusaiClient();

    const route = await client.route({
      task: FAKE_TASK_CONTEXT.task,
      prompt: 'redacted prompt',
      consent: {
        subjectId: FAKE_TASK_CONTEXT.task.id,
        grantedScopes: ['task-execution'],
      },
      model: {
        id: REFERENCE_MODEL.id,
        provider: REFERENCE_MODEL.provider,
        capabilities: [...REFERENCE_MODEL.capabilities],
      },
      correlation: {
        taskId: FAKE_TASK_CONTEXT.task.id,
        correlationId: 'corr-1',
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      redactions: [],
      createdAt: '2026-06-08T00:00:00.000Z',
    });

    const report = await client.reportOutcome({
      correlationId: route.routeId,
      recommendedModel: REFERENCE_MODEL.id,
      actualModel: REFERENCE_MODEL.id,
      recommendationAccepted: true,
      completionStatus: 'succeeded',
      latencyBucket: 'low',
      costBucket: 'low',
      tokenBucket: 'low',
      schemaVersion: '1',
    });

    expect(route.routeId).toBe('mock-decision-0001');
    expect(report.status).toBe('recorded');
  });
});
