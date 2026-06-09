import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FsLocalStore,
  HokusaiClient,
  InMemoryModelRegistry,
  claudeCodeSuccessOutcomeFixture,
  type FetchTransport,
} from '@hokusai/core';
import {
  clearClaudeCodeLocalState,
  declineRecommendation,
  displayHandoff,
  displayTaskRecommendation,
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
    const configPath = await createTempDir('hokusai-claude-route-');
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
        configPath,
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
    expect(result.value.correlationId).toBeTruthy();
    expect(result.value.routingDecisionId).toBe(result.value.correlationId);
    expect(result.value.handoff.slashCommand).toBe('/model claude-opus-4-8');

    const store = new FsLocalStore(configPath);
    const persisted = await store.getCorrelation(
      result.value.correlationId.replace(/[:.]/g, '_'),
    );

    expect(persisted?.metadata).toMatchObject({
      recommendedModelId: 'claude-opus-4-8',
      status: 'pending',
    });
    expect(
      JSON.parse(persisted?.metadata?.recommendedAlternativeIds ?? '[]'),
    ).toEqual(['claude-sonnet-4-6']);
    expect(persisted?.metadata?.reasonHash).toBeTruthy();
  });

  it('returns a no-op handoff when the current model already matches', async () => {
    const result = await routeTask(
      {
        taskText: 'Keep the current model.',
        modelId: 'claude-sonnet-4-6',
      },
      {
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

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.handoff.instructions).toEqual([]);
    expect(displayHandoff(result.value.handoff)).toEqual([
      'Switch in Claude Code: no switch needed.',
    ]);
  });
});

describe('declineRecommendation', () => {
  it('updates the persisted routing decision to declined with a redacted reason', async () => {
    const configPath = await createTempDir('hokusai-claude-decline-');
    const routed = await routeTask(
      {
        taskId: 'task-decline',
        taskText: 'Email alice@example.com about the routing choice.',
        modelId: 'claude-sonnet-4-6',
      },
      {
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

    const declined = await declineRecommendation(
      {
        correlationId: routed.value.correlationId,
        reason:
          'Prefer email alice@example.com follow-up on a faster model because the task is small.',
      },
      {
        configPath,
      },
    );

    expect(declined).toEqual({
      ok: true,
      value: {
        correlationId: routed.value.correlationId,
        status: 'declined',
      },
    });

    const store = new FsLocalStore(configPath);
    const persisted = await store.getCorrelation(
      routed.value.correlationId.replace(/[:.]/g, '_'),
    );

    expect(persisted?.metadata?.status).toBe('declined');
    expect(persisted?.metadata?.declinedAt).toBeTruthy();
    expect(persisted?.metadata?.declineReason).not.toContain('alice@example.com');
  });

  it('returns an error for an unknown correlation id', async () => {
    await expect(
      declineRecommendation(
        {
          correlationId: 'missing-correlation',
        },
        {
          configPath: await createTempDir('hokusai-claude-missing-'),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_CORRELATION',
        message:
          'No stored routing decision matches correlation id missing-correlation.',
      },
    });
  });
});

describe('reportTaskOutcome', () => {
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
