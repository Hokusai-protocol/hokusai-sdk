import {
  InMemoryModelRegistry,
  ModelMappingError,
  mapRecommendation,
  type ConsentScope,
  type HarnessAdapter,
  type HarnessDiscoveredModel,
  type HarnessModelProvider,
  type HokusaiClient,
  type HokusaiTaskInput,
  type ModelDefinition,
  type ModelRegistry,
} from '@hokusai/core';

export interface CodexAdapterOptions {
  apiClient?: HokusaiClient;
  defaultModel: string;
  pluginId: string;
}

export interface CodexAdapter {
  apiClient?: HokusaiClient;
  harness: 'codex';
  commands: Array<{
    name: 'hokusai:run';
    consentScope: ConsentScope;
  }>;
  manifest: {
    pluginId: string;
    defaultModel: string;
  };
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createCodexAdapter(options: CodexAdapterOptions): CodexAdapter {
  return {
    ...(options.apiClient ? { apiClient: options.apiClient } : {}),
    harness: 'codex',
    commands: [
      {
        name: 'hokusai:run',
        consentScope: 'task-execution',
      },
    ],
    manifest: {
      pluginId: options.pluginId,
      defaultModel: options.defaultModel,
    },
    toTaskReference(task) {
      return `codex:${task.id}`;
    },
  };
}

function toDiscoveredModel(model: ModelDefinition): HarnessDiscoveredModel {
  return {
    id: model.id,
    label: model.id,
    metadata: {
      family: model.family,
      provider: model.provider,
    },
  };
}

function createMappedModelProvider(registry: ModelRegistry): HarnessModelProvider {
  return {
    discoverModels() {
      return Promise.resolve({
        ok: true,
        value: registry.listAvailable().map(toDiscoveredModel),
      });
    },
    mapModel(request) {
      try {
        const model = mapRecommendation(
          { model: request.harnessModelId },
          { registry, requireAvailable: true },
        );

        return Promise.resolve({
          ok: true,
          value: {
            id: model.id,
            provider: model.provider,
            capabilities: model.capabilities,
          },
        });
      } catch (error) {
        if (error instanceof ModelMappingError) {
          return Promise.resolve({
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              details: {
                suggestions: error.suggestions,
              },
            },
          });
        }

        throw error;
      }
    },
  };
}

export function createCodexModelProvider(
  models: ModelDefinition[],
): HarnessModelProvider {
  return createMappedModelProvider(new InMemoryModelRegistry(models));
}

void ({
  context: {
    collectTaskContext() {
      return Promise.resolve({
        ok: true,
        value: {
          task: {
            id: 'task-1',
            prompt: 'Codex task',
          },
          harness: {
            name: 'codex',
          },
        },
      });
    },
  },
  models: createCodexModelProvider([
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt',
      capabilities: ['reasoning', 'tool-use'],
      default: true,
    },
  ]),
  recommendations: {
    displayRecommendation() {
      return {
        ok: true,
        value: undefined,
      };
    },
  },
  outcomes: {
    collectOutcome(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          taskId: 'task-1',
          status: 'accepted',
          summary: 'Accepted by Codex',
        },
      });
    },
  },
  payloads: {
    previewPayload(request) {
      return {
        ok: true,
        value: {
          summary: `Preview ${request.payload.task.id}`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        },
      };
    },
  },
  consent: {
    promptConsent(request) {
      return Promise.resolve({
        ok: true,
        value: {
          outcome: 'granted',
          scope: request.scope,
        },
      });
    },
  },
  storage: {
    get(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    set(key, value) {
      void key;
      void value;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    delete(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
  },
} satisfies HarnessAdapter);
