import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_REDACTION_CONFIG } from '../anonymization.js';
import { createRouteTask } from './commands.js';
import type { HarnessProfile } from './harness-profile.js';
import { InMemoryModelRegistry } from '../model-registry.js';
import type { ModelCapability } from '../model-registry.js';
import { buildTaskPacket } from '../task-packet.js';
import type { SharedCommandOptions } from './types.js';

interface TestRouteInput {
  taskText: string;
  taskId?: string;
  modelId?: string;
  metadata?: Record<string, string>;
  providerConstraints?: string[];
}

interface TestBuilderOptions {
  redactionConfig: typeof DEFAULT_REDACTION_CONFIG;
  clock?: () => Date;
}

const tempDirs: string[] = [];
const DEFAULT_CAPABILITIES: ModelCapability[] = ['reasoning', 'tool-use'];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function createProfile(
  configDir: string,
  options: {
    allowedProviders?: string[];
    defaultModel: {
      id: string;
      provider: string;
    };
    additionalModels?: Array<{
      id: string;
      provider: string;
    }>;
  },
): HarnessProfile<TestRouteInput, TestBuilderOptions, { willSend: unknown }, SharedCommandOptions> {
  const registry = new InMemoryModelRegistry([
    {
      id: options.defaultModel.id,
      provider: options.defaultModel.provider,
      family: options.defaultModel.provider,
      capabilities: [...DEFAULT_CAPABILITIES],
      default: true,
    },
    ...(options.additionalModels ?? []).map((model) => ({
      id: model.id,
      provider: model.provider,
      family: model.provider,
      capabilities: [...DEFAULT_CAPABILITIES],
    })),
  ]);

  return {
    harness: 'test-harness',
    harnessLabel: 'Test Harness',
    defaultSubjectId: 'test-harness',
    resolveConfigPath() {
      return { dir: configDir, exists: true };
    },
    createBuilderOptions(input) {
      return {
        redactionConfig: DEFAULT_REDACTION_CONFIG,
        ...(input?.clock ? { clock: input.clock } : {}),
      };
    },
    buildTaskPacket(input) {
      return {
        packet: buildTaskPacket({
          userIntent: input.taskText,
          taskFamily: 'feature',
          ...(input.providerConstraints
            ? { providerConstraints: input.providerConstraints }
            : {}),
        }),
        redactionSummary: [],
      };
    },
    previewTaskPacket(input) {
      return {
        willSend: {
          taskText: input.taskText,
          providerConstraints: input.providerConstraints,
        },
      };
    },
    toTaskId(input, clock) {
      return input.taskId ?? `task-${(clock ?? (() => new Date()))().getTime()}`;
    },
    toPrompt(packet) {
      return JSON.stringify(packet, null, 2);
    },
    modelCatalog: {
      registry,
      ...(options.allowedProviders ? { allowedProviders: options.allowedProviders } : {}),
      requireAvailable: true,
    },
    buildHandoff({ recommendation }) {
      return {
        mechanism: 'manual',
        slashCommand: `/model ${recommendation.model.id}`,
        copyableCommand: `/model ${recommendation.model.id}`,
        instructions: [],
      };
    },
    renderHandoff(handoff) {
      return [handoff.copyableCommand ?? handoff.slashCommand];
    },
    defaultRecommendationReason: 'Default route reason.',
    routeRecommendationReason: 'Router recommendation reason.',
  };
}

describe('createRouteTask', () => {
  it('injects provider constraints into the outgoing task packet', async () => {
    const configDir = await createTempDir('hokusai-core-plugin-route-');
    const profile = createProfile(configDir, {
      allowedProviders: ['anthropic'],
      defaultModel: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
      },
    });
    const routeTask = createRouteTask(profile);
    let capturedPrompt = '';

    const result = await routeTask(
      {
        taskId: 'task-1',
        taskText: 'Route this task',
        providerConstraints: ['openai'],
      },
      {
        apiClient: {
          route: (payload: { prompt: string; task: { id: string } }) => {
            capturedPrompt = payload.prompt;
            return Promise.resolve({
              routeId: 'route-1',
              taskId: payload.task.id,
              status: 'accepted',
            });
          },
        } as never,
      },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(capturedPrompt)).toMatchObject({
      providerConstraints: ['anthropic'],
      modelConstraints: ['claude-sonnet-4-6'],
    });
  });

  it('derives model constraints from the active registry override', async () => {
    const configDir = await createTempDir('hokusai-core-plugin-models-');
    const profile = createProfile(configDir, {
      allowedProviders: ['anthropic'],
      defaultModel: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
      },
      additionalModels: [
        {
          id: 'claude-opus-4-8',
          provider: 'anthropic',
        },
      ],
    });
    const routeTask = createRouteTask(profile);
    let capturedPrompt = '';

    const result = await routeTask(
      {
        taskId: 'task-allowlist',
        taskText: 'Route this task',
      },
      {
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-opus-4-8',
            provider: 'anthropic',
            family: 'anthropic',
            capabilities: [...DEFAULT_CAPABILITIES],
            default: true,
          },
        ]),
        apiClient: {
          route: (payload: { prompt: string; task: { id: string } }) => {
            capturedPrompt = payload.prompt;
            return Promise.resolve({
              routeId: 'route-allowlist',
              taskId: payload.task.id,
              status: 'accepted',
            });
          },
        } as never,
      },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(capturedPrompt)).toMatchObject({
      providerConstraints: ['anthropic'],
      modelConstraints: ['claude-opus-4-8'],
    });
  });

  it('rejects router responses that violate the profile provider allowlist', async () => {
    const configDir = await createTempDir('hokusai-core-plugin-provider-');
    const profile = createProfile(configDir, {
      allowedProviders: ['anthropic'],
      defaultModel: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
      },
      additionalModels: [
        {
          id: 'gpt-5-codex',
          provider: 'openai',
        },
      ],
    });
    const routeTask = createRouteTask(profile);

    const result = await routeTask(
      {
        taskText: 'Need a route recommendation.',
      },
      {
        apiClient: {
          route: () =>
            Promise.resolve({
              routeId: 'route-2',
              taskId: 'task-2',
              status: 'accepted',
              recommendation: {
                model: 'gpt-5-codex',
                reason: 'Use OpenAI.',
              },
            }),
        } as never,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'PROVIDER_NOT_ALLOWED',
      }),
    });
  });

  it('allows unconstrained profiles to accept recommendations from any provider', async () => {
    const configDir = await createTempDir('hokusai-core-plugin-open-');
    const profile = createProfile(configDir, {
      defaultModel: {
        id: 'gpt-5-codex',
        provider: 'openai',
      },
      additionalModels: [
        {
          id: 'claude-sonnet-4-6',
          provider: 'anthropic',
        },
      ],
    });
    const routeTask = createRouteTask(profile);

    const result = await routeTask(
      {
        taskText: 'Let the router choose freely.',
      },
      {
        apiClient: {
          route: () =>
            Promise.resolve({
              routeId: 'route-3',
              taskId: 'task-3',
              status: 'accepted',
              recommendation: {
                model: 'claude-sonnet-4-6',
                reason: 'Anthropic fits best.',
              },
            }),
        } as never,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.recommendation.model).toMatchObject({
      id: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
  });
});
