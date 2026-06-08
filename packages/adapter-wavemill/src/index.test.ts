import { describe, expect, it } from 'vitest';
import { createWavemillAdapter } from './index.js';

describe('createWavemillAdapter', () => {
  it('returns a reference integration contract without private dependencies', () => {
    const adapter = createWavemillAdapter({
      integrationId: 'wavemill-reference',
      supportsCorrelationReplay: true,
    });

    expect(adapter.harness).toBe('wavemill');
    expect(adapter.capabilities).toContain('correlation-replay');
    expect(adapter.integrationId).toBe('wavemill-reference');
  });
});
