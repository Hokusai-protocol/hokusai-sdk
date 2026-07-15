import { describe, expect, it, vi } from 'vitest';
import type { ContributionRequest } from '../client.js';
import {
  isHarnessOutcomeRowV1,
  validateContributionRow,
} from '../contribution/index.js';
import type { ModelDefinition } from '../model-registry.js';
import type { RouteResponse } from '../schemas.js';
import type { HostAdapter } from './host-adapter.js';
import { runHokusaiLoop, type HokusaiLoopClient } from './run-loop.js';

const OBSERVED_AT = '2026-06-08T00:00:00.000Z';
const REDACTION_SALT = 'integration-kit-test-salt';
const TASK = {
  id: 'integration-kit-task-1',
  prompt: 'Fix the failing tests and remove SECRET_VALUE from logs.',
};

const MODELS: ModelDefinition[] = [
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    family: 'claude-haiku',
    capabilities: ['tool-use'],
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    family: 'claude-sonnet',
    capabilities: ['reasoning', 'tool-use'],
    default: true,
  },
];

function createAdapter(overrides: Partial<HostAdapter> = {}): {
  adapter: HostAdapter;
  executeWithModel: ReturnType<typeof vi.fn>;
} {
  const executeWithModel = vi.fn(() =>
    Promise.resolve({
      completionResult: 'success' as const,
      inputTokens: 18_400,
      outputTokens: 3_200,
      cacheCreationTokens: 12_000,
      cacheReadTokens: 96_000,
      wallClockSeconds: 42,
    }),
  );

  const adapter: HostAdapter = {
    collectTaskContext: () => Promise.resolve({ task: TASK }),
    discoverRunnableModels: () => Promise.resolve(MODELS),
    executeWithModel,
    previewRedactedPayload: (payload) =>
      Promise.resolve({
        promptPreview: payload.prompt,
        redactionCount: payload.redactions.length,
      }),
    ...overrides,
  };

  return { adapter, executeWithModel };
}

function createClient(overrides: Partial<HokusaiLoopClient> = {}): {
  client: HokusaiLoopClient;
  route: ReturnType<typeof vi.fn>;
  submitContribution: ReturnType<typeof vi.fn>;
} {
  const route = vi.fn(
    (): Promise<RouteResponse> =>
      Promise.resolve({
        routeId: 'route_abc123',
        taskId: TASK.id,
        status: 'accepted',
        recommendation: { model: 'claude-sonnet-4-6' },
      }),
  );
  const submitContribution = vi.fn(
    (): Promise<{
      accepted: true;
      rowsAccepted: 1;
      rowFidelityTiers: ['training_eligible'];
    }> =>
      Promise.resolve({
        accepted: true,
        rowsAccepted: 1,
        rowFidelityTiers: ['training_eligible'],
      }),
  );

  return {
    client: {
      route,
      submitContribution,
      ...overrides,
    },
    route,
    submitContribution,
  };
}

async function runLoop(
  adapter: HostAdapter,
  client: HokusaiLoopClient,
  overrides: Partial<Parameters<typeof runHokusaiLoop>[0]> = {},
) {
  return runHokusaiLoop({
    adapter,
    client,
    budgetUsd: 0.5,
    harnessName: 'integration-kit-test',
    sdkVersion: '0.1.0-test',
    observedAt: OBSERVED_AT,
    clock: () => new Date(OBSERVED_AT),
    redactionConfig: {
      salt: REDACTION_SALT,
      customRules: [{ category: 'secret', pattern: /SECRET_VALUE/g }],
    },
    idempotencyKey: 'integration-kit-test',
    ...overrides,
  });
}

