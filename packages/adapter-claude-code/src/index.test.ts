import { describe, expect, it } from 'vitest';
import {
  createClaudeCodeAdapter,
  createClaudeCodeModelProvider,
} from './index.js';

describe('createClaudeCodeAdapter', () => {
  it('returns stable manifest and command metadata', () => {
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
    });

    expect(adapter.harness).toBe('claude-code');
    expect(adapter.commands[0]?.name).toBe('hokusai.run');
    expect(adapter.manifest.entrypoint).toBe('hokusai');
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
});
