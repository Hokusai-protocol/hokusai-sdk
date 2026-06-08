import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  HokusaiClient,
  HokusaiClientError,
  HokusaiError,
  HokusaiAuthError,
  HokusaiValidationError,
  HokusaiNetworkError,
  HokusaiApiError,
  SDK_VERSION,
  type FetchLike,
} from './client.js';
import { InMemoryModelRegistry } from './model-registry.js';
import { InMemoryCorrelationStorage } from './storage.js';
import type { RouteResponse, OutcomeResponse } from './schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper: build a mock Response
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const json = JSON.stringify(body);
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(json, { status, headers: responseHeaders });
}

function mockEmptyResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers: new Headers(headers) });
}

// Helper: mock transport that always returns a fixed response
function mockTransport(response: Response | (() => Response)): FetchLike {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(typeof response === 'function' ? response() : response),
  );
}

// Helper: mock transport that throws a network error
function failingTransport(error: Error): FetchLike {
  return vi.fn().mockRejectedValue(error);
}

const validRouteResponse: RouteResponse = {
  taskId: 'task-1',
  routingId: 'route-abc',
  selectedModel: 'gpt-5-codex',
};

const validOutcomeResponse: OutcomeResponse = {
  taskId: 'task-1',
  routingId: 'route-abc',
  acknowledged: true,
};

// --- Existing offline behavior ---

describe('HokusaiClient - existing offline behavior', () => {
  it('builds an offline dispatch payload with deterministic redactions', async () => {
    const client = new HokusaiClient({
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

    const payload = await client.prepareDispatch(
      {
        id: 'task-1',
        prompt: 'Email alice@example.com before using sk-12345678',
        metadata: { repo: 'hokusai-sdk' },
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
    const client = new HokusaiClient({
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
      client.prepareDispatch({ id: 'task-2', prompt: 'No consent' }, 'gpt-5-codex'),
    ).rejects.toBeInstanceOf(HokusaiClientError);
  });

  it('throws HokusaiClientError when consent is not provided to prepareDispatch', async () => {
    const client = new HokusaiClient({
      apiKey: 'sk-test',
    });

    await expect(
      client.prepareDispatch(
        { id: 'task-3', prompt: 'test' },
        'gpt-5-codex',
      ),
    ).rejects.toBeInstanceOf(HokusaiClientError);
  });
});

// --- Auth headers and SDK headers ---

describe('HokusaiClient - auth and SDK headers', () => {
  it('sends Authorization, X-Request-Id, and X-Hokusai-SDK-Version headers for route()', async () => {
    const transport = mockTransport(mockResponse(validRouteResponse));
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 0,
    });

    await client.route({ taskId: 'task-1', prompt: 'test prompt' });

    const call = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = call[1].headers as Record<string, string>;

    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['X-Request-Id']).toBeTruthy();
    expect(headers['X-Hokusai-SDK-Version']).toBe(SDK_VERSION);
  });

  it('two route() calls generate distinct request ids', async () => {
    const ids: string[] = [];
    const transport: FetchLike = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) => {
        const h = init?.headers as Record<string, string> | undefined;
        if (h?.['X-Request-Id']) ids.push(h['X-Request-Id']);
        return Promise.resolve(mockResponse(validRouteResponse));
      },
    );

    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });
    await client.route({ taskId: 'task-1', prompt: 'first' });
    await client.route({ taskId: 'task-2', prompt: 'second' });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('SDK_VERSION matches packages/core/package.json version', () => {
    const pkgJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
    ) as { version: string };
    expect(SDK_VERSION).toBe(pkgJson.version);
  });
});

// --- Base URL override ---

