import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from './index.js';

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
});
