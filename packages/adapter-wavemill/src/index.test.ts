import { describe, expect, it } from 'vitest';
import { HokusaiClient } from '@hokusai/core';
import { createWavemillAdapter } from './index.js';

describe('createWavemillAdapter', () => {
  it('returns a reference integration contract without private dependencies', () => {
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

    const adapter = createWavemillAdapter({
      apiClient,
      integrationId: 'wavemill-reference',
      supportsCorrelationReplay: true,
    });

    expect(adapter.harness).toBe('wavemill');
    expect(adapter.apiClient).toBe(apiClient);
    expect(adapter.capabilities).toContain('correlation-replay');
    expect(adapter.integrationId).toBe('wavemill-reference');
  });
});