describe('HokusaiClient - base URL', () => {
  it('uses custom base URL for requests', async () => {
    const transport = mockTransport(mockResponse(validRouteResponse));
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      baseUrl: 'https://custom.example.com',
      transport,
      maxRetries: 0,
    });

    await client.route({ taskId: 'task-1', prompt: 'test' });

    const call = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).toMatch(/^https:\/\/custom\.example\.com/);
  });

  it('trailing slash in baseUrl does not create double slashes', async () => {
    const transport = mockTransport(mockResponse(validRouteResponse));
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      baseUrl: 'https://custom.example.com/',
      transport,
      maxRetries: 0,
    });

    await client.route({ taskId: 'task-1', prompt: 'test' });

    const call = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[0]).not.toContain('//v1');
    expect(call[0]).toBe('https://custom.example.com/v1/route');
  });

  it('invalid base URL rejects before transport with HokusaiValidationError', () => {
    expect(() => {
      new HokusaiClient({ apiKey: 'sk-test', baseUrl: 'not-a-valid-url' });
    }).toThrow(HokusaiValidationError);

    expect(() => {
      new HokusaiClient({ apiKey: 'sk-test', baseUrl: 'ftp://bad-scheme.com' });
    }).toThrow(HokusaiValidationError);
  });

  it('invalid base URL error has code invalid_base_url', () => {
    let caught: HokusaiValidationError | undefined;
    try {
      new HokusaiClient({ apiKey: 'sk-test', baseUrl: 'garbage' });
    } catch (e) {
      if (e instanceof HokusaiValidationError) caught = e;
    }
    expect(caught?.code).toBe('invalid_base_url');
  });
});

// --- Successful route call ---

describe('HokusaiClient - route()', () => {
  it('returns typed RouteResponse on success', async () => {
    const transport = mockTransport(mockResponse(validRouteResponse));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    const result = await client.route({ taskId: 'task-1', prompt: 'hello' });

    expect(result).toEqual(validRouteResponse);
  });

  it('sends correct JSON body', async () => {
    const transport = mockTransport(mockResponse(validRouteResponse));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    const request = { taskId: 'task-1', prompt: 'test prompt', modelId: 'gpt-5' };
    await client.route(request);

    const call = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as unknown;
    expect(body).toEqual(request);
  });

  it('does not mutate the caller-supplied request object', async () => {
    const transport = mockTransport(mockResponse(validRouteResponse));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    const request = { taskId: 'task-1', prompt: 'test' };
    const requestCopy = { ...request };
    await client.route(request);

    expect(request).toEqual(requestCopy);
  });
});

// --- Successful outcome report ---

describe('HokusaiClient - reportOutcome()', () => {
  it('returns typed OutcomeResponse on 200', async () => {
    const transport = mockTransport(mockResponse(validOutcomeResponse));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    const result = await client.reportOutcome({
      taskId: 'task-1',
      routingId: 'route-abc',
      status: 'completed',
      summary: 'done',
    });

    expect(result).toEqual(validOutcomeResponse);
  });

  it('handles 202 response', async () => {
    const transport = mockTransport(mockResponse(validOutcomeResponse, 202));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    const result = await client.reportOutcome({
      taskId: 'task-1',
      routingId: 'route-abc',
      status: 'completed',
      summary: 'done',
    });

    expect((result as OutcomeResponse).acknowledged).toBe(true);
  });

  it('handles 204 No Content as acknowledged ack', async () => {
    const transport = mockTransport(mockEmptyResponse(204));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    const result = await client.reportOutcome({
      taskId: 'task-1',
      routingId: 'route-abc',
      status: 'completed',
      summary: 'done',
    });

    expect((result as OutcomeResponse).acknowledged).toBe(true);
  });
});

// --- Local validation failures ---

