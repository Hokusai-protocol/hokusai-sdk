import { describe, expect, it } from 'vitest';
import { isHarnessOutcomeRowV1 } from '../contribution/schema.js';
import type { ModelDefinition } from '../model-registry.js';
import type {
  ContributionAcceptedResponse,
  ContributionRequest,
} from '../client.js';
import type { RouteRequest, RouteResponse } from '../schemas.js';
import {
  type HokusaiLoopClient,
  runHokusaiLoop,
} from './loop.js';
import type { HostAdapter } from './host-adapter.js';

const TEST_MODELS: ModelDefinition[] = [
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    family: 'claude-sonnet',
    capabilities: ['reasoning', 'tool-use'],
    default: true,
  },
];

function createAdapter(
  overrides: Partial<HostAdapter> = {},
): HostAdapter {
  return {
    collectTaskContext() {
      return Promise.resolve({
        task: {
          id: 'task-1',
          prompt: 'Do the thing carefully.',
        },
      });
    },
    discoverModels() {
      return TEST_MODELS;
    },
    executeTask() {
      return Promise.resolve({
        completionResult: 'success',
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheCreationTokens: 4_000,
        cacheReadTokens: 8_000,
        wallClockSeconds: 12,
      });
    },
    previewPayload(payload) {
      return {
        promptPreview: payload.prompt,
        redactionCount: payload.redactions.length,
      };
    },
    ...overrides,
  };
}

function classifyRow(request: ContributionRequest): ContributionAcceptedResponse {
  const row = request.rows[0]!;
  const tier =
    typeof row.budget_usd === 'number' && typeof row.actual_cost_usd === 'number'
      ? 'training_eligible'
      : 'partial';

  return {
    accepted: true,
    rowsAccepted: 1,
    submittedRows: request.rows.length,
    rowFidelityTiers: [tier],
    fidelitySummary: {
      training_eligible: tier === 'training_eligible' ? 1 : 0,
      partial: tier === 'partial' ? 1 : 0,
      passthrough: 0,
      invalid: 0,
    },
  };
}

function createClient(routeId = 'route-123'): HokusaiLoopClient {
  return {
    route(request: RouteRequest): Promise<RouteResponse> {
      return Promise.resolve({
        routeId,
        taskId: request.task.id,
        status: 'accepted',
        recommendation: {
          model: 'claude-sonnet-4-6',
          reason: 'best fit',
          confidence: 0.75,
        },
      });
    },
    submitContribution(request: ContributionRequest) {
      return Promise.resolve(classifyRow(request));
    },
  };
}

describe('runHokusaiLoop', () => {
  it('lets a minimal adapter produce a training-eligible harness row', async () => {
    const adapter = createAdapter();
    const result = await runHokusaiLoop({
      adapter,
      client: createClient(),
      models: adapter.discoverModels(),
      harness: 'test-harness',
      sdkVersion: '1.2.3',
      idempotencyKey: 'run-a',
      budgetUsd: 0.5,
    });

    expect(isHarnessOutcomeRowV1(result.row)).toBe(true);
    expect(result.row.actual_cost_usd).toBeTypeOf('number');
    expect(result.fidelityTier).toBe('training_eligible');
  });

  it('threads routeId into the row by construction', async () => {
    const clientRouteId = 'route-xyz';
    const adapter = createAdapter({
      collectTaskContext() {
        return Promise.resolve({
          task: {
            id: 'task-2',
            prompt: 'Do the thing carefully.',
            metadata: { inference_log_id: 'fake-host-value' },
          },
        });
      },
    });
    const result = await runHokusaiLoop({
      adapter,
      client: createClient(clientRouteId),
      models: adapter.discoverModels(),
      harness: 'test-harness',
      sdkVersion: '1.2.3',
      idempotencyKey: 'run-b',
      budgetUsd: 0.5,
    });

    expect(result.inferenceLogId).toBe(clientRouteId);
    expect(result.row.inference_log_id).toBe(clientRouteId);
  });

  it('omits cost when reportCost is false and yields a partial tier', async () => {
    const adapter = createAdapter();
    const result = await runHokusaiLoop({
      adapter,
      client: createClient(),
      models: adapter.discoverModels(),
      harness: 'test-harness',
      sdkVersion: '1.2.3',
      idempotencyKey: 'run-c',
      budgetUsd: 0.5,
      reportCost: false,
    });

    expect(result.row.actual_cost_usd).toBeUndefined();
    expect(result.fidelityTier).toBe('partial');
  });

  it('degrades to partial for an unknown-price model', async () => {
    const models: ModelDefinition[] = [
      {
        id: 'custom-model-1',
        provider: 'custom',
        family: 'custom',
        capabilities: ['tool-use'],
        default: true,
      },
    ];
    const adapter = createAdapter({
      discoverModels() {
        return models;
      },
    });
    const result = await runHokusaiLoop({
      adapter,
      client: {
        route(request: RouteRequest): Promise<RouteResponse> {
          return Promise.resolve({
            routeId: 'route-custom',
            taskId: request.task.id,
            status: 'accepted',
            recommendation: {
              model: 'custom-model-1',
            },
          });
        },
        submitContribution(request: ContributionRequest) {
          return Promise.resolve(classifyRow(request));
        },
      },
      models,
      harness: 'test-harness',
      sdkVersion: '1.2.3',
      idempotencyKey: 'run-d',
      budgetUsd: 0.5,
    });

    expect(result.actualCostUsd).toBeUndefined();
    expect(result.row.actual_cost_usd).toBeUndefined();
    expect(result.fidelityTier).toBe('partial');
  });

  it('applies defaults for consent, clock, and redaction config', async () => {
    const adapter = createAdapter();
    const result = await runHokusaiLoop({
      adapter,
      client: createClient(),
      models: adapter.discoverModels(),
      harness: 'default-harness',
      sdkVersion: '1.2.3',
      idempotencyKey: 'run-e',
      budgetUsd: 0.5,
    });

    expect(result.row.harness).toBe('default-harness');
    expect(result.row.observed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(isHarnessOutcomeRowV1(result.row)).toBe(true);
  });

  it('falls back to task_type unknown for an empty descriptor', async () => {
    const adapter = createAdapter({
      collectTaskContext() {
        return Promise.resolve({
          task: {
            id: 'task-3',
            prompt: '',
          },
        });
      },
    });
    const result = await runHokusaiLoop({
      adapter,
      client: createClient(),
      models: adapter.discoverModels(),
      harness: 'test-harness',
      sdkVersion: '1.2.3',
      idempotencyKey: 'run-f',
      budgetUsd: 0.5,
    });

    expect(result.taskDescriptor).toEqual({ task_type: 'unknown' });
    expect(result.row.task_descriptor).toEqual({ task_type: 'unknown' });
  });
});
