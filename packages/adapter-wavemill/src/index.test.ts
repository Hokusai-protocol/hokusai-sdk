import { describe, expect, it } from 'vitest';
import { HokusaiClient } from '@hokusai/core';
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

  it('creates a HokusaiClient by default', () => {
    const adapter = createWavemillAdapter({ integrationId: 'wavemill-test' });
    expect(adapter.client).toBeInstanceOf(HokusaiClient);
  });

  it('accepts a pre-built HokusaiClient', () => {
    const sharedClient = new HokusaiClient({ apiKey: 'sk-test' });
    const adapter = createWavemillAdapter({
      integrationId: 'wavemill-test',
      client: sharedClient,
    });

    expect(adapter.client).toBe(sharedClient);
  });

  it('accepts clientOptions and constructs the client from them', () => {
    const adapter = createWavemillAdapter({
      integrationId: 'wavemill-test',
      clientOptions: { apiKey: 'sk-from-options' },
    });

    expect(adapter.client).toBeInstanceOf(HokusaiClient);
  });

  it('formatCorrelation returns integrationId-prefixed value', () => {
    const adapter = createWavemillAdapter({ integrationId: 'wavemill-abc' });
    const formatted = adapter.formatCorrelation({
      taskId: 't1',
      correlationId: 'corr-123',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(formatted).toBe('wavemill-abc:corr-123');
  });
});
