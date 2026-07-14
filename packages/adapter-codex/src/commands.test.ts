import { describe, expect, it, vi } from 'vitest';
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  HokusaiValidationError,
  InMemoryLocalStore,
  InMemoryModelRegistry,
  type ConsentConfig,
  type FetchTransport,
  type ModelDefinition,
} from '@hokusai/core';
import {
  previewRoutePayload,
  requestRecommendation,
  submitOutcome,
} from './commands.js';

const consent: ConsentConfig = {
  subjectId: 'user-123',
  grantedScopes: ['task-execution', 'telemetry'],
};

const task = {
  id: 'task-1',
  prompt: 'Email ops@example.com about the release.',
};

const models: ModelDefinition[] = [
  {
    id: 'gpt-5-codex',
    provider: 'openai',
    family: 'gpt',
    capabilities: ['reasoning', 'tool-use'],
    default: true,
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    family: 'gpt',
    capabilities: ['reasoning', 'tool-use'],
  },
];

function createDispatchBuilder() {
  return new HokusaiDispatchBuilder({
    consent,
    redactionConfig: {
      salt: 'command-test-salt',
      email: true,
    },
    modelRegistry: new InMemoryModelRegistry(models),
    clock: () => new Date('2026-06-08T00:00:00.000Z'),
  });
}

function createRouteClient(transport: FetchTransport) {
  return new HokusaiClient({
    apiKey: 'test-key',
    transport,
    requestIdFactory: () => 'req-1',
  });
}

describe('requestRecommendation', () => {
  it('returns the route response and sends the prepared payload', async () => {
    let seenBody = '';
    const transportBodyRecorder = createRouteClient((_input, init) => {
      seenBody = init.body ?? '';
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              routeId: 'route-1',
              taskId: 'task-1',
              status: 'accepted',
            }),
          ),
      });
    });

    const result = await requestRecommendation({
      client: transportBodyRecorder,
      dispatchBuilder: createDispatchBuilder(),
      task,
      modelId: 'gpt-5-codex',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        requestId: 'req-1',
        routeId: 'route-1',
        taskId: 'task-1',
        status: 'accepted',
      },
    });
    const body = JSON.parse(seenBody) as { inputs: Record<string, unknown> };
    expect(body).toMatchObject({
      inputs: {
        routing: {
          available_models: ['gpt-5-codex', 'gpt-5'],
        },
        task: {
          task_type: 'maintenance',
        },
      },
    });
  });

  it('surfaces validation failures as structured adapter errors', async () => {
    const client = {
      route: vi.fn(() => {
        throw new HokusaiValidationError('Route request validation failed.', {
          requestId: 'req-1',
          fieldErrors: [{ path: 'task.prompt', message: 'Expected a string.' }],
        });
      }),
    } as unknown as HokusaiClient;

    const result = await requestRecommendation({
      client,
      dispatchBuilder: createDispatchBuilder(),
      task,
      modelId: 'gpt-5-codex',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('HokusaiValidationError');
    expect(result.error.details?.fieldErrors).toEqual([
      'task.prompt: Expected a string.',
    ]);
  });
});

