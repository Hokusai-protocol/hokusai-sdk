import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HokusaiClient,
  InMemoryModelRegistry,
  claudeCodeSuccessOutcomeFixture,
  type FetchTransport,
} from '@hokusai/core';
import {
  clearClaudeCodeLocalState,
  displayTaskRecommendation,
  findLatestRoutingDecision,
  previewReportOutcome,
  previewTaskPayload,
  reportTaskOutcome,
  routeTask,
  runDoctor,
} from './commands.js';

interface MockCall {
  input: string;
  init: Parameters<FetchTransport>[1];
}

const tempDirs: string[] = [];

function createHeaders(
  values: Record<string, string> = {},
): Awaited<ReturnType<FetchTransport>>['headers'] {
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
): Awaited<ReturnType<FetchTransport>> {
  return {
    status,
    headers: createHeaders(headers),
    text(): Promise<string> {
      return Promise.resolve(
        body === undefined
          ? ''
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
      );
    },
  };
}

function createMockTransport(
  sequence: Array<Awaited<ReturnType<FetchTransport>> | Error>,
): {
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

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runDoctor', () => {
  it('reports missing config as setup needed without throwing', async () => {
    const configPath = path.join(os.tmpdir(), `missing-${Date.now()}`);

    await rm(configPath, { recursive: true, force: true });

    expect(runDoctor({ configPath })).toMatchObject({
      configPresent: false,
      needsSetup: true,
    });
  });

  it('reports an existing config directory as present', async () => {
    const configPath = await createTempDir('hokusai-claude-doctor-');
    await mkdir(configPath, { recursive: true });

    expect(runDoctor({ configPath })).toMatchObject({
      configPresent: true,
      needsSetup: false,
    });
  });
});

describe('previewTaskPayload', () => {
  it('returns a redacted preview without calling the network', () => {
    const result = previewTaskPayload({
      taskId: 'task-preview',
      taskText: 'Email alice@example.com and use sk-12345678 on db-prod.internal',
      modelId: 'claude-sonnet-4-6',
    });

    expect(result.packet.userIntent).not.toContain('alice@example.com');
    expect(result.packet.userIntent).not.toContain('sk-12345678');
    expect(result.preview.willSend.userIntent).not.toContain('alice@example.com');
    expect(result.harnessPreview.redactionCount).toBeGreaterThan(0);
  });
});

describe('routeTask', () => {
  it('rejects empty tasks before any network call', async () => {
    await expect(
      routeTask({
        taskText: '   ',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_TASK',
        message: 'Expected "taskText" to be a non-empty string.',
      },
    });
  });

  it('returns provider mapping errors for unsupported models', async () => {
    const registry = new InMemoryModelRegistry([
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt',
        capabilities: ['reasoning', 'tool-use'],
        default: true,
      },
    ]);

    const result = await routeTask(
      {
        taskText: 'Route this task',
      },
      {
        registry,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('PROVIDER_NOT_ALLOWED');
  });

  it('prefers the API recommendation when the route response includes one', async () => {
    const { transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-1',
        taskId: 'task-1',
        status: 'accepted',
        requestId: 'req-1',
        recommendation: {
          model: 'claude-opus-4-8',
          reason: 'High reasoning depth needed.',
          confidence: 0.91,
          alternatives: [
            {
              model: 'claude-sonnet-4-6',
              reason: 'Faster but slightly less depth.',
              confidence: 0.73,
            },
          ],
        },
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });
    const registry = new InMemoryModelRegistry([
      {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        family: 'claude',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
        default: true,
      },
      {
        id: 'claude-opus-4-8',
        provider: 'anthropic',
        family: 'claude',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
      },
    ]);

    const result = await routeTask(
      {
        taskId: 'task-1',
        taskText: 'Deeply debug an intermittent production issue.',
      },
      {
        apiClient: client,
        registry,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.recommendation).toMatchObject({
      model: {
        id: 'claude-opus-4-8',
      },
      reason: 'High reasoning depth needed.',
      confidence: 0.91,
      alternatives: [
        {
          model: {
            id: 'claude-sonnet-4-6',
          },
          reason: 'Faster but slightly less depth.',
          confidence: 0.73,
        },
      ],
    });
    expect(result.value.route?.requestId).toBe('req-1');
  });
});

describe('reportTaskOutcome', () => {
  it('builds a preview with redacted notes and explicit exclusions', () => {
    const result = previewReportOutcome({
      taskId: 'task-preview',
      ...claudeCodeSuccessOutcomeFixture,
      notes: 'Email alice@example.com and see https://db-prod.internal/logs',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.preview.payload.notes).not.toContain('alice@example.com');
    expect(result.value.preview.payload.notes).not.toContain('db-prod.internal');
    expect(result.value.preview.lines.join('\n')).toContain('Recommended model: claude-3-7-sonnet');
    expect(result.value.preview.lines.join('\n')).toContain('Excluded by default: raw code, raw prompts, terminal logs, and customer data.');
  });

  it('supports dry-run mode without calling the network', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        taskId: 'task-1',
        status: 'accepted',
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
      },
      {
        apiClient: client,
        dryRun: true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        submitted: false,
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('submits a valid outcome once', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        taskId: 'task-1',
        status: 'accepted',
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
      },
      {
        apiClient: client,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        submitted: true,
        response: {
          taskId: 'task-1',
          status: 'accepted',
        },
      },
    });
    expect(calls).toHaveLength(1);
  });

  it('returns validation errors without calling the network', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        taskId: 'task-1',
        status: 'accepted',
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
        recommendedModel: '',
      },
      {
        apiClient: client,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('OUTCOME_VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });
});

describe('findLatestRoutingDecision', () => {
  it('returns undefined when there are no stored correlations', async () => {
    const configDir = await createTempDir('hokusai-claude-latest-empty-');

    await expect(findLatestRoutingDecision({ configDir })).resolves.toBeUndefined();
  });

  it('returns the only stored correlation', async () => {
    const configDir = await createTempDir('hokusai-claude-latest-one-');
    await mkdir(path.join(configDir, 'correlations'), { recursive: true });
    await writeFile(
      path.join(configDir, 'correlations', 'corr_1.json'),
      JSON.stringify({
        correlationId: 'corr_1',
        packetHash: 'task-1',
        createdAt: 100,
        metadata: {
          taskId: 'task-1',
          originalCorrelationId: 'route:1',
        },
      }),
      'utf8',
    );

    await expect(findLatestRoutingDecision({ configDir })).resolves.toEqual({
      correlationId: 'route:1',
      taskId: 'task-1',
      createdAt: new Date(100).toISOString(),
    });
  });

  it('returns the most recent stored correlation', async () => {
    const configDir = await createTempDir('hokusai-claude-latest-many-');
    await mkdir(path.join(configDir, 'correlations'), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(configDir, 'correlations', 'corr_1.json'),
        JSON.stringify({
          correlationId: 'corr_1',
          packetHash: 'task-1',
          createdAt: 100,
          metadata: {
            taskId: 'task-1',
          },
        }),
        'utf8',
      ),
      writeFile(
        path.join(configDir, 'correlations', 'corr_2.json'),
        JSON.stringify({
          correlationId: 'corr_2',
          packetHash: 'task-2',
          createdAt: 200,
          metadata: {
            taskId: 'task-2',
            originalCorrelationId: 'route:2',
          },
        }),
        'utf8',
      ),
    ]);

    await expect(findLatestRoutingDecision({ configDir })).resolves.toEqual({
      correlationId: 'route:2',
      taskId: 'task-2',
      createdAt: new Date(200).toISOString(),
    });
  });
});

