import { describe, expect, it } from 'vitest';
import { HokusaiClient } from '@hokusai/core';
import { createCodexAdapter } from './index.js';

describe('createCodexAdapter', () => {
  it('returns a stable command surface', () => {
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

    const adapter = createCodexAdapter({
      apiClient,
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
    });

    expect(adapter.apiClient).toBe(apiClient);
    expect(adapter.harness).toBe('codex');
    expect(adapter.commands[0]?.name).toBe('hokusai:run');
    expect(adapter.manifest.pluginId).toBe('hokusai.codex');
  });
});
