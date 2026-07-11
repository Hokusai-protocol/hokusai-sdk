import { describe, expect, it } from 'vitest';
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

  it('reports an outcome tied to the most recent route', async () => {
    const calls: Captured[] = [];
    const route = createRouter({
      client: createMockClient({ onCall: (call) => calls.push(call) }),
    });

    const routed = await route({ task: 'Fix a bug.' });
    await route.reportOutcome({
      status: 'succeeded',
      latency: 'medium',
      cost: 'low',
      tokens: 'medium',
    });

    const outcomeCall = calls.find((call) =>
      new URL(call.input).pathname.endsWith('/outcomes'),
    );
    expect(outcomeCall).toBeDefined();
    const outcomeBody = JSON.parse(String(outcomeCall!.init.body)) as {
      correlationId: string;
      recommendedModel: string;
      completionStatus: string;
    };
    expect(outcomeBody.correlationId).toBe(routed.correlationId);
    expect(outcomeBody.recommendedModel).toBe('claude-sonnet-4-6');
    expect(outcomeBody.completionStatus).toBe('succeeded');
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
      route.reportOutcome({
        status: 'succeeded',
        latency: 'medium',
        cost: 'low',
        tokens: 'medium',
      }),
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
