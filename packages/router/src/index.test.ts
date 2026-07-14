import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HokusaiClient,
  HokusaiValidationError,
  type FetchTransport,
  type FetchTransportRequestInit,
} from '@hokusai/core';
import { createRouter, RouterError } from './index.js';

interface Captured {
  input: string;
  init: FetchTransportRequestInit;
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/**
 * A mock transport that answers the route and outcome endpoints. This is also
 * the offline quickstart: nothing here touches the network.
 */
function createMockClient(overrides?: {
  recommendation?: unknown;
  fidelityTiers?: string[];
  onCall?: (call: Captured) => void;
}): HokusaiClient {
  const transport: FetchTransport = (input, init) => {
    overrides?.onCall?.({ input, init });
    const pathname = new URL(input).pathname;
    if (pathname.endsWith('/predict')) {
      return Promise.resolve(
        jsonResponse(200, {
          routeId: 'route-1',
          taskId: 'task-1',
          status: 'accepted',
          recommendation: overrides?.recommendation ?? {
            model: 'claude-sonnet-4-6',
            reason: 'Best fit for this task.',
            confidence: 0.9,
            alternatives: [{ model: 'claude-opus-4-8', reason: 'Deeper.' }],
          },
        }),
      );
    }
    if (pathname.endsWith('/contributions')) {
      return Promise.resolve(
        jsonResponse(200, {
          accepted: true,
          submission_id: 'sub-1',
          rows_accepted: 1,
          row_fidelity_tiers: overrides?.fidelityTiers ?? ['training_eligible'],
        }),
      );
    }
    return Promise.resolve(
      jsonResponse(200, { taskId: 'task-1', status: 'recorded' }),
    );
  };

  return new HokusaiClient({ apiKey: 'k_test', transport });
}

describe('createRouter', () => {
  it('routes a bare task string and returns model + reasoning', async () => {
    const route = createRouter({ client: createMockClient() });

    const result = await route({
      task: 'Refactor the billing retry handling.',
    });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.reasoning).toBe('Best fit for this task.');
    expect(result.confidence).toBe(0.9);
    expect(result.alternatives).toEqual([
      { model: 'claude-opus-4-8', reason: 'Deeper.', confidence: undefined },
    ]);
    expect(result.correlationId).toBeTruthy();
    expect(result.routeId).toBe('route-1');
  });

  it('sends the full default candidate pool, not just one model', async () => {
    let routeBody:
      | { inputs: { routing: { available_models: string[] } } }
      | undefined;
    const route = createRouter({
      client: createMockClient({
        onCall: (call) => {
          if (new URL(call.input).pathname.endsWith('/predict')) {
            routeBody = JSON.parse(String(call.init.body));
          }
        },
      }),
    });

    await route({ task: 'Investigate a failing test.' });

    expect(routeBody?.inputs.routing.available_models).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
  });

  it('forwards a per-call objective as the wire enum', async () => {
    let routeBody: { inputs: { routing: { objective: string } } } | undefined;
    const route = createRouter({
      client: createMockClient({
        onCall: (call) => {
          if (new URL(call.input).pathname.endsWith('/predict')) {
            routeBody = JSON.parse(String(call.init.body));
          }
        },
      }),
    });

    await route({ task: 'Ship it fast.', objective: 'speed' });

    expect(routeBody?.inputs.routing.objective).toBe('fastest_completion');
  });

  /**
   * The legacy `/outcomes` endpoint patches an inference log and bypasses
   * training and reward attribution entirely (docs/reference-pattern.md). An
   * outcome must land as a Model 30 contribution row or it earns nothing.
   */
  it('submits a contribution row, not a legacy outcome', async () => {
    const calls: Captured[] = [];
    const route = createRouter({
      client: createMockClient({ onCall: (call) => calls.push(call) }),
    });

    const routed = await route({
      task: 'Fix a billing bug.',
      availableModels: ['claude-sonnet-4-6', 'claude-opus-4-8'],
      maxCostUsd: 1,
    });
    const result = await route.reportOutcome({
      status: 'succeeded',
      actualCostUsd: 0.42,
      wallClockSeconds: 74.5,
    });

    expect(
      calls.some((call) => new URL(call.input).pathname.endsWith('/outcomes')),
    ).toBe(false);

    const call = calls.find((entry) =>
      new URL(entry.input).pathname.endsWith('/contributions'),
    );
    expect(call).toBeDefined();

    const body = JSON.parse(String(call!.init.body)) as {
      rows: Array<Record<string, unknown>>;
    };
    const row = body.rows[0]!;
    expect(row.schema_version).toBe('harness_outcome_row/v1');
    // The row is only attributable to its decision through inference_log_id.
    expect(row.inference_log_id).toBe(routed.routeId);
    expect(row.completion_result).toBe('success');
    expect(row.allowed_models).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-8',
    ]);
    expect(row.selected_models).toEqual({
      coder: 'claude-sonnet-4-6',
      reviewer: 'claude-sonnet-4-6',
    });
    expect(row.budget_usd).toBe(1);
    expect(row.actual_cost_usd).toBe(0.42);

    expect(result.accepted).toBe(true);
    expect(result.fidelityTier).toBe('training_eligible');
    expect(result.correlationId).toBe(routed.correlationId);
  });

  it('maps a failed status onto a failure row', async () => {
    const calls: Captured[] = [];
    const route = createRouter({
      client: createMockClient({ onCall: (call) => calls.push(call) }),
    });

    await route({ task: 'Fix a bug.' });
    await route.reportOutcome({ status: 'failed', actualCostUsd: 0.1 });

    const call = calls.find((entry) =>
      new URL(entry.input).pathname.endsWith('/contributions'),
    );
    const body = JSON.parse(String(call!.init.body)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(body.rows[0]!.completion_result).toBe('failure');
  });

  /**
   * A row without an actual cost cannot be scored against its budget, so the
   * server files it as telemetry. Warn rather than let the caller discover it
   * in the fidelity tier.
   */
  it('warns that an outcome without actualCostUsd is not training-eligible', async () => {
    const warnings: string[] = [];
    const route = createRouter({
      client: createMockClient(),
      onWarning: (message) => warnings.push(message),
    });

    await route({ task: 'Fix a bug.' });
    await route.reportOutcome({ status: 'succeeded' });

    expect(
      warnings.some((message) => /not training-eligible/i.test(message)),
    ).toBe(true);
  });

  it('warns when the server classifies the row below training_eligible', async () => {
    const warnings: string[] = [];
    const route = createRouter({
      client: createMockClient({ fidelityTiers: ['partial'] }),
      onWarning: (message) => warnings.push(message),
    });

    await route({ task: 'Fix a bug.' });
    const result = await route.reportOutcome({
      status: 'succeeded',
      actualCostUsd: 0.42,
    });

    expect(result.fidelityTier).toBe('partial');
    expect(warnings.some((message) => /partial/.test(message))).toBe(true);
  });

  it('refuses to report an outcome against a stale correlation id', async () => {
    const route = createRouter({ client: createMockClient() });

    const first = await route({ task: 'First task.' });
    await route({ task: 'Second task.' });

    await expect(
      route.reportOutcome({
        correlationId: first.correlationId,
        status: 'succeeded',
        actualCostUsd: 0.1,
      }),
    ).rejects.toBeInstanceOf(RouterError);
  });

  it('does not hide a singleton candidate pool — it throws', async () => {
    const route = createRouter({
      client: createMockClient(),
      availableModels: ['only-one-model'],
    });

    await expect(
      route({ task: 'Route with one model.' }),
    ).rejects.toBeInstanceOf(HokusaiValidationError);
  });

  it('sends a singleton pool when the caller opts into non-ranking', async () => {
    const calls: Captured[] = [];
    const route = createRouter({
      client: createMockClient({ onCall: (call) => calls.push(call) }),
      availableModels: ['only-one-model'],
      onWarning: () => {},
    });

    await route({ task: 'Route with one model.', routingMode: 'non-ranking' });

    expect(
      calls.some((call) => new URL(call.input).pathname.endsWith('/predict')),
    ).toBe(true);
  });

  it('rejects reportOutcome before any route call', async () => {
    const route = createRouter({ client: createMockClient() });

    await expect(
      route.reportOutcome({ status: 'succeeded', actualCostUsd: 0.1 }),
    ).rejects.toBeInstanceOf(RouterError);
  });

  it('rejects an empty task', async () => {
    const route = createRouter({ client: createMockClient() });
    await expect(route({ task: '   ' })).rejects.toBeInstanceOf(RouterError);
  });

  it('merges context into task metadata forwarded to the router', async () => {
    let routeBody:
      | {
          inputs: {
            context?: Record<string, unknown>;
            task: Record<string, unknown>;
          };
        }
      | undefined;
    const route = createRouter({
      client: createMockClient({
        onCall: (call) => {
          if (new URL(call.input).pathname.endsWith('/predict')) {
            routeBody = JSON.parse(String(call.init.body));
          }
        },
      }),
    });

    await route({
      task: 'Handle payments work.',
      context: { domain: 'payments', repoType: 'monorepo' },
    });

    expect(routeBody?.inputs.context?.domain).toBe('payments');
  });
});