describe('HokusaiClient - local validation', () => {
  it('rejects route() with missing taskId before transport', async () => {
    const transport = vi.fn();
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    await expect(
      // @ts-expect-error intentionally invalid
      client.route({ prompt: 'missing taskId' }),
    ).rejects.toBeInstanceOf(HokusaiValidationError);

    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects route() with missing prompt before transport', async () => {
    const transport = vi.fn();
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    await expect(
      // @ts-expect-error intentionally invalid
      client.route({ taskId: 'task-1' }),
    ).rejects.toBeInstanceOf(HokusaiValidationError);

    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects reportOutcome() with missing required fields before transport', async () => {
    const transport = vi.fn();
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    await expect(
      // @ts-expect-error intentionally invalid
      client.reportOutcome({ taskId: 'task-1', status: 'completed' }),
    ).rejects.toBeInstanceOf(HokusaiValidationError);

    expect(transport).not.toHaveBeenCalled();
  });

  it('local validation error has code invalid_request', async () => {
    const client = new HokusaiClient({ apiKey: 'sk-test', maxRetries: 0 });
    let caught: HokusaiValidationError | undefined;
    try {
      // @ts-expect-error intentionally invalid
      await client.route({ prompt: 'no task id' });
    } catch (e) {
      if (e instanceof HokusaiValidationError) caught = e;
    }
    expect(caught?.code).toBe('invalid_request');
  });
});

// --- API validation errors ---

describe('HokusaiClient - API validation errors (422)', () => {
  it('throws HokusaiValidationError on 422 with status and requestId', async () => {
    const transport = mockTransport(
      mockResponse({ error: 'bad request', fields: [] }, 422, {
        'X-Request-Id': 'server-req-id',
      }),
    );
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    let caught: HokusaiValidationError | undefined;
    try {
      await client.route({ taskId: 'task-1', prompt: 'test' });
    } catch (e) {
      if (e instanceof HokusaiValidationError) caught = e;
    }

    expect(caught).toBeInstanceOf(HokusaiValidationError);
    expect(caught?.status).toBe(422);
    expect(caught?.requestId).toBe('server-req-id');
    expect(caught?.details).toBeTruthy();
  });

  it('does not retry on 422', async () => {
    const transport = vi.fn().mockResolvedValue(
      mockResponse({ error: 'bad' }, 422),
    );
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 2 });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiValidationError);

    expect(transport).toHaveBeenCalledTimes(1);
  });
});

// --- Auth errors ---

describe('HokusaiClient - auth errors', () => {
  it('throws HokusaiAuthError on 401', async () => {
    const transport = mockTransport(mockEmptyResponse(401));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiAuthError);
  });

  it('throws HokusaiAuthError on 403', async () => {
    const transport = mockTransport(mockEmptyResponse(403));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiAuthError);
  });

  it('auth error message does not include the API key', async () => {
    const transport = mockTransport(mockEmptyResponse(401));
    const client = new HokusaiClient({ apiKey: 'sk-super-secret-key', transport, maxRetries: 0 });

    let caught: HokusaiAuthError | undefined;
    try {
      await client.route({ taskId: 'task-1', prompt: 'test' });
    } catch (e) {
      if (e instanceof HokusaiAuthError) caught = e;
    }

    expect(caught?.message).not.toContain('sk-super-secret-key');
  });

  it('does not retry on 401', async () => {
    const transport = vi.fn().mockResolvedValue(mockEmptyResponse(401));
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 2 });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiAuthError);

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('throws HokusaiAuthError with code missing_api_key when no apiKey', async () => {
    const client = new HokusaiClient({ maxRetries: 0 });

    let caught: HokusaiAuthError | undefined;
    try {
      await client.route({ taskId: 'task-1', prompt: 'test' });
    } catch (e) {
      if (e instanceof HokusaiAuthError) caught = e;
    }

    expect(caught).toBeInstanceOf(HokusaiAuthError);
    expect(caught?.code).toBe('missing_api_key');
  });
});

// --- Network failures ---

