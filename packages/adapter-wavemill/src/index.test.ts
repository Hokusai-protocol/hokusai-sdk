import { describe, expect, it } from 'vitest';
import {
  createWavemillAdapter,
  createWavemillModelProvider,
} from './index.js';

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

  it('maps configured models', async () => {
    const provider = createWavemillModelProvider([
      {
        id: 'wavemill/default',
        provider: 'wavemill',
        family: 'wavemill',
        capabilities: ['reasoning'],
      },
    ]);

    const mapped = await provider.mapModel({
      harnessModelId: 'wavemill/default',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped).toEqual({
      ok: true,
      value: {
        id: 'wavemill/default',
        provider: 'wavemill',
        capabilities: ['reasoning'],
      },
    });
  });

  it('returns unavailable-model errors', async () => {
    const provider = createWavemillModelProvider([
      {
        id: 'wavemill/default',
        provider: 'wavemill',
        family: 'wavemill',
        capabilities: ['reasoning'],
        available: false,
      },
    ]);

    const mapped = await provider.mapModel({
      harnessModelId: 'wavemill/default',
      discoveredModels: [],
      availableModels: [],
    });

    expect(mapped.ok).toBe(false);
    if (mapped.ok) {
      return;
    }
    expect(mapped.error.code).toBe('MODEL_UNAVAILABLE');
  });
});