describe('route default export', () => {
  it('is callable and carries reportOutcome without construction', () => {
    // Import-time smoke: the zero-config singleton exists and is shaped right.
    // We don't invoke it here (that would hit the network / need a key).
    return import('./index.js').then(({ route }) => {
      expect(typeof route).toBe('function');
      expect(typeof route.reportOutcome).toBe('function');
    });
  });
});

interface CapturedAuth {
  authorization?: string | undefined;
}

describe('api key resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Capture the Authorization header the client actually puts on the wire. */
  function stubFetchCapturingAuth(captured: CapturedAuth): void {
    vi.stubGlobal('fetch', (input: string, init: FetchTransportRequestInit) => {
      const headers = init.headers ?? {};
      captured.authorization =
        headers['Authorization'] ?? headers['authorization'];
      return Promise.resolve(
        jsonResponse(200, {
          routeId: 'route-1',
          taskId: 'task-1',
          status: 'accepted',
          recommendation: { model: 'claude-sonnet-4-6', confidence: 0.9 },
        }),
      );
    });
  }

  it('reads HOKUSAI_API_KEY from the environment when no apiKey is given', async () => {
    vi.stubEnv('HOKUSAI_API_KEY', 'hk_live_from_env');
    const captured: CapturedAuth = {};
    stubFetchCapturingAuth(captured);

    const router = createRouter();
    await router({ task: 'Refactor billing webhook retry handling.' });

    expect(captured.authorization).toBe('Bearer hk_live_from_env');
  });

  it('prefers an explicit apiKey over the environment', async () => {
    vi.stubEnv('HOKUSAI_API_KEY', 'hk_live_from_env');
    const captured: CapturedAuth = {};
    stubFetchCapturingAuth(captured);

    const router = createRouter({ apiKey: 'hk_live_explicit' });
    await router({ task: 'Refactor billing webhook retry handling.' });

    expect(captured.authorization).toBe('Bearer hk_live_explicit');
  });

  it('ignores a blank HOKUSAI_API_KEY rather than sending an empty bearer', async () => {
    vi.stubEnv('HOKUSAI_API_KEY', '   ');
    stubFetchCapturingAuth({});

    const router = createRouter();

    await expect(
      router({ task: 'Refactor billing webhook retry handling.' }),
    ).rejects.toThrow(/API key is required/);
  });
});