describe('clearClaudeCodeLocalState', () => {
  it('clears persisted state and leaves doctor in setup-needed state', async () => {
    const configPath = await createTempDir('hokusai-claude-clear-');
    await writeFile(path.join(configPath, 'state.json'), '{"key":"value"}', 'utf8');
    await mkdir(path.join(configPath, 'correlations'), { recursive: true });
    await writeFile(
      path.join(configPath, 'correlations', 'task_1.json'),
      '{"correlationId":"task_1","packetHash":"task-1","createdAt":1}',
      'utf8',
    );

    await expect(clearClaudeCodeLocalState({ configPath })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(runDoctor({ configPath })).toMatchObject({
      configPresent: false,
      needsSetup: true,
    });
  });

  it('is idempotent when no local state exists', async () => {
    const configPath = path.join(os.tmpdir(), `missing-clear-${Date.now()}`);
    await rm(configPath, { recursive: true, force: true });

    await expect(clearClaudeCodeLocalState({ configPath })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
  });
});

describe('displayTaskRecommendation', () => {
  it('formats model, provider, and reason for display', () => {
    const result = displayTaskRecommendation({
      model: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        capabilities: ['reasoning'],
      },
      reason: 'Best balanced Claude model.',
      alternatives: [
        {
          model: {
            id: 'claude-opus-4-8',
            provider: 'anthropic',
            capabilities: ['reasoning'],
          },
          reason: 'More headroom for hard problems.',
          confidence: 0.64,
        },
      ],
      confidence: 0.82,
    });

    expect(result.lines.join('\n')).toContain('Recommended model: claude-sonnet-4-6');
    expect(result.lines.join('\n')).toContain('Provider: anthropic');
    expect(result.lines.join('\n')).toContain('Reason: Best balanced Claude model.');
    expect(result.lines.join('\n')).toContain('Confidence: 82%');
    expect(result.lines.join('\n')).toContain('Alternatives: claude-opus-4-8');
  });
});

describe('route/report smoke path', () => {
  it('routes and reports successfully from a fresh config dir', async () => {
    const configPath = await createTempDir('hokusai-claude-smoke-');
    await rm(configPath, { recursive: true, force: true });

    const { calls, transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-1',
        taskId: 'task-smoke',
        status: 'accepted',
      }),
      createResponse(200, {
        taskId: 'task-smoke',
        status: 'accepted',
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const routed = await routeTask(
      {
        taskId: 'task-smoke',
        taskText: 'Investigate alice@example.com failures and propose a fix.',
        modelId: 'claude-sonnet-4-6',
      },
      {
        apiClient: client,
        configPath,
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
            default: true,
          },
        ]),
      },
    );

    expect(routed.ok).toBe(true);
    if (!routed.ok) {
      return;
    }
    const requestBody = calls[0]?.init.body ? JSON.parse(calls[0].init.body) : {};
    expect(requestBody).toMatchObject({
      task: {
        id: 'task-smoke',
      },
    });

    const reported = await reportTaskOutcome(
      {
        taskId: 'task-smoke',
        ...claudeCodeSuccessOutcomeFixture,
      },
      {
        apiClient: client,
      },
    );

    expect(reported).toMatchObject({
      ok: true,
      value: {
        submitted: true,
      },
    });
    expect(calls).toHaveLength(2);
    expect(runDoctor({ configPath, apiClient: client })).toMatchObject({
      configPresent: true,
      needsSetup: false,
      connectivity: 'configured',
    });
  });
});
