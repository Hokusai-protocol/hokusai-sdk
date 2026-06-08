import {
  InMemoryModelRegistry,
  ModelMappingError,
  mapRecommendation,
  previewOutcomePayload,
  type CorrelationRecord,
  type HarnessAdapter,
  type HarnessDiscoveredModel,
  type HarnessModelProvider,
  type HokusaiClient,
  type HokusaiDispatchBuilder,
  type HokusaiDispatchPayload,
  type HokusaiOutcome,
  type HokusaiRequestOptions,
  type HokusaiTaskInput,
  type ModelDefinition,
  type ModelRegistry,
  type ModelSelection,
  type OutcomeResponse,
  type RouteResponse,
} from '@hokusai/core';
import {
  buildWavemillOutcomeReport,
  type WavemillOutcomeInput,
} from './outcome.js';
import { previewWavemillTaskPacket } from './task-packet.js';

export * from './fixtures.js';
export * from './outcome.js';
export * from './task-packet.js';

export interface WavemillAdapterOptions {
  apiClient?: HokusaiClient;
  integrationId: string;
  supportsCorrelationReplay?: boolean;
  models?: ModelDefinition[];
}

export interface WavemillAdapter {
  apiClient?: HokusaiClient;
  harness: 'wavemill';
  integrationId: string;
  capabilities: string[];
  formatCorrelation(record: CorrelationRecord): string;
}

export interface RouteWithWavemillOptions {
  client: HokusaiClient;
  dispatchBuilder: HokusaiDispatchBuilder;
  task: HokusaiTaskInput;
  modelId: string;
  requestOptions?: HokusaiRequestOptions;
}

export interface ReportWavemillOutcomeOptions {
  client: HokusaiClient;
  input: WavemillOutcomeInput;
  requestOptions?: HokusaiRequestOptions;
}

const DEFAULT_WAVEMILL_MODEL: ModelDefinition = {
  id: 'wavemill/default',
  provider: 'wavemill',
  family: 'wavemill',
  capabilities: ['reasoning'],
  default: true,
};

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

export function createWavemillHarnessAdapter(
  options: WavemillAdapterOptions,
): HarnessAdapter {
  const modelProvider = createWavemillModelProvider(
    options.models ?? [DEFAULT_WAVEMILL_MODEL],
  );
  const storage = new Map<string, string>();

  return {
    context: {
      collectTaskContext(request) {
        const taskId = request.taskId ?? `${options.integrationId}-task-1`;

        return Promise.resolve({
          ok: true,
          value: {
            task: {
              id: taskId,
              prompt: `Wavemill task for ${options.integrationId}`,
              metadata: {
                integrationId: options.integrationId,
              },
            },
            harness: {
              name: 'wavemill',
            },
            metadata: {
              integrationId: options.integrationId,
              supportsCorrelationReplay: String(
                options.supportsCorrelationReplay ?? false,
              ),
            },
          },
        });
      },
    },
    models: modelProvider,
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
        return Promise.resolve({
          ok: true,
          value: buildCollectedOutcome(request.task, request.model),
        });
      },
    },
    payloads: {
      previewPayload(request) {
        return {
          ok: true,
          value: previewPayload(request.payload, options.supportsCorrelationReplay),
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
        return Promise.resolve({
          ok: true,
          value: storage.get(key),
        });
      },
      set(key, value) {
        storage.set(key, value);
        return Promise.resolve({
          ok: true,
          value: undefined,
        });
      },
      delete(key) {
        storage.delete(key);
        return Promise.resolve({
          ok: true,
          value: undefined,
        });
      },
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

export async function routeWithWavemill(
  options: RouteWithWavemillOptions,
): Promise<RouteResponse> {
  const payload = await options.dispatchBuilder.prepareDispatch(
    options.task,
    options.modelId,
  );

  return options.client.route(
    payload,
    options.requestOptions,
  ) as Promise<RouteResponse>;
}

export async function reportWavemillOutcome(
  options: ReportWavemillOutcomeOptions,
): Promise<OutcomeResponse> {
  const report = buildWavemillOutcomeReport(options.input).report;

  return options.client.reportOutcome(
    report,
    options.requestOptions,
  ) as Promise<OutcomeResponse>;
}

function buildCollectedOutcome(
  task: HokusaiTaskInput,
  model: ModelSelection,
): HokusaiOutcome {
  return {
    taskId: task.id,
    status: 'completed',
    summary: `Completed by Wavemill using ${model.id}.`,
  };
}

function previewPayload(
  payload: HokusaiDispatchPayload,
  supportsCorrelationReplay: boolean | undefined,
): {
  summary: string;
  promptPreview: string;
  redactionCount: number;
} {
  const taskPreview = previewWavemillTaskPacket(
    {
      taskText: payload.task.prompt,
      ...(supportsCorrelationReplay
        ? { priorCorrelationId: payload.correlation.correlationId }
        : {}),
    },
    {
      redactionConfig: {
        salt: 'wavemill-preview',
      },
    },
  );
  const outcomePreview = previewOutcomePayload({
    correlationId: payload.correlation.correlationId,
    recommendedModel: payload.model.id,
    actualModel: payload.model.id,
    recommendationAccepted: true,
    completionStatus: 'partial',
    latencyBucket: 'medium',
    costBucket: 'medium',
    tokenBucket: 'medium',
  });

  return {
    summary: supportsCorrelationReplay
      ? `Preview ${payload.task.id} with replay support`
      : `Preview ${payload.task.id}`,
    promptPreview: taskPreview.willSend.userIntent,
    redactionCount:
      payload.redactions.length +
      taskPreview.redactionSummary.reduce((sum, item) => sum + item.count, 0) +
      (outcomePreview.notes ? 1 : 0),
  };
}
