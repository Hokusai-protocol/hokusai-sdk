import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOKUSAI_BASE_URL,
  HokusaiApiError,
  HokusaiAuthError,
  HokusaiClient,
  HokusaiDispatchBuilder,
  HokusaiDispatchError,
  HokusaiNetworkError,
  HokusaiRateLimitError,
  HokusaiValidationError,
  createGatedClient,
  type ConsentRequiredError,
  type FetchTransport,
  type FetchTransportRequestInit,
} from './index.js';
import { InMemoryModelRegistry } from './model-registry.js';
import type { OutcomeReport, RouteRequest } from './schemas.js';
import { InMemoryCorrelationStorage } from './storage.js';

interface MockCall {
  init: FetchTransportRequestInit;
  input: string;
}

interface MockTransportResponse {
  headers: {
    get(name: string): string | null;
  };
  status: number;
  text(): Promise<string>;
}

function createHeaders(
  values: Record<string, string> = {},
): MockTransportResponse['headers'] {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    get(name: string): string | null {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

function createResponse(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): MockTransportResponse {
  return {
    status,
    headers: createHeaders(headers),
    text(): Promise<string> {
      if (body === undefined) {
        return Promise.resolve('');
      }

      return Promise.resolve(
        typeof body === 'string' ? body : JSON.stringify(body),
      );
    },
  };
}

type MockTransportEntry = Error | MockTransportResponse;

function createMockTransport(sequence: MockTransportEntry[]): {
  calls: MockCall[];
  transport: FetchTransport;
} {
  const calls: MockCall[] = [];
  let index = 0;

  return {
    calls,
    transport: (input, init) => {
      calls.push({ input, init });
      const result = sequence[index] ?? sequence[sequence.length - 1];
      index += 1;

      if (!result) {
        return Promise.reject(new Error('Mock transport sequence is empty.'));
      }

      if (result instanceof Error) {
        return Promise.reject(result);
      }

      return Promise.resolve(result);
    },
  };
}

function getRequestIdHeader(call: MockCall): string {
  const headers = call.init.headers;
  if (!headers) {
    return '';
  }

  const requestId = headers['X-Hokusai-Request-Id'];
  return typeof requestId === 'string' ? requestId : '';
}

function parseRequestBody(call: MockCall): unknown {
  return JSON.parse(String(call.init.body));
}

async function createRouteRequest(): Promise<RouteRequest> {
  const builder = new HokusaiDispatchBuilder({
    consent: {
      subjectId: 'user-123',
      grantedScopes: ['task-execution'],
    },
    modelRegistry: new InMemoryModelRegistry([
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt-5',
        capabilities: ['reasoning', 'tool-use'],
        default: true,
      },
    ]),
    storage: new InMemoryCorrelationStorage(),
    clock: () => new Date('2026-01-02T03:04:05.000Z'),
  });

  return builder.prepareDispatch(
    {
      id: 'task-1',
      prompt: 'Email alice@example.com before using sk-12345678',
      metadata: {
        repo: 'hokusai-sdk',
      },
    },
    'gpt-5-codex',
  );
}

function createOutcomeReport(): OutcomeReport {
  return {
    schemaVersion: '1',
    correlationId: 'corr-123',
    recommendedModel: 'gpt-5-codex',
    actualModel: 'gpt-5-codex',
    recommendationAccepted: true,
    completionStatus: 'succeeded',
    latencyBucket: 'medium',
    costBucket: 'low',
    tokenBucket: 'medium',
    notes: 'Completed successfully.',
  };
}

function readCorePackageVersion(): string {
  const packageJson = readFileSync(
    new URL('../package.json', import.meta.url),
    'utf8',
  );

  return (JSON.parse(packageJson) as { version: string }).version;
}

describe('HokusaiDispatchBuilder', () => {
  it('builds an offline dispatch payload with deterministic redactions', async () => {
    const builder = new HokusaiDispatchBuilder({
      consent: {
        subjectId: 'user-123',
        grantedScopes: ['task-execution'],
      },
      modelRegistry: new InMemoryModelRegistry([
        {
          id: 'gpt-5-codex',
          provider: 'openai',
          family: 'gpt-5',
          capabilities: ['reasoning', 'tool-use'],
          default: true,
        },
      ]),
      storage: new InMemoryCorrelationStorage(),
      clock: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    const payload = await builder.prepareDispatch(
      {
        id: 'task-1',
        prompt: 'Email alice@example.com before using sk-12345678',
        metadata: {
          repo: 'hokusai-sdk',
        },
      },
      'gpt-5-codex',
    );

    expect(payload.prompt).toContain('<redacted:email>');
    expect(payload.prompt).toContain('<redacted:token>');
    expect(payload.redactions).toHaveLength(2);
    expect(payload.correlation.correlationId).toBe(
      'task-1:2026-01-02T03:04:05.000Z',
    );
  });

  it('rejects dispatches for missing consent', async () => {
    const builder = new HokusaiDispatchBuilder({
      consent: {
        subjectId: 'user-123',
        grantedScopes: [],
      },
      modelRegistry: new InMemoryModelRegistry([
        {
          id: 'gpt-5-codex',
          provider: 'openai',
          family: 'gpt-5',
          capabilities: ['reasoning'],
        },
      ]),
    });

    await expect(
      builder.prepareDispatch(
        {
          id: 'task-2',
          prompt: 'No consent',
        },
        'gpt-5-codex',
      ),
    ).rejects.toBeInstanceOf(HokusaiDispatchError);
  });
});

describe('HokusaiClient', () => {
  it('sends the auth header and default SDK version on route requests', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-1',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const response = await client.route(routeRequest);

    expect(response).toMatchObject({
      routeId: 'route-1',
      taskId: routeRequest.task.id,
      status: 'accepted',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.headers?.Authorization).toBe('Bearer k_test');
    expect(calls[0]?.init.headers?.['X-Hokusai-Sdk-Version']).toBe(
      readCorePackageVersion(),
    );
  });

  it('sends onboarding signals to the signal endpoint', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(204, undefined, {
        'x-hokusai-request-id': 'signal-request-1',
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(
      client.signal({
        kind: 'onboarding_funnel',
        stage: 'first_route',
        installationId: 'install-1',
        installedAt: '2026-01-01T00:00:00.000Z',
        occurredAt: '2026-01-01T00:05:00.000Z',
        harness: 'codex',
        timeToFirstRouteMs: 300_000,
      }),
    ).resolves.toEqual({
      requestId: 'signal-request-1',
      status: 'recorded',
      taskId: '',
    });

    expect(calls[0]?.input).toBe('https://api.hokus.ai/v1/signals');
    expect(parseRequestBody(calls[0] as MockCall)).toMatchObject({
      kind: 'onboarding_funnel',
      stage: 'first_route',
      installationId: 'install-1',
      timeToFirstRouteMs: 300_000,
    });
  });

  it('sends route requests using the Technical Task Router prediction schema', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        metadata: {
          coder_model: 'gpt-5-codex',
          confidence: '0.82',
          reason: 'Best fit for a TypeScript SDK task.',
          route_id: 'prediction-1',
        },
        completed_successfully: 'true',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(client.route(routeRequest)).resolves.toEqual({
      routeId: 'prediction-1',
      taskId: routeRequest.task.id,
      status: 'accepted',
      requestId: expect.any(String),
      recommendation: {
        model: 'gpt-5-codex',
        confidence: 0.82,
        reason: 'Best fit for a TypeScript SDK task.',
      },
    });

    const body = parseRequestBody(calls[0] as MockCall) as {
      inputs: {
        task: Record<string, unknown>;
        routing: Record<string, unknown>;
        context: Record<string, unknown>;
        workflow: Record<string, unknown>;
        metadata: Record<string, unknown>;
      };
    };

    expect(body).toMatchObject({
      inputs: {
        task: {
          description: 'Email <redacted:email> before using <redacted:token>',
          task_type: 'maintenance',
        },
        routing: {
          available_coder_models: ['gpt-5-codex'],
          available_models: ['gpt-5-codex'],
          available_planner_models: ['gpt-5-codex'],
          available_reviewer_models: ['gpt-5-codex'],
        },
        context: {
          domain: 'hokusai-sdk',
          requires_tests: false,
        },
        workflow: {
          stages: ['plan', 'code', 'review'],
          surface: 'hokusai-sdk',
        },
        metadata: {
          external_task_id: routeRequest.task.id,
          integration_version: '0.1.4',
        },
      },
    });
  });

  it('normalizes live Model 30 strategy responses to route responses', async () => {
    const routeRequest = await createRouteRequest();
    const { transport } = createMockTransport([
      createResponse(200, {
        model_id: '30',
        predictions: {
          recommended_strategy: {
            objective: 'highest_reliability',
            planner_model: 'claude-sonnet-4-6',
            coder_model: 'gpt-5-codex',
            reviewer_model: 'claude-sonnet-4-6',
            confidence: 0.71,
            rationale: 'Best fit for the routed task.',
          },
        },
        metadata: {
          request_id: 'req-model-30',
          schema: 'technical_task_router_inputs/v2',
        },
        timestamp: '2026-07-07T22:29:48.000Z',
        inference_log_id: 'ilog-model-30',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(client.route(routeRequest)).resolves.toEqual({
      routeId: 'ilog-model-30',
      taskId: routeRequest.task.id,
      status: 'accepted',
      requestId: expect.any(String),
      recommendation: {
        model: 'gpt-5-codex',
        confidence: 0.71,
        reason: 'Best fit for the routed task.',
      },
    });
  });

  it('uses the default base URL when none is provided', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-1',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await client.route(routeRequest);

    expect(calls[0]?.input).toBe(
      `${DEFAULT_HOKUSAI_BASE_URL}/api/v1/models/30/predict`,
    );
  });

  it('uses a normalized custom base URL without double slashes', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-2',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      baseUrl: 'https://example.test/custom-root/',
      transport,
    });

    await client.route(routeRequest);

    expect(calls[0]?.input).toBe(
      'https://example.test/custom-root/api/v1/models/30/predict',
    );
  });

  it('supports overriding the SDK version header', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-3',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      sdkVersion: '9.9.9-test',
      transport,
    });

    await client.route(routeRequest);

    expect(calls[0]?.init.headers?.['X-Hokusai-Sdk-Version']).toBe(
      '9.9.9-test',
    );
  });

  it('uses deterministic request IDs and per-call overrides', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(
        403,
        { message: 'Forbidden.' },
        { 'x-hokusai-request-id': 'server-req-1' },
      ),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      requestIdFactory: () => 'generated-req-1',
      transport,
    });

    await expect(
      client.route(routeRequest, { requestId: 'caller-req-1' }),
    ).rejects.toMatchObject({
      requestId: 'server-req-1',
      status: 403,
    });

    expect(calls[0]?.init.headers?.['X-Hokusai-Request-Id']).toBe(
      'caller-req-1',
    );
  });

  it('returns a typed route response', async () => {
    const routeRequest = await createRouteRequest();
    const { transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-4',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(client.route(routeRequest)).resolves.toEqual({
      routeId: 'route-4',
      taskId: routeRequest.task.id,
      status: 'accepted',
      requestId: expect.any(String),
    });
  });

  it('returns a typed outcome response for JSON responses', async () => {
    const outcomeReport = createOutcomeReport();
    const { transport } = createMockTransport([
      createResponse(202, {
        taskId: outcomeReport.correlationId,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(client.reportOutcome(outcomeReport)).resolves.toEqual({
      taskId: outcomeReport.correlationId,
      status: 'accepted',
      requestId: expect.any(String),
    });
  });

  it('handles 204 outcome responses without parsing JSON', async () => {
    const outcomeReport = createOutcomeReport();
    const { transport } = createMockTransport([
      createResponse(204, undefined, {
        'x-hokusai-request-id': 'server-204',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(client.reportOutcome(outcomeReport)).resolves.toEqual({
      taskId: '',
      status: 'recorded',
      requestId: 'server-204',
    });
  });

  it('throws an auth error before any network call when the API key is missing', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-never',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({ transport });

    await expect(client.route(routeRequest)).rejects.toBeInstanceOf(
      HokusaiAuthError,
    );
    expect(calls).toHaveLength(0);
  });

  it('maps 401 and 403 responses to auth errors without leaking the API key', async () => {
    const routeRequest = await createRouteRequest();
    const { transport } = createMockTransport([
      createResponse(401, { message: 'Unauthorized.' }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test_secret',
      transport,
    });

    let thrown: unknown;
    try {
      await client.route(routeRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HokusaiAuthError);
    expect((thrown as Error).message).not.toContain('k_test_secret');
  });

  it('throws validation errors for invalid route requests without calling transport', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-never',
        taskId: 'task-1',
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(
      client.route({
        task: {
          id: '',
          prompt: '',
        },
        prompt: '',
        consent: {
          subjectId: '',
          grantedScopes: ['task-execution'],
        },
        model: {
          id: '',
          provider: '',
          capabilities: ['reasoning'],
        },
        correlation: {
          taskId: '',
          correlationId: '',
          createdAt: '',
        },
        redactions: [{ label: '' }],
        createdAt: '',
      }),
    ).rejects.toMatchObject({
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({ path: 'task.id' }),
        expect.objectContaining({ path: 'prompt' }),
      ]),
    });
    expect(calls).toHaveLength(0);
  });

  it('maps API validation responses to HokusaiValidationError and does not retry 422', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(422, {
        message: 'Validation failed.',
        fieldErrors: [{ path: 'task.id', message: 'Task id is required.' }],
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
      sleep: () => Promise.resolve(),
    });

    await expect(client.route(routeRequest)).rejects.toBeInstanceOf(
      HokusaiValidationError,
    );
    expect(calls).toHaveLength(1);
  });

  it('retries network failures and reuses the same request ID across attempts', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      new Error('socket hang up'),
      new Error('socket hang up'),
      createResponse(200, {
        routeId: 'route-5',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      requestIdFactory: () => 'req-retry-1',
      transport,
      sleep: () => Promise.resolve(),
    });

    await expect(client.route(routeRequest)).resolves.toMatchObject({
      routeId: 'route-5',
      taskId: routeRequest.task.id,
      status: 'accepted',
    });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => getRequestIdHeader(call)))).toEqual(
      new Set(['req-retry-1']),
    );
  });

  it('throws a network error after exhausting transport retries', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      new Error('offline'),
      new Error('offline'),
      new Error('offline'),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      maxRetries: 2,
      transport,
      sleep: () => Promise.resolve(),
    });

    await expect(client.route(routeRequest)).rejects.toBeInstanceOf(
      HokusaiNetworkError,
    );
    expect(calls).toHaveLength(3);
  });

  it('retries 503 responses and eventually succeeds', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(503, { message: 'Unavailable.' }),
      createResponse(200, {
        routeId: 'route-6',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
      sleep: async () => {},
    });

    await expect(client.route(routeRequest)).resolves.toMatchObject({
      routeId: 'route-6',
      taskId: routeRequest.task.id,
      status: 'accepted',
    });
    expect(calls).toHaveLength(2);
  });

  it('retries 429 responses, preserves retry-after, and fails with HokusaiRateLimitError when exhausted', async () => {
    const routeRequest = await createRouteRequest();
    const delays: number[] = [];
    const { calls, transport } = createMockTransport([
      createResponse(
        429,
        { message: 'Slow down.' },
        { 'retry-after': '1', 'x-hokusai-request-id': 'rate-limit-1' },
      ),
      createResponse(
        429,
        { message: 'Slow down again.' },
        { 'retry-after': '1', 'x-hokusai-request-id': 'rate-limit-2' },
      ),
      createResponse(
        429,
        { message: 'Still limited.' },
        { 'retry-after': '1', 'x-hokusai-request-id': 'rate-limit-3' },
      ),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      maxRetries: 2,
      transport,
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    });

    let thrown: unknown;
    try {
      await client.route(routeRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HokusaiRateLimitError);
    expect((thrown as HokusaiRateLimitError).retryAfter).toBe(1000);
    expect(delays).toEqual([1000, 1000]);
    expect(calls).toHaveLength(3);
  });

  it('supports dry-run validation without a network call or API key', async () => {
    const routeRequest = await createRouteRequest();
    const outcomeReport = createOutcomeReport();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-never',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);

    const client = new HokusaiClient({ transport });

    await expect(client.route(routeRequest, { dryRun: true })).resolves.toEqual(
      {
        ok: true,
        request: expect.objectContaining({
          inputs: expect.objectContaining({
            routing: expect.objectContaining({
              available_coder_models: ['gpt-5-codex'],
            }),
            task: expect.objectContaining({
              task_type: 'maintenance',
            }),
          }),
        }),
      },
    );
    await expect(
      client.reportOutcome(outcomeReport, { dryRun: true }),
    ).resolves.toEqual({
      ok: true,
      request: outcomeReport,
    });
    expect(calls).toHaveLength(0);
  });

  it('throws a validation error for invalid dry-run payloads', async () => {
    const client = new HokusaiClient({
      transport: () =>
        Promise.resolve(
          createResponse(200, {
            routeId: 'route-never',
            taskId: 'task-1',
            status: 'accepted',
          }),
        ),
    });

    await expect(
      client.reportOutcome(
        {
          schemaVersion: '1',
          correlationId: '',
          recommendedModel: '',
          actualModel: '',
          recommendationAccepted: true,
          completionStatus: 'succeeded',
          latencyBucket: 'medium',
          costBucket: 'low',
          tokenBucket: 'medium',
        },
        { dryRun: true, requestId: 'dry-run-invalid' },
      ),
    ).rejects.toMatchObject({
      requestId: 'dry-run-invalid',
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({ path: 'correlationId' }),
        expect.objectContaining({ path: 'recommendedModel' }),
      ]),
    });
  });

  it('throws a structured API error when success JSON is malformed', async () => {
    const routeRequest = await createRouteRequest();
    const { transport } = createMockTransport([
      createResponse(200, 'not-json'),
    ]);

    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    await expect(client.route(routeRequest)).rejects.toBeInstanceOf(
      HokusaiApiError,
    );
  });

  it('rejects invalid base URLs with a configuration error', () => {
    expect(
      () =>
        new HokusaiClient({
          apiKey: 'k_test',
          baseUrl: 'not-a-url',
        }),
    ).toThrow(HokusaiApiError);
  });
});

