import {
  ANTHROPIC_MODELS,
  InMemoryModelRegistry,
  ModelMappingError,
  mapRecommendation,
  type HarnessAdapter,
  type HarnessDiscoveredModel,
  type HarnessModelProvider,
  type HokusaiClient,
  type HokusaiTaskInput,
  type ModelDefinition,
  type ModelRegistry,
} from '@hokusai/core';

export {
  buildClaudeCodeTaskPacket,
  previewClaudeCodeTaskPacket,
  type ClaudeCodeBuilderOptions,
  type ClaudeCodeRepositorySignals,
  type ClaudeCodeTaskInput,
  type ClaudeCodeTaskPacketBuildResult,
  type ClaudeCodeTaskPacketPreview,
} from './task-packet.js';

export interface ClaudeCodeAdapterOptions {
  apiClient?: HokusaiClient;
  modelId: string;
  packageVersion: string;
}

export interface ClaudeCodeAdapter {
  apiClient?: HokusaiClient;
  harness: 'claude-code';
  commands: Array<{
    name: 'hokusai.run';
    description: string;
  }>;
  manifest: {
    entrypoint: 'hokusai';
    modelId: string;
    version: string;
  };
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createClaudeCodeAdapter(
  options: ClaudeCodeAdapterOptions,
): ClaudeCodeAdapter {
  return {
    ...(options.apiClient ? { apiClient: options.apiClient } : {}),
    harness: 'claude-code',
    commands: [
      {
        name: 'hokusai.run',
        description: 'Dispatch a Hokusai task from Claude Code.',
      },
    ],
    manifest: {
      entrypoint: 'hokusai',
      modelId: options.modelId,
      version: options.packageVersion,
    },
    toTaskReference(task) {
      return `claude-code:${task.id}`;
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

export function createClaudeCodeModelProvider(options?: {
  registry?: ModelRegistry;
}): HarnessModelProvider {
  const registry = options?.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);

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
          {
            registry,
            allowedProviders: ['anthropic'],
            requireAvailable: true,
          },
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

void ({
  context: {
    collectTaskContext() {
      return Promise.resolve({
        ok: true,
        value: {
          task: {
            id: 'task-1',
            prompt: 'Claude Code task',
          },
          harness: {
            name: 'claude-code',
          },
        },
      });
    },
  },
  models: createClaudeCodeModelProvider(),
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
          summary: 'Accepted by Claude Code',
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
