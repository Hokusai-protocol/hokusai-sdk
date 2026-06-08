import {
  ANTHROPIC_MODELS,
  FilePluginConfigStore,
  InMemoryModelRegistry,
  defaultPluginConfigPath,
  loadPluginConfig,
  renderDoctorReport,
  runDoctor,
  validateRecommendedModel,
  type HarnessAdapter,
  type HarnessDiscoveredModel,
  type HarnessModelProvider,
  type HokusaiClient,
  type HokusaiPluginConfig,
  type HokusaiTaskInput,
  type ModelDefinition,
  type ModelRegistry,
  type LoadPluginConfigOptions,
  type RunDoctorInput,
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
  pluginConfig?: HokusaiPluginConfig;
}

export interface ClaudeCodeAdapter {
  apiClient?: HokusaiClient;
  harness: 'claude-code';
  commands: Array<{
    name: 'hokusai.run' | 'hokusai.doctor';
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
      {
        name: 'hokusai.doctor',
        description: 'Inspect Hokusai auth, consent, reachability, and allowlist state.',
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
  allowlist?: string[];
}): HarnessModelProvider {
  const registry = options?.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const allowlist =
    options?.allowlist ?? ANTHROPIC_MODELS.map((model) => model.id);

  return {
    discoverModels() {
      return Promise.resolve({
        ok: true,
        value: registry
          .listAvailable()
          .filter((model) => model.provider === 'anthropic')
          .filter((model) =>
            validateRecommendedModel(model.id, {
              allowlist,
              registry,
            }).ok,
          )
          .map(toDiscoveredModel),
      });
    },
    mapModel(request) {
      const validation = validateRecommendedModel(request.harnessModelId, {
        allowlist,
        registry,
      });

      if (validation.ok) {
        const model = registry.get(validation.modelId);
        if (!model) {
          return Promise.resolve({
            ok: false,
            error: {
              code: 'UNKNOWN_MODEL',
              message: `Unsupported model recommendation: ${validation.modelId}.`,
            },
          });
        }

        return Promise.resolve({
          ok: true,
          value: {
            id: model.id,
            provider: model.provider,
            capabilities: model.capabilities,
          },
        });
      }

      const code =
        validation.reason === 'not-anthropic'
          ? 'PROVIDER_NOT_ALLOWED'
          : validation.reason === 'not-in-allowlist'
            ? 'MODEL_NOT_ALLOWED'
            : 'UNKNOWN_MODEL';
      const message =
        validation.reason === 'not-anthropic'
          ? `Model ${request.harnessModelId} is not supported by this harness.`
          : validation.reason === 'not-in-allowlist'
            ? `Model ${request.harnessModelId} is not permitted by the configured allowlist.`
            : `Unsupported model recommendation: ${request.harnessModelId}.`;

      return Promise.resolve({
        ok: false,
        error: {
          code,
          message,
          details: {
            suggestions: validation.suggestions,
          },
        },
      });
    },
  };
}

export async function loadClaudeCodePluginConfig(
  options: Omit<LoadPluginConfigOptions, 'store'> & {
    configPath?: string;
  } = {},
): Promise<HokusaiPluginConfig> {
  const { configPath, ...loadOptions } = options;
  const store = configPath
    ? new FilePluginConfigStore(configPath)
    : undefined;

  return loadPluginConfig({
    registry: options.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS),
    ...(store ? { store } : {}),
    ...loadOptions,
  });
}

export function createClaudeCodeDoctor(
  options: Omit<RunDoctorInput, 'registry'>,
): {
  run(): Promise<{ report: Awaited<ReturnType<typeof runDoctor>>; rendered: string }>;
} {
  return {
    async run() {
      const report = await runDoctor({
        ...options,
        registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
      });

      return {
        report,
        rendered: renderDoctorReport(report),
      };
    },
  };
}

export { defaultPluginConfigPath };

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
