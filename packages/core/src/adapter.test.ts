import { describe, expect, it } from 'vitest';
import type {
  AdapterResult,
  HarnessAdapter,
  HarnessConsentDecision,
  HarnessConsentPromptRequest,
  HarnessTaskContext,
} from './adapter.js';
import type { ModelDefinition, ModelSelection } from './model-registry.js';
import type { HokusaiDispatchPayload } from './schemas.js';

function ok<T>(value: T): AdapterResult<T> {
  return {
    ok: true,
    value,
  };
}

function fail(code: string, message: string): AdapterResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function createFakeAdapter(): HarnessAdapter & {
  getLatestRecommendation(): string | undefined;
} {
  const storage = new Map<string, string>();
  const discoveredModels = [
    {
      id: 'codex/gpt-5-codex',
      label: 'GPT-5 Codex',
      metadata: {
        family: 'gpt-5',
      },
    },
  ];
  const availableModels: ModelDefinition[] = [
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt-5',
      capabilities: ['reasoning', 'tool-use'],
      default: true,
    },
  ];
  const mappedModel: ModelSelection = {
    id: 'gpt-5-codex',
    provider: 'openai',
    capabilities: ['reasoning', 'tool-use'],
  };
  const discoveredModel = discoveredModels[0];
  if (!discoveredModel) {
    throw new Error('expected discovered model');
  }
  const context: HarnessTaskContext = {
    task: {
      id: 'task-1',
      prompt: 'Review <redacted:email> before dispatch.',
      metadata: {
        repo: 'hokusai-sdk',
      },
    },
    harness: {
      name: 'fake-harness',
      version: '1.0.0',
    },
    cwd: '/tmp/fake-harness',
    command: 'hokusai.run',
    configPath: '/tmp/fake-harness/config.json',
    metadata: {
      sessionId: 'session-123',
    },
  };
  let latestRecommendation: string | undefined;

  return {
    context: {
      collectTaskContext() {
        return Promise.resolve(ok(context));
      },
    },
    models: {
      discoverModels(request) {
        expect(request.task.id).toBe('task-1');
        return Promise.resolve(ok(discoveredModels));
      },
      mapModel(request) {
        expect(request.harnessModelId).toBe(discoveredModel.id);
        expect(request.availableModels).toEqual(availableModels);
        return Promise.resolve(ok(mappedModel));
      },
    },
    recommendations: {
      displayRecommendation(request) {
        latestRecommendation = `${request.task.id}:${request.recommendation.model.id}`;
        return ok(undefined);
      },
    },
    outcomes: {
      collectOutcome(request) {
        return Promise.resolve(
          ok({
          taskId: request.task.id,
          status: 'completed',
          summary: `Executed with ${request.model.id}`,
          }),
        );
      },
    },
    payloads: {
      previewPayload(request) {
        return ok({
          summary: `Dispatch ${request.payload.task.id} with ${request.payload.model.id}`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        });
      },
    },
    consent: {
      promptConsent(request) {
        const outcome: HarnessConsentDecision = {
          outcome:
            request.scope === 'task-execution' ? 'granted' : 'dismissed',
          scope: request.scope,
        };
        return Promise.resolve(ok(outcome));
      },
    },
    storage: {
      get(key) {
        return Promise.resolve(ok(storage.get(key)));
      },
      set(key, value) {
        storage.set(key, value);
        return Promise.resolve(ok(undefined));
      },
      delete(key) {
        storage.delete(key);
        return Promise.resolve(ok(undefined));
      },
    },
    handoff: {
      handoff(request) {
        return Promise.resolve(
          ok({
          handoffId: `${request.context.task.id}:${request.model.id}`,
          }),
        );
      },
    },
    getLatestRecommendation() {
      return latestRecommendation;
    },
  };
}

const adapterWithoutHandoff = {
  context: {
    collectTaskContext() {
      return Promise.resolve(ok({
        task: {
          id: 'task-without-handoff',
          prompt: 'Do the work',
        },
        harness: {
          name: 'fake-harness',
        },
      }));
    },
  },
  models: {
    discoverModels(request) {
      void request;
      return Promise.resolve(ok([]));
    },
    mapModel(request) {
      void request;
      return Promise.resolve(ok({
        id: 'gpt-5-codex',
        provider: 'openai',
        capabilities: ['reasoning'],
      }));
    },
  },
  recommendations: {
    displayRecommendation() {
      return ok(undefined);
    },
  },
  outcomes: {
    collectOutcome() {
      return Promise.resolve(ok({
        taskId: 'task-without-handoff',
        status: 'accepted',
        summary: 'accepted',
      }));
    },
  },
  payloads: {
    previewPayload() {
      return ok({
        summary: 'preview',
        promptPreview: 'preview',
        redactionCount: 0,
      });
    },
  },
  consent: {
    promptConsent(request: HarnessConsentPromptRequest) {
      return Promise.resolve(ok({
        outcome: 'denied',
        scope: request.scope,
      }));
    },
  },
  storage: {
    get() {
      return Promise.resolve(ok(undefined));
    },
    set() {
      return Promise.resolve(ok(undefined));
    },
    delete() {
      return Promise.resolve(ok(undefined));
    },
  },
} satisfies HarnessAdapter;

