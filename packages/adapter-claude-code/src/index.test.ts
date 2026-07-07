import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HokusaiDispatchPayload } from '@hokusai/core';
import {
  buildClaudeCodeTaskPacket,
  createClaudeCodeAdapter,
  createClaudeCodeDoctor,
  createClaudeCodeHarnessAdapter,
  createClaudeCodeModelProvider,
  declineRecommendation,
  displayHandoff,
  loadClaudeCodePluginConfig,
} from './index.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('createClaudeCodeAdapter', () => {
  it('returns stable manifest and command metadata', () => {
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.1',
    });

    expect(adapter.harness).toBe('claude-code');
    expect(adapter.commands[0]?.name).toBe('hokusai.run');
    expect(adapter.commands[1]?.name).toBe('hokusai.doctor');
    expect(adapter.manifest.entrypoint).toBe('hokusai');
  });

  it('re-exports the task packet builder', () => {
    expect(buildClaudeCodeTaskPacket).toBeTypeOf('function');
  });

  it('re-exports the handoff and decline helpers', () => {
    expect(displayHandoff).toBeTypeOf('function');
    expect(declineRecommendation).toBeTypeOf('function');
  });

  it('uses Anthropic defaults for model discovery and mapping', async () => {
    const provider = createClaudeCodeModelProvider();

    const discovered = await provider.discoverModels({
      task: { id: 'task-1', prompt: 'test' },
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) {
      return;
    }
    expect(discovered.value.map((model) => model.id)).toContain(
      'claude-sonnet-4-6',
    );

    const mapped = await provider.mapModel({
      harnessModelId: 'claude-sonnet-4-6',
      discoveredModels: [],
      availableModels: [],
    });
    expect(mapped).toEqual({
      ok: true,
      value: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
      },
    });
  });

  it('resolves Anthropic aliases', async () => {
    const provider = createClaudeCodeModelProvider();
    const mapped = await provider.mapModel({
      harnessModelId: 'sonnet',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }
    expect(mapped.value.id).toBe('claude-sonnet-4-6');
  });

  it('enforces the configured allowlist during discovery and mapping', async () => {
    const provider = createClaudeCodeModelProvider({
      allowlist: ['claude-haiku-4-5-20251001'],
    });

    const discovered = await provider.discoverModels({
      task: { id: 'task-1', prompt: 'test' },
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) {
      return;
    }
    expect(discovered.value.map((model) => model.id)).toEqual([
      'claude-haiku-4-5-20251001',
    ]);

    const mapped = await provider.mapModel({
      harnessModelId: 'claude-sonnet-4-6',
      discoveredModels: [],
      availableModels: [],
    });
    expect(mapped.ok).toBe(false);
    if (mapped.ok) {
      return;
    }
    expect(mapped.error.code).toBe('MODEL_NOT_ALLOWED');
  });

  it('rejects non-Anthropic models with suggestions', async () => {
    const provider = createClaudeCodeModelProvider({
      registry: {
        get(modelId) {
          return this.list().find((model) => model.id === modelId);
        },
        getDefault() {
          return this.list()[0];
        },
        list() {
          return [
            {
              id: 'claude-sonnet-4-6',
              provider: 'anthropic',
              family: 'claude',
              aliases: ['sonnet'],
              capabilities: ['reasoning', 'streaming', 'tool-use'],
              default: true,
            },
            {
              id: 'gpt-5-codex',
              provider: 'openai',
              family: 'gpt',
              capabilities: ['reasoning', 'tool-use'],
            },
          ];
        },
        listAvailable() {
          return this.list();
        },
        resolve(modelId) {
          const normalizedModelId = modelId.toLowerCase();
          return this.list().find(
            (model) =>
              model.id.toLowerCase() === normalizedModelId ||
              model.aliases?.some((alias) => alias.toLowerCase() === normalizedModelId),
          );
        },
      },
    });

    const mapped = await provider.mapModel({
      harnessModelId: 'gpt-5-codex',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped.ok).toBe(false);
    if (mapped.ok) {
      return;
    }
    expect(mapped.error.code).toBe('PROVIDER_NOT_ALLOWED');
    expect(mapped.error.details?.suggestions).toEqual(['claude-sonnet-4-6']);
  });

  it('creates a doctor helper with the expected report shape', async () => {
    const doctor = createClaudeCodeDoctor({
      config: {
        apiKey: 'hk_live_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () => Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      }),
    });

    const result = await doctor.run();
    expect(result.report).toMatchObject({
      auth: 'configured',
      routingConsent: true,
      outcomeConsent: false,
      apiReachable: 'ok',
      allowlistCount: 1,
    });
    expect(result.rendered).toContain('Hokusai doctor');
  });

  it('loads plugin config with adapter defaults', async () => {
    const config = await loadClaudeCodePluginConfig({
      env: {
        HOKUSAI_API_KEY: 'hk_live_abcd',
        HOKUSAI_ROUTING_CONSENT: 'yes',
      },
    });

    expect(config).toMatchObject({
      apiKey: 'hk_live_abcd',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
    });
  });
});

describe('createClaudeCodeHarnessAdapter', () => {
  it('persists simple storage state and previews payloads', async () => {
    const configPath = await createTempDir('hokusai-claude-harness-');
    const adapter = createClaudeCodeHarnessAdapter({
      configPath,
    });

    await adapter.storage.set('key', 'value');
    expect(await adapter.storage.get('key')).toEqual({
      ok: true,
      value: 'value',
    });
    await adapter.storage.delete('key');
    expect(await adapter.storage.get('key')).toEqual({
      ok: true,
      value: undefined,
    });

    const discovered = await adapter.models.discoverModels({
      task: {
        id: 'task-1',
        prompt: 'test',
      },
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) {
      return;
    }
    expect(discovered.value.map((model) => model.id)).toContain('claude-sonnet-4-6');

    const payload: HokusaiDispatchPayload = {
      task: {
        id: 'task-1',
        prompt: 'Dispatch the task',
      },
      prompt: 'Dispatch the task',
      consent: {
        subjectId: 'claude-code',
        grantedScopes: ['task-execution'],
      },
      model: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
      },
      correlation: {
        taskId: 'task-1',
        correlationId: 'corr-123',
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      redactions: [{ label: 'email' }],
      createdAt: '2026-06-08T00:00:00.000Z',
    };

    expect(adapter.payloads.previewPayload({ payload })).toEqual({
      ok: true,
      value: {
        summary: 'Task task-1 (model: claude-sonnet-4-6)',
        promptPreview: 'Dispatch the task',
        redactionCount: 1,
      },
    });
  });

  it('treats a corrupt state file as empty state', async () => {
    const configPath = await createTempDir('hokusai-claude-corrupt-');
    await writeFile(path.join(configPath, 'state.json'), '{not-json', 'utf8');

    const adapter = createClaudeCodeHarnessAdapter({
      configPath,
    });

    expect(await adapter.storage.get('missing')).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
