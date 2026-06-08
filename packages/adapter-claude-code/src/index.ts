import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ANTHROPIC_MODELS,
  InMemoryModelRegistry,
  ModelMappingError,
  mapRecommendation,
  type AdapterResult,
  type ConsentConfig,
  type HarnessAdapter,
  type HarnessDiscoveredModel,
  type HarnessModelHandoff,
  type HarnessModelHandoffRequest,
  type HarnessModelProvider,
  type HokusaiClient,
  type HokusaiTaskInput,
  type ModelDefinition,
  type ModelRegistry,
} from '@hokusai/core';
import {
  getClaudeCodeStateFilePath,
  resolveClaudeCodeConfigPath,
} from './config-path.js';
import {
  displayTaskRecommendation,
  type RecommendationDisplay,
} from './commands.js';

export {
  clearClaudeCodeLocalState,
  displayTaskRecommendation,
  previewTaskPayload,
  reportTaskOutcome,
  routeTask,
  runDoctor,
  type ClaudeCodeCommandOptions,
  type DoctorResult,
  type PayloadPreviewResult,
  type RecommendationDisplay,
  type ReportOutcomeInput,
  type ReportOutcomeResult,
  type RouteInput,
  type RouteResult,
  type RouteSuccess,
} from './commands.js';
export {
  CLAUDE_CODE_STATE_FILE,
  getClaudeCodeStateFilePath,
  resolveClaudeCodeConfigPath,
  type ClaudeCodeConfigPath,
} from './config-path.js';
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

export interface ClaudeCodeHarnessAdapterOptions {
  apiClient?: HokusaiClient;
  configPath: string;
  consent?: ConsentConfig;
  registry?: ModelRegistry;
  handoff?: HarnessModelHandoff;
}

function ok<T>(value: T): AdapterResult<T> {
  return {
    ok: true,
    value,
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

async function readStateFile(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => {
        const [, value] = entry;
        return typeof value === 'string';
        },
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    return {};
  }
}

async function writeStateFile(
  filePath: string,
  state: Record<string, string>,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
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

export function createClaudeCodeHarnessAdapter(
  options: ClaudeCodeHarnessAdapterOptions,
): HarnessAdapter {
  const config = resolveClaudeCodeConfigPath({ override: options.configPath });
  const modelProvider = createClaudeCodeModelProvider(
    options.registry ? { registry: options.registry } : undefined,
  );
  const stateFilePath = getClaudeCodeStateFilePath(config.dir);
  const handoff = options.handoff;

  return {
    context: {
      collectTaskContext(request) {
        return Promise.resolve(
          ok({
            task: {
              id: request.taskId ?? 'claude-code-task',
              prompt: '',
            },
            harness: {
              name: 'claude-code',
            },
            configPath: config.dir,
            command: 'hokusai.route',
          }),
        );
      },
    },
    models: modelProvider,
    recommendations: {
      displayRecommendation(request) {
        const formatted: RecommendationDisplay = displayTaskRecommendation(
          request.recommendation,
        );
        void formatted;
        return ok(undefined);
      },
    },
    ...(handoff
      ? {
          handoff: {
            handoff(request: HarnessModelHandoffRequest) {
              return handoff.handoff(request);
            },
          },
        }
      : {}),
    outcomes: {
      collectOutcome(request) {
        return Promise.resolve(
          ok({
            taskId: request.task.id,
            status: 'accepted',
            summary: `Task ${request.task.id} accepted by Claude Code`,
          }),
        );
      },
    },
    payloads: {
      previewPayload(request) {
        return ok({
          summary: `Task ${request.payload.task.id} (model: ${request.payload.model.id})`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        });
      },
    },
    consent: {
      promptConsent(request) {
        return Promise.resolve(
          ok({
            outcome: 'granted',
            scope: request.scope,
          }),
        );
      },
    },
    storage: {
      async get(key) {
        const state = await readStateFile(stateFilePath);
        return ok(state[key]);
      },
      async set(key, value) {
        const state = await readStateFile(stateFilePath);
        state[key] = value;
        await writeStateFile(stateFilePath, state);
        return ok(undefined);
      },
      async delete(key) {
        const state = await readStateFile(stateFilePath);
        delete state[key];

        if (Object.keys(state).length === 0) {
          await rm(stateFilePath, { force: true });
        } else {
          await writeStateFile(stateFilePath, state);
        }

        return ok(undefined);
      },
    },
  } satisfies HarnessAdapter;
}
