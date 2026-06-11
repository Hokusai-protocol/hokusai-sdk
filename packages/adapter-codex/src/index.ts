import {
  InMemoryLocalStore,
  InMemoryModelRegistry,
  InvalidStoreIdError,
  ModelMappingError,
  mapRecommendation,
  type AdapterResult,
  type ConsentConfig,
  type HarnessAdapter,
  type HarnessConsentDecision,
  type HarnessConsentPromptRequest,
  type HarnessDiscoveredModel,
  type HarnessLocalStorage,
  type HarnessModelProvider,
  type HarnessOutcomeCollectionRequest,
  type HarnessOutcomeCollector,
  type HarnessPayloadPreviewRequest,
  type HarnessRecommendationDisplayRequest,
  type HokusaiClient,
  type HokusaiOutcome,
  type HokusaiTaskInput,
  type LocalStore,
  type ModelDefinition,
  type ModelRegistry,
} from '@hokusai/core';
import {
  CODEX_COMMAND_MANIFEST,
  previewRoutePayload,
  requestRecommendation,
  submitOutcome,
  type CodexCommandDescriptor,
  type PreviewRoutePayloadArgs,
  type RequestRecommendationArgs,
  type SubmitOutcomeArgs,
} from './commands.js';
import {
  buildCodexOutcomeReport,
  previewCodexOutcomeReport,
} from './outcome.js';
import {
  createCodexHarnessProfile,
  getApiBaseUrl,
  getApiKey,
  getRetentionDays,
  hasOutcomeOptIn,
  hasRoutingConsent,
  resolveCodexConfigDir,
} from './config.js';
import {
  latestRouteWithCodex,
  previewOutcomeWithCodex,
  previewRoutePayloadWithCodex,
  privacyStatusWithCodex,
  routeTaskWithCodex,
  submitOutcomeWithCodex,
  type CodexOutcomeInput,
  type CodexPluginCommandOptions,
  type CodexRouteInput,
} from './plugin-commands.js';
import { runMcpServer } from './mcp-server.js';
import { createOpenAiRegistry, OPENAI_MODELS } from './registry.js';
import {
  buildCodexHarnessTaskContext,
  buildCodexTaskPacket,
  buildCodexTaskPacketFromText,
  previewCodexTaskPacket,
  previewCodexTaskPacketFromText,
  type CodexRepositorySignals,
  type CodexSessionTelemetry,
  type CodexTaskContextBuilderOptions,
  type CodexTaskPacketBuildResult,
  type CodexTaskPacketPreview,
  type CodexTaskTextBuilderOptions,
} from './task-context.js';

export {
  CODEX_COMMAND_MANIFEST,
  OPENAI_MODELS,
  buildCodexOutcomeReport,
  createCodexHarnessProfile,
  createOpenAiRegistry,
  getApiBaseUrl,
  getApiKey,
  getRetentionDays,
  hasOutcomeOptIn,
  hasRoutingConsent,
  latestRouteWithCodex,
  buildCodexTaskPacket,
  buildCodexTaskPacketFromText,
  previewCodexOutcomeReport,
  previewOutcomeWithCodex,
  previewCodexTaskPacket,
  previewCodexTaskPacketFromText,
  previewRoutePayloadWithCodex,
  privacyStatusWithCodex,
  previewRoutePayload,
  requestRecommendation,
  resolveCodexConfigDir,
  routeTaskWithCodex,
  runMcpServer,
  submitOutcome,
  submitOutcomeWithCodex,
  type CodexCommandDescriptor,
  type CodexOutcomeInput,
  type CodexPluginCommandOptions,
  type CodexRepositorySignals,
  type CodexRouteInput,
  type CodexSessionTelemetry,
  type CodexTaskContextBuilderOptions,
  type CodexTaskPacketBuildResult,
  type CodexTaskPacketPreview,
  type CodexTaskTextBuilderOptions,
  type PreviewRoutePayloadArgs,
  type RequestRecommendationArgs,
  type SubmitOutcomeArgs,
};

export interface CodexAdapterOptions {
  apiClient?: HokusaiClient;
  defaultModel: string;
  pluginId: string;
  version?: string;
}

export interface CodexAdapter {
  apiClient?: HokusaiClient;
  harness: 'codex';
  commands: CodexCommandDescriptor[];
  manifest: {
    pluginId: string;
    defaultModel: string;
    version?: string;
  };
  requestRecommendation(
    args: Omit<RequestRecommendationArgs, 'client'> & { client?: HokusaiClient },
  ): ReturnType<typeof requestRecommendation>;
  previewRoutePayload(
    args: PreviewRoutePayloadArgs,
  ): ReturnType<typeof previewRoutePayload>;
  submitOutcome(
    args: Omit<SubmitOutcomeArgs, 'client'> & { client?: HokusaiClient },
  ): ReturnType<typeof submitOutcome>;
  toTaskReference(task: HokusaiTaskInput): string;
}

export interface CreateCodexModelProviderOptions {
  registry?: ModelRegistry;
}