describe('HarnessAdapter contracts', () => {
  it('supports a fake adapter without importing real harnesses', async () => {
    const fakeAdapter = createFakeAdapter();
    const adapter: HarnessAdapter = fakeAdapter;
    const contextResult = await adapter.context.collectTaskContext({
      taskId: 'task-1',
    });
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) {
      throw new Error('expected task context');
    }

    const discoverResult = await adapter.models.discoverModels({
      task: contextResult.value.task,
    });
    expect(discoverResult.ok).toBe(true);
    if (!discoverResult.ok) {
      throw new Error('expected models');
    }

    const availableModels: ModelDefinition[] = [
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt-5',
        capabilities: ['reasoning', 'tool-use'],
        default: true,
      },
    ];
    const discoveredModel = discoverResult.value[0];
    expect(discoveredModel).toBeDefined();
    if (!discoveredModel) {
      throw new Error('expected discovered model');
    }
    const mapResult = await adapter.models.mapModel({
      harnessModelId: discoveredModel.id,
      discoveredModels: discoverResult.value,
      availableModels,
    });
    expect(mapResult.ok).toBe(true);
    if (!mapResult.ok) {
      throw new Error('expected mapping');
    }

    const payload: HokusaiDispatchPayload = {
      task: contextResult.value.task,
      prompt: 'Review <redacted:email> before dispatch.',
      consent: {
        subjectId: 'user-123',
        grantedScopes: ['task-execution'],
      },
      model: mapResult.value,
      correlation: {
        taskId: 'task-1',
        correlationId: 'corr-123',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      redactions: [
        {
          label: 'email',
          value: 'alice@example.com',
        },
      ],
      createdAt: '2026-06-01T00:00:00.000Z',
    };

    const previewResult = adapter.payloads.previewPayload({ payload });
    const resolvedPreview = previewResult instanceof Promise
      ? await previewResult
      : previewResult;
    expect(resolvedPreview).toEqual(
      ok({
        summary: 'Dispatch task-1 with gpt-5-codex',
        promptPreview: 'Review <redacted:email> before dispatch.',
        redactionCount: 1,
      }),
    );

    const recommendationResult = adapter.recommendations.displayRecommendation({
      task: contextResult.value.task,
      recommendation: {
        model: mapResult.value,
        reason: 'Best supported reasoning model',
      },
    });
    const resolvedRecommendation =
      recommendationResult instanceof Promise
        ? await recommendationResult
        : recommendationResult;
    expect(resolvedRecommendation).toEqual(ok(undefined));
    expect(fakeAdapter.getLatestRecommendation()).toBe('task-1:gpt-5-codex');

    const consentResult = await adapter.consent.promptConsent({
      scope: 'telemetry',
      reason: 'Collect execution outcome',
    });
    expect(consentResult).toEqual(
      ok({
        outcome: 'dismissed',
        scope: 'telemetry',
      }),
    );

    const outcomeResult = await adapter.outcomes.collectOutcome({
      task: contextResult.value.task,
      model: mapResult.value,
    });
    expect(outcomeResult).toEqual(
      ok({
        taskId: 'task-1',
        status: 'completed',
        summary: 'Executed with gpt-5-codex',
      }),
    );

    const handoffResult = await adapter.handoff?.handoff({
      context: contextResult.value,
      payload,
      model: mapResult.value,
    });
    expect(handoffResult).toEqual(
      ok({
        handoffId: 'task-1:gpt-5-codex',
      }),
    );

    await adapter.storage.set('last-task', contextResult.value.task.id);
    expect(await adapter.storage.get('last-task')).toEqual(ok('task-1'));
    await adapter.storage.delete('last-task');
    expect(await adapter.storage.get('last-task')).toEqual(ok(undefined));
  });

  it('allows adapters to omit optional handoff', async () => {
    expect('handoff' in adapterWithoutHandoff).toBe(false);
    const consentResult = await adapterWithoutHandoff.consent.promptConsent({
      scope: 'local-storage',
      reason: 'Persist recommendation dismissal',
    });
    expect(consentResult).toEqual(
      ok({
        outcome: 'denied',
        scope: 'local-storage',
      }),
    );
  });

  it('surfaces adapter failures through AdapterResult', async () => {
    const failingAdapter = {
      ...adapterWithoutHandoff,
      models: {
        discoverModels(request) {
          void request;
          return Promise.resolve(
            fail('model_discovery_failed', 'Harness model list unavailable'),
          );
        },
        mapModel(request) {
          void request;
          return Promise.resolve(
            fail('model_mapping_failed', 'Harness model cannot be mapped'),
          );
        },
      },
    } satisfies HarnessAdapter;

    const result = await failingAdapter.models.discoverModels({
      task: {
        id: 'task-2',
        prompt: 'Do the work',
      },
    });

    if (result.ok) {
      throw new Error('expected adapter failure');
    }

    expect(result.error.code).toBe('model_discovery_failed');
    expect(result.error.message).toBe('Harness model list unavailable');
  });
});
