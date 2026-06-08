import { describe, expect, it } from 'vitest';
import { createCodexAdapter, createCodexModelProvider } from './index.js';

describe('createCodexAdapter', () => {
  it('returns a stable command surface', () => {
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
    });

    expect(adapter.harness).toBe('codex');
    expect(adapter.commands[0]?.name).toBe('hokusai:run');
    expect(adapter.manifest.pluginId).toBe('hokusai.codex');
  });

  it('maps configured models', async () => {
    const provider = createCodexModelProvider([
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt',
        capabilities: ['reasoning', 'tool-use'],
      },
    ]);

    const mapped = await provider.mapModel({
      harnessModelId: 'gpt-5-codex',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped).toEqual({
      ok: true,
      value: {
        id: 'gpt-5-codex',
        provider: 'openai',
        capabilities: ['reasoning', 'tool-use'],
      },
    });
  });

  it('returns structured unknown-model errors', async () => {
    const provider = createCodexModelProvider([
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt',
        capabilities: ['reasoning', 'tool-use'],
      },
    ]);

    const mapped = await provider.mapModel({
      harnessModelId: 'missing-model',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped.ok).toBe(false);
    if (mapped.ok) {
      return;
    }
    expect(mapped.error.code).toBe('UNKNOWN_MODEL');
  });
});