export interface CodexHarnessAdapterOptions {
  clock?: () => Date;
  consent?: ConsentConfig;
  defaultModel: string;
  models?: ModelDefinition[];
  recommendation?: (
    request: HarnessRecommendationDisplayRequest,
  ) => AdapterResult<void> | Promise<AdapterResult<void>>;
  redactionConfig: CodexTaskContextBuilderOptions['redactionConfig'];
  store?: LocalStore;
  telemetry?: (
    request: { taskId?: string },
  ) => CodexSessionTelemetry | Promise<CodexSessionTelemetry>;
  version?: string;
  outcomeCollector?: (
    request: HarnessOutcomeCollectionRequest,
  ) => AdapterResult<HokusaiOutcome> | Promise<AdapterResult<HokusaiOutcome>>;
  consentPrompter?: (
    request: HarnessConsentPromptRequest,
  ) => AdapterResult<HarnessConsentDecision> | Promise<AdapterResult<HarnessConsentDecision>>;
}

export function createCodexAdapter(options: CodexAdapterOptions): CodexAdapter {
  return {
    ...(options.apiClient ? { apiClient: options.apiClient } : {}),
    harness: 'codex',
    commands: [...CODEX_COMMAND_MANIFEST],
    manifest: {
      pluginId: options.pluginId,
      defaultModel: options.defaultModel,
      ...(options.version ? { version: options.version } : {}),
    },
    requestRecommendation(args) {
      return requestRecommendation({
        ...args,
        ...(args.client ?? options.apiClient
          ? { client: args.client ?? options.apiClient }
          : {}),
      });
    },
    previewRoutePayload(args) {
      return previewRoutePayload(args);
    },
    submitOutcome(args) {
      return submitOutcome({
        ...args,
        ...(args.client ?? options.apiClient
          ? { client: args.client ?? options.apiClient }
          : {}),
      });
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

export function createCodexModelProvider(
  models: ModelDefinition[],
  options: CreateCodexModelProviderOptions = {},
): HarnessModelProvider {
  const registry = options.registry ?? new InMemoryModelRegistry(models);

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

export function createCodexHarnessAdapter(
  options: CodexHarnessAdapterOptions,
): HarnessAdapter {
  const profile = createCodexHarnessProfile();
  const store = options.store ?? new InMemoryLocalStore();
  const clock = options.clock ?? (() => new Date());
  const storage = createHarnessStorage(store, clock);
  const modelDefinitions = options.models ?? profile.registry.list();
  const defaultModelId =
    modelDefinitions.find((model) => model.id === options.defaultModel)?.id ??
    profile.defaultModelId ??
    options.defaultModel;
  const models = createCodexModelProvider(modelDefinitions);

  return {
    context: {
      async collectTaskContext(request) {
        const telemetry = await (options.telemetry?.(request) ??
          Promise.resolve({
            taskId: request.taskId ?? 'codex-task-1',
            taskSummary: `Codex task for ${defaultModelId}`,
            model: defaultModelId,
          }));

        return {
          ok: true,
          value: buildCodexHarnessTaskContext(telemetry, {
            redactionConfig: options.redactionConfig,
          }),
        };
      },
    },
    models,
    recommendations: {
      displayRecommendation(request) {
        if (options.recommendation) {
          return options.recommendation(request);
        }

        return {
          ok: true,
          value: undefined,
        };
      },
    },
    outcomes: createOutcomeCollector(options.outcomeCollector),
    payloads: {
      previewPayload(request: HarnessPayloadPreviewRequest) {
        return {
          ok: true,
          value: {
            summary: `Dispatch ${request.payload.task.id} with ${request.payload.model.id}`,
            promptPreview: request.payload.prompt,
            redactionCount: request.payload.redactions.length,
          },
        };
      },
    },
    consent: {
      async promptConsent(request) {
        if (options.consentPrompter) {
          return Promise.resolve(options.consentPrompter(request));
        }

        return Promise.resolve({
          ok: true,
          value: {
            outcome:
              request.scope === 'task-execution' ? 'granted' : 'dismissed',
            scope: request.scope,
          },
        });
      },
    },
    storage,
  };
}

function createOutcomeCollector(
  collector:
    | ((
        request: HarnessOutcomeCollectionRequest,
      ) => AdapterResult<HokusaiOutcome> | Promise<AdapterResult<HokusaiOutcome>>)
    | undefined,
): HarnessOutcomeCollector {
  return {
    async collectOutcome(request) {
      if (collector) {
        return collector(request);
      }

      return {
        ok: true,
        value: {
          taskId: request.task.id,
          status: 'accepted',
          summary: 'Accepted by Codex',
        },
      };
    },
  };
}

function createHarnessStorage(
  store: LocalStore,
  clock: () => Date,
): HarnessLocalStorage {
  return {
    async get(key) {
      try {
        const record = await store.getCorrelation(key);
        return {
          ok: true,
          value: record?.metadata?.value,
        };
      } catch (error) {
        return toStorageFailure(error);
      }
    },
    async set(key, value) {
      try {
        await store.putCorrelation({
          correlationId: key,
          packetHash: 'codex-state',
          createdAt: clock().getTime(),
          metadata: { value },
        });
        return {
          ok: true,
          value: undefined,
        };
      } catch (error) {
        return toStorageFailure(error);
      }
    },
    async delete(key) {
      try {
        await store.deleteCorrelation(key);
        return {
          ok: true,
          value: undefined,
        };
      } catch (error) {
        return toStorageFailure(error);
      }
    },
  };
}

function toStorageFailure(error: unknown): AdapterResult<never> {
  if (error instanceof InvalidStoreIdError) {
    return {
      ok: false,
      error: {
        code: 'invalid_storage_key',
        message: error.message,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'storage_failure',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