describe('HokusaiClient - network failures', () => {
  it('throws HokusaiNetworkError after maxRetries + 1 calls', async () => {
    const networkError = new Error('ECONNREFUSED');
    const transport = failingTransport(networkError);
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 2,
      backoffMs: () => 0,
    });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiNetworkError);

    expect(transport).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('includes requestId and cause in HokusaiNetworkError', async () => {
    const originalError = new Error('Network failure');
    const transport = failingTransport(originalError);
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 0,
      backoffMs: () => 0,
    });

    let caught: HokusaiNetworkError | undefined;
    try {
      await client.route({ taskId: 'task-1', prompt: 'test' });
    } catch (e) {
      if (e instanceof HokusaiNetworkError) caught = e;
    }

    expect(caught?.requestId).toBeTruthy();
    expect((caught as unknown as { cause?: unknown })?.cause).toBe(originalError);
  });

  it('with maxRetries: 0, makes exactly one call', async () => {
    const transport = failingTransport(new Error('fail'));
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 0,
      backoffMs: () => 0,
    });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiNetworkError);

    expect(transport).toHaveBeenCalledTimes(1);
  });
});

// --- Retry behavior ---

describe('HokusaiClient - retry behavior', () => {
  it('retries on 503 and succeeds on final attempt', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(mockEmptyResponse(503))
      .mockResolvedValueOnce(mockEmptyResponse(503))
      .mockResolvedValue(mockResponse(validRouteResponse));

    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 2,
      backoffMs: () => 0,
    });

    const result = await client.route({ taskId: 'task-1', prompt: 'test' });

    expect(result).toEqual(validRouteResponse);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('retries on 429', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(mockEmptyResponse(429))
      .mockResolvedValue(mockResponse(validRouteResponse));

    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 2,
      backoffMs: () => 0,
    });

    await client.route({ taskId: 'task-1', prompt: 'test' });

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 400', async () => {
    const transport = vi.fn().mockResolvedValue(mockEmptyResponse(400));
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 2,
      backoffMs: () => 0,
    });

    await expect(
      client.route({ taskId: 'task-1', prompt: 'test' }),
    ).rejects.toBeInstanceOf(HokusaiApiError);

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After header when present', async () => {
    // Use Retry-After: 0 to avoid real sleep while still exercising the code path
    const transport = vi.fn()
      .mockResolvedValueOnce(mockEmptyResponse(429, { 'Retry-After': '0' }))
      .mockResolvedValue(mockResponse(validRouteResponse));

    const client = new HokusaiClient({
      apiKey: 'sk-test',
      transport,
      maxRetries: 2,
      backoffMs: () => 0,
    });

    const result = await client.route({ taskId: 'task-1', prompt: 'test' });

    expect(result).toEqual(validRouteResponse);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

// --- Dry-run ---

describe('HokusaiClient - dry-run', () => {
  it('route() with dryRun:true returns descriptor without calling transport', async () => {
    const transport = vi.fn();
    const client = new HokusaiClient({ apiKey: 'sk-test', transport });

    const result = await client.route(
      { taskId: 'task-1', prompt: 'test' },
      { dryRun: true },
    );

    expect(transport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, method: 'POST' });
  });

  it('reportOutcome() with dryRun:true returns descriptor without transport', async () => {
    const transport = vi.fn();
    const client = new HokusaiClient({ apiKey: 'sk-test', transport });

    const result = await client.reportOutcome(
      {
        taskId: 'task-1',
        routingId: 'route-abc',
        status: 'completed',
        summary: 'done',
      },
      { dryRun: true },
    );

    expect(transport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, method: 'POST' });
  });

  it('client-level dryRun option applies to all calls', async () => {
    const transport = vi.fn();
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, dryRun: true });

    await client.route({ taskId: 'task-1', prompt: 'test' });
    await client.reportOutcome({
      taskId: 'task-1',
      routingId: 'r-1',
      status: 'completed',
      summary: 'done',
    });

    expect(transport).not.toHaveBeenCalled();
  });

  it('dry-run URL reflects custom baseUrl', async () => {
    const client = new HokusaiClient({
      apiKey: 'sk-test',
      baseUrl: 'https://staging.example.com',
      dryRun: true,
    });

    const descriptor = await client.route({ taskId: 'task-1', prompt: 'test' });

    if ('dryRun' in descriptor) {
      expect(descriptor.url).toMatch(/^https:\/\/staging\.example\.com/);
    }
  });

  it('dry-run redacts authorization header', async () => {
    const client = new HokusaiClient({ apiKey: 'sk-secret', dryRun: true });

    const descriptor = await client.route({ taskId: 'task-1', prompt: 'test' });

    if ('dryRun' in descriptor) {
      expect(descriptor.headers['Authorization']).toBe('[redacted]');
      expect(descriptor.headers['Authorization']).not.toContain('sk-secret');
    }
  });

  it('dry-run still validates the request', async () => {
    const client = new HokusaiClient({ apiKey: 'sk-test', dryRun: true });

    await expect(
      // @ts-expect-error intentionally invalid
      client.route({ prompt: 'no task id' }),
    ).rejects.toBeInstanceOf(HokusaiValidationError);
  });

  it('dry-run descriptor includes X-Request-Id and X-Hokusai-SDK-Version', async () => {
    const client = new HokusaiClient({ apiKey: 'sk-test', dryRun: true });

    const descriptor = await client.route({ taskId: 'task-1', prompt: 'test' });

    if ('dryRun' in descriptor) {
      expect(descriptor.headers['X-Request-Id']).toBeTruthy();
      expect(descriptor.headers['X-Hokusai-SDK-Version']).toBe(SDK_VERSION);
    }
  });
});