describe('previewRoutePayload', () => {
  it('prepares the payload without calling transport', async () => {
    const transport = vi.fn();
    createRouteClient(transport);

    const result = await previewRoutePayload({
      dispatchBuilder: createDispatchBuilder(),
      task,
      modelId: 'gpt-5-codex',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.task.id).toBe('task-1');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('submitOutcome', () => {
  it('blocks submission when telemetry consent is missing', async () => {
    const reportOutcome = vi.fn();
    const client = {
      reportOutcome,
    } as unknown as HokusaiClient;
    const store = new InMemoryLocalStore();

    const result = await submitOutcome({
      client,
      consent: {
        subjectId: 'user-123',
        grantedScopes: ['task-execution'],
      },
      outcome: {
        correlationId: 'corr-1',
        recommendedModel: 'gpt-5-codex',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
      },
      store,
      auditId: 'audit-1',
      clock: () => new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'consent_required',
        message: 'Consent has not been granted for scope "telemetry".',
      },
    });
    expect(reportOutcome).not.toHaveBeenCalled();
    await expect(store.listAudit()).resolves.toEqual([
      {
        id: 'audit-1',
        kind: 'outcome',
        correlationId: 'corr-1',
        status: 'skipped',
        timestamp: new Date('2026-06-08T00:00:00.000Z').getTime(),
        error: 'Consent has not been granted for scope "telemetry".',
      },
    ]);
  });

  /**
   * A route must be persisted first: the contribution row is attributed to its
   * decision through inference_log_id, and is scored on the models and
   * descriptor the route actually used.
   */
  async function seedRoute(store: InMemoryLocalStore, correlationId: string) {
    await store.putCorrelation({
      correlationId: correlationId.replace(/[:.]/g, '_'),
      packetHash: 'task-1',
      createdAt: Date.parse('2026-06-08T00:00:00.000Z'),
      metadata: {
        taskId: 'task-1',
        originalCorrelationId: correlationId,
        inferenceLogId: 'inference-1',
        routeContext: JSON.stringify({
          taskDescriptor: { task_type: 'refactor', complexity: 2 },
          allowedModels: ['gpt-5-codex', 'gpt-5'],
          budgetUsd: 1,
        }),
      },
    });
  }

  it('submits a contribution row, not a legacy outcome', async () => {
    const submitContribution = vi.fn(
      (request: { rows: Array<Record<string, unknown>> }) => {
        void request;
        return Promise.resolve({
          accepted: true,
          rowFidelityTiers: ['training_eligible'],
        });
      },
    );
    const reportOutcome = vi.fn();
    const client = {
      submitContribution,
      reportOutcome,
    } as unknown as HokusaiClient;
    const store = new InMemoryLocalStore();
    await seedRoute(store, 'corr-1');

    const result = await submitOutcome({
      client,
      consent,
      outcome: {
        correlationId: 'corr-1',
        recommendedModel: 'gpt-5-codex',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
      },
      actualCostUsd: 0.42,
      wallClockSeconds: 74.5,
      store,
      auditId: 'audit-2',
      clock: () => new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    // The legacy endpoint 404s and earns nothing; it must not be called.
    expect(reportOutcome).not.toHaveBeenCalled();
    expect(submitContribution).toHaveBeenCalledTimes(1);

    const request = submitContribution.mock.calls[0]![0];
    const row = request.rows[0]!;
    expect(row.schema_version).toBe('harness_outcome_row/v1');
    expect(row.inference_log_id).toBe('inference-1');
    expect(row.completion_result).toBe('success');
    expect(row.allowed_models).toEqual(['gpt-5-codex', 'gpt-5']);
    expect(row.selected_models).toEqual({
      coder: 'gpt-5-codex',
      reviewer: 'gpt-5-codex',
    });
    expect(row.budget_usd).toBe(1);
    expect(row.actual_cost_usd).toBe(0.42);
    expect(row.harness).toBe('codex');

    await expect(store.listAudit()).resolves.toEqual([
      {
        id: 'audit-2',
        kind: 'outcome',
        correlationId: 'corr-1',
        status: 'submitted',
        timestamp: new Date('2026-06-08T00:00:00.000Z').getTime(),
      },
    ]);
  });

  it('refuses to submit an outcome it cannot attribute to a route', async () => {
    const submitContribution = vi.fn();
    const client = { submitContribution } as unknown as HokusaiClient;
    const store = new InMemoryLocalStore();

    const result = await submitOutcome({
      client,
      consent,
      outcome: {
        correlationId: 'corr-orphan',
        recommendedModel: 'gpt-5-codex',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
      },
      store,
      auditId: 'audit-orphan',
      clock: () => new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    // Sending a row the server cannot score is worse than failing loudly.
    expect(submitContribution).not.toHaveBeenCalled();
  });

  it('records a failed audit entry on transport error', async () => {
    const client = {
      submitContribution: vi.fn(() => {
        throw new Error('network down');
      }),
    } as unknown as HokusaiClient;
    const store = new InMemoryLocalStore();
    await seedRoute(store, 'corr-2');

    const result = await submitOutcome({
      client,
      consent,
      outcome: {
        correlationId: 'corr-2',
        recommendedModel: 'gpt-5-codex',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
      },
      store,
      auditId: 'audit-3',
      clock: () => new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'Error',
        message: 'network down',
      },
    });
    await expect(store.listAudit()).resolves.toEqual([
      {
        id: 'audit-3',
        kind: 'outcome',
        correlationId: 'corr-2',
        status: 'failed',
        timestamp: new Date('2026-06-08T00:00:00.000Z').getTime(),
        error: 'network down',
      },
    ]);
  });
});
