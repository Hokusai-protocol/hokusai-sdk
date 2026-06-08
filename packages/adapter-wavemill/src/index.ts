import {
  InMemoryModelRegistry,
  ModelMappingError,
  mapRecommendation,
  type CorrelationRecord,
  type HarnessAdapter,
  type HarnessDiscoveredModel,
  type HarnessModelProvider,
  type HokusaiClient,
  type ModelDefinition,
  type ModelRegistry,
} from '@hokusai/core';

export interface WavemillAdapterOptions {
  apiClient?: HokusaiClient;
  integrationId: string;
  supportsCorrelationReplay?: boolean;
}

export interface WavemillAdapter {
  apiClient?: HokusaiClient;
  harness: 'wavemill';
  integrationId: string;
  capabilities: string[];
  formatCorrelation(record: CorrelationRecord): string;
}

export function createWavemillAdapter(
  options: WavemillAdapterOptions,
): WavemillAdapter {
  return {
    ...(options.apiClient ? { apiClient: options.apiClient } : {}),
    harness: 'wavemill',
    integrationId: options.integrationId,
    capabilities: options.supportsCorrelationReplay
      ? ['correlation-replay']
      : [],
    formatCorrelation(record) {
      return `${options.integrationId}:${record.correlationId}`;
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

export function createWavemillModelProvider(
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
            prompt: 'Wavemill task',
          },
          harness: {
            name: 'wavemill',
          },
        },
      });
    },
  },
  models: createWavemillModelProvider([
    {
      id: 'wavemill/default',
      provider: 'wavemill',
      family: 'wavemill',
      capabilities: ['reasoning'],
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
          status: 'completed',
          summary: 'Completed by Wavemill',
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
