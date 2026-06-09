import { describe, expect, it, vi } from 'vitest';
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryLocalStore,
  InMemoryModelRegistry,
  type HarnessAdapter,
  type ModelDefinition,
} from '@hokusai/core';
import {
  buildCodexTaskPacket,
  createCodexAdapter,
  createCodexHarnessAdapter,
  createCodexModelProvider,
} from './index.js';

const models: ModelDefinition[] = [
  {
    id: 'gpt-5-codex',
    provider: 'openai',
    family: 'gpt',
    capabilities: ['reasoning', 'tool-use'],
    default: true,
  },
];

const redactionConfig = {
  salt: 'index-test-salt',
  email: true,
};

describe('createCodexAdapter', () => {
  it('returns a stable command surface', () => {
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
      version: '0.1.0',
    });

    expect(adapter.harness).toBe('codex');
    expect(adapter.commands[0]?.name).toBe('hokusai:run');
    expect(adapter.commands.map((command) => command.name)).toEqual([
      'hokusai:run',
      'hokusai:recommend',
      'hokusai:preview',
      'hokusai:outcome',
    ]);
    expect(adapter.manifest).toEqual({
      pluginId: 'hokusai.codex',
      defaultModel: 'gpt-5-codex',
      version: '0.1.0',
    });
  });

  it('re-exports the task packet builder', () => {
    expect(buildCodexTaskPacket).toBeTypeOf('function');
  });

  it('delegates command handlers through the configured client', async () => {
    const client = new HokusaiClient({
      apiKey: 'test-key',
      transport: () =>
        Promise.resolve({
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
        }),
      requestIdFactory: () => 'req-1',
    });
    const adapter = createCodexAdapter({
      apiClient: client,
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
    });
    const dispatchBuilder = new HokusaiDispatchBuilder({
      consent: {
        subjectId: 'user-123',
        grantedScopes: ['task-execution'],
      },
      redactionConfig,
      modelRegistry: new InMemoryModelRegistry(models),
      clock: () => new Date('2026-06-08T00:00:00.000Z'),
    });

    const recommendation = await adapter.requestRecommendation({
      dispatchBuilder,
      task: {
        id: 'task-1',
        prompt: 'Email ops@example.com',
      },
      modelId: 'gpt-5-codex',
    });

    expect(recommendation).toEqual({
      ok: true,
      value: {
        requestId: 'req-1',
        routeId: 'route-1',
        taskId: 'task-1',
        status: 'accepted',
      },
    });
  });
});

describe('createCodexModelProvider', () => {
  it('maps configured models', async () => {
    const provider = createCodexModelProvider(models);

    const mapped = await provider.mapModel({
      harnessModelId: 'gpt-5-codex',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped).toEqual({
      ok: true,
      value: {
        id: 'gpt-5-codex',
        provider: 'openai',
        capabilities: ['reasoning', 'tool-use'],
      },
    });
  });

  it('returns structured unknown-model errors', async () => {
    const provider = createCodexModelProvider(models);

    const mapped = await provider.mapModel({
      harnessModelId: 'missing-model',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped.ok).toBe(false);
    if (mapped.ok) {
      return;
    }
    expect(mapped.error.code).toBe('UNKNOWN_MODEL');
  });
});

describe('createCodexHarnessAdapter', () => {
  it('returns an object that satisfies the harness adapter contract', async () => {
    const store = new InMemoryLocalStore();
    const displayRecommendation = vi.fn(() => ({
      ok: true as const,
      value: undefined,
    }));
    const adapter = createCodexHarnessAdapter({
      defaultModel: 'gpt-5-codex',
      models,
      redactionConfig,
      store,
      version: '0.1.0',
      telemetry: () => ({
        taskId: 'task-1',
        taskSummary: 'Add a feature and validate it with tests.',
        model: 'gpt-5-codex',
        cwd: '/repo',
        metadata: { sessionId: 'session-1' },
        harnessVersion: '0.1.0',
      }),
      recommendation: displayRecommendation,
    });
    const typedAdapter: HarnessAdapter = adapter;
    void typedAdapter;

    const context = await adapter.context.collectTaskContext({ taskId: 'task-1' });
    expect(context.ok).toBe(true);
    if (!context.ok) {
      return;
    }

    const discovered = await adapter.models.discoverModels({
      task: context.value.task,
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) {
      return;
    }

    const mapped = await adapter.models.mapModel({
      harnessModelId: 'gpt-5-codex',
      discoveredModels: discovered.value,
      availableModels: models,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }

    const preview = adapter.payloads.previewPayload({
      payload: {
        task: context.value.task,
        prompt: context.value.task.prompt,
        consent: {
          subjectId: 'user-123',
          grantedScopes: ['task-execution'],
        },
        model: mapped.value,
        correlation: {
          taskId: 'task-1',
          correlationId: 'corr-1',
          createdAt: '2026-06-08T00:00:00.000Z',
        },
        redactions: [{ label: 'email' }],
        createdAt: '2026-06-08T00:00:00.000Z',
      },
    });
    const resolvedPreview = preview instanceof Promise ? await preview : preview;
    expect(resolvedPreview).toEqual({
      ok: true,
      value: {
        summary: 'Dispatch task-1 with gpt-5-codex',
        promptPreview: context.value.task.prompt,
        redactionCount: 1,
      },
    });

    const recommendation = adapter.recommendations.displayRecommendation({
      task: context.value.task,
      recommendation: {
        model: mapped.value,
        reason: 'Best fit for repo reasoning',
      },
    });
    const resolvedRecommendation =
      recommendation instanceof Promise ? await recommendation : recommendation;
    expect(resolvedRecommendation).toEqual({
      ok: true,
      value: undefined,
    });
    expect(displayRecommendation).toHaveBeenCalledTimes(1);

    const outcome = await adapter.outcomes.collectOutcome({
      task: context.value.task,
      model: mapped.value,
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        taskId: 'task-1',
        status: 'accepted',
        summary: 'Accepted by Codex',
      },
    });

    await expect(adapter.storage.set('config', 'enabled')).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(adapter.storage.get('config')).resolves.toEqual({
      ok: true,
      value: 'enabled',
    });
    await expect(adapter.consent.promptConsent({
      scope: 'task-execution',
      reason: 'Need to route the task',
    })).resolves.toEqual({
      ok: true,
      value: {
        outcome: 'granted',
        scope: 'task-execution',
      },
    });
  });
});
