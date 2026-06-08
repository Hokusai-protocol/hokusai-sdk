import { describe, expect, it } from 'vitest';
import { createCodexAdapter } from './index.js';

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
});