// --- Invalid response body ---

describe('HokusaiClient - malformed API response', () => {
  it('throws HokusaiApiError with code invalid_response when response body is malformed', async () => {
    const transport = mockTransport(
      mockResponse({ unexpected: 'shape', noTaskId: true }),
    );
    const client = new HokusaiClient({ apiKey: 'sk-test', transport, maxRetries: 0 });

    let caught: HokusaiApiError | undefined;
    try {
      await client.route({ taskId: 'task-1', prompt: 'test' });
    } catch (e) {
      if (e instanceof HokusaiApiError) caught = e;
    }

    expect(caught).toBeInstanceOf(HokusaiApiError);
    expect(caught?.code).toBe('invalid_response');
  });
});

// --- Error class hierarchy ---

describe('Error class hierarchy', () => {
  it('HokusaiAuthError extends HokusaiError which extends HokusaiClientError', () => {
    const err = new HokusaiAuthError('test');
    expect(err).toBeInstanceOf(HokusaiAuthError);
    expect(err).toBeInstanceOf(HokusaiError);
    expect(err).toBeInstanceOf(HokusaiClientError);
    expect(err).toBeInstanceOf(Error);
  });

  it('HokusaiValidationError extends HokusaiError', () => {
    const err = new HokusaiValidationError('test', 'invalid_request');
    expect(err).toBeInstanceOf(HokusaiValidationError);
    expect(err).toBeInstanceOf(HokusaiError);
    expect(err).toBeInstanceOf(HokusaiClientError);
  });

  it('HokusaiNetworkError extends HokusaiError', () => {
    const err = new HokusaiNetworkError('test');
    expect(err).toBeInstanceOf(HokusaiNetworkError);
    expect(err).toBeInstanceOf(HokusaiError);
    expect(err).toBeInstanceOf(HokusaiClientError);
  });

  it('HokusaiApiError extends HokusaiError', () => {
    const err = new HokusaiApiError('test');
    expect(err).toBeInstanceOf(HokusaiApiError);
    expect(err).toBeInstanceOf(HokusaiError);
    expect(err).toBeInstanceOf(HokusaiClientError);
  });

  it('HokusaiError carries structured fields', () => {
    const err = new HokusaiError('test message', 'api_error', {
      status: 500,
      requestId: 'req-123',
      details: { foo: 'bar' },
    });

    expect(err.code).toBe('api_error');
    expect(err.status).toBe(500);
    expect(err.requestId).toBe('req-123');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err.name).toBe('HokusaiError');
  });
});