describe('runHokusaiLoop', () => {
  it('builds a valid training-eligible harness_outcome_row/v1 from a minimal adapter', async () => {
    const { adapter } = createAdapter();
    let submittedRequest: ContributionRequest | undefined;
    const submitContribution = vi.fn((request: ContributionRequest) => {
      submittedRequest = request;
      return Promise.resolve({
        accepted: true,
        rowsAccepted: 1,
        rowFidelityTiers: ['training_eligible'],
      });
    });
    const { client } = createClient({
      submitContribution,
    });

    const result = await runLoop(adapter, client);

    expect(submitContribution).toHaveBeenCalledTimes(1);
    expect(result.selectedModel).toBe('claude-sonnet-4-6');
    expect(result.routeId).toBe('route_abc123');
    expect(result.inferenceLogId).toBe('route_abc123');
    expect(result.row.inference_log_id).toBe('route_abc123');
    expect(result.actualCostUsd).toBeCloseTo(0.177, 6);
    expect(result.row.actual_cost_usd).toBeCloseTo(0.177, 6);
    expect(result.row.budget_usd).toBe(0.5);
    expect(isHarnessOutcomeRowV1(result.row)).toBe(true);
    expect(() => validateContributionRow(result.row)).not.toThrow();
    expect(submittedRequest?.rows).toHaveLength(1);
  });

  it('threads the current route response id into inference_log_id by construction', async () => {
    const { adapter } = createAdapter();
    const routeIds = ['route_first', 'route_second'];
    const submittedIds: string[] = [];
    const { client } = createClient({
      route: vi.fn(() =>
        Promise.resolve({
          routeId: routeIds.shift() as string,
          taskId: TASK.id,
          status: 'accepted' as const,
          recommendation: { model: 'claude-sonnet-4-6' },
        }),
      ),
      submitContribution: vi.fn((request: ContributionRequest) => {
        submittedIds.push(request.rows[0]?.inference_log_id as string);
        return Promise.resolve({
          accepted: true,
          rowsAccepted: 1,
          rowFidelityTiers: ['training_eligible'],
        });
      }),
    });

    const first = await runLoop(adapter, client, { idempotencyKey: 'run-one' });
    const second = await runLoop(adapter, client, {
      idempotencyKey: 'run-two',
    });

    expect(first.row.inference_log_id).toBe('route_first');
    expect(second.row.inference_log_id).toBe('route_second');
    expect(submittedIds).toEqual(['route_first', 'route_second']);
  });

  it('fails before routing when the host exposes no runnable models', async () => {
    const { adapter } = createAdapter({
      discoverRunnableModels: () => Promise.resolve([]),
    });
    const { client, route, submitContribution } = createClient();

    await expect(runLoop(adapter, client)).rejects.toThrow(
      'Host adapter must return at least one runnable model.',
    );
    expect(route).not.toHaveBeenCalled();
    expect(submitContribution).not.toHaveBeenCalled();
  });

  it('propagates route failures without executing or submitting', async () => {
    const { adapter, executeWithModel } = createAdapter();
    const submitContribution = vi.fn();
    const client: HokusaiLoopClient = {
      route: () => Promise.reject(new Error('route failed')),
      submitContribution,
    };

    await expect(runLoop(adapter, client)).rejects.toThrow('route failed');
    expect(executeWithModel).not.toHaveBeenCalled();
    expect(submitContribution).not.toHaveBeenCalled();
  });

  it('propagates execution failures without submitting', async () => {
    const { adapter } = createAdapter({
      executeWithModel: () => Promise.reject(new Error('execution failed')),
    });
    const submitContribution = vi.fn();
    const { client } = createClient({
      submitContribution,
    });

    await expect(runLoop(adapter, client)).rejects.toThrow('execution failed');
    expect(submitContribution).not.toHaveBeenCalled();
  });

  it('propagates submit failures', async () => {
    const { adapter, executeWithModel } = createAdapter();
    const client: HokusaiLoopClient = {
      route: () =>
        Promise.resolve({
          routeId: 'route_submit_failure',
          taskId: TASK.id,
          status: 'accepted',
          recommendation: { model: 'claude-sonnet-4-6' },
        }),
      submitContribution: () => Promise.reject(new Error('submit failed')),
    };

    await expect(runLoop(adapter, client)).rejects.toThrow('submit failed');
    expect(executeWithModel).toHaveBeenCalledTimes(1);
  });

  it('can omit actual_cost_usd while still producing a valid harness_outcome_row/v1', async () => {
    const { adapter } = createAdapter();
    let submittedRow: ContributionRequest['rows'][number] | undefined;
    const { client } = createClient({
      submitContribution: vi.fn((request: ContributionRequest) => {
        submittedRow = request.rows[0];
        return Promise.resolve({
          accepted: true,
          rowsAccepted: 1,
          rowFidelityTiers: ['partial'],
        });
      }),
    });

    const result = await runLoop(adapter, client, { reportCost: false });

    expect(result.actualCostUsd).toBeUndefined();
    expect(result.row.actual_cost_usd).toBeUndefined();
    expect(submittedRow?.actual_cost_usd).toBeUndefined();
    expect(isHarnessOutcomeRowV1(result.row)).toBe(true);
    expect(() => validateContributionRow(result.row)).not.toThrow();
  });
});