describe('createGatedClient', () => {
  it('blocks route calls before transport when auth or consent is missing', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-never',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);
    const client = createGatedClient({
      config: {
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport,
    });

    await expect(client.route(routeRequest)).rejects.toMatchObject({
      scope: 'routing',
      reason: 'no-auth',
    });
    expect(calls).toHaveLength(0);
  });

  it('blocks outcome calls before transport when the outcome opt-in is off', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(202, {
        taskId: 'corr-123',
        status: 'accepted',
      }),
    ]);
    const client = createGatedClient({
      config: {
        apiKey: 'hk_live',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport,
    });

    await expect(client.reportOutcome(createOutcomeReport())).rejects.toEqual(
      expect.objectContaining<Partial<ConsentRequiredError>>({
        scope: 'outcome',
        reason: 'no-consent',
      }),
    );
    expect(calls).toHaveLength(0);
  });

  it('passes through to the underlying client when gates are satisfied', async () => {
    const routeRequest = await createRouteRequest();
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-ok',
        taskId: routeRequest.task.id,
        status: 'accepted',
      }),
    ]);
    const client = createGatedClient({
      config: {
        apiKey: 'hk_live',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: true,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport,
    });

    await expect(client.route(routeRequest)).resolves.toMatchObject({
      routeId: 'route-ok',
      taskId: routeRequest.task.id,
      status: 'accepted',
    });
    expect(calls).toHaveLength(1);
  });
});
