import { describe, expect, it } from 'vitest';
import { HokusaiClient } from '@hokusai/core';
import {
  buildClaudeCodeTaskPacket,
  createClaudeCodeAdapter,
} from './index.js';

describe('createClaudeCodeAdapter', () => {
  it('returns stable manifest and command metadata', () => {
    const apiClient = new HokusaiClient({
      apiKey: 'k_test',
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(
              JSON.stringify({
                routeId: 'route-1',
                taskId: 'task-1',
                status: 'accepted',
              }),
            ),
        }),
    });

    const adapter = createClaudeCodeAdapter({
      apiClient,
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
    });

    expect(adapter.apiClient).toBe(apiClient);
    expect(adapter.harness).toBe('claude-code');
    expect(adapter.commands[0]?.name).toBe('hokusai.run');
    expect(adapter.manifest.entrypoint).toBe('hokusai');
  });

  it('re-exports the task packet builder', () => {
    expect(buildClaudeCodeTaskPacket).toBeTypeOf('function');
  });
});
