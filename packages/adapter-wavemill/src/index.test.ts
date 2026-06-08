import { describe, expect, it } from 'vitest';
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
} from '@hokusai/core';
import {
  createWavemillAdapter,
  createWavemillHarnessAdapter,
  createWavemillModelProvider,
  reportWavemillOutcome,
  routeWithWavemill,
} from './index.js';

interface TestTransportInit {
  body?: string;
}

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

  it('returns a live HarnessAdapter surface', async () => {
    const adapter = createWavemillHarnessAdapter({
      integrationId: 'wavemill-reference',
      supportsCorrelationReplay: true,
    });

    const context = await adapter.context.collectTaskContext({
      taskId: 'task-1',
    });
    expect(context.ok).toBe(true);

    const discovered = await adapter.models.discoverModels({
      task: { id: 'task-1', prompt: 'test' },
    });
    expect(discovered.ok).toBe(true);

    const consent = await adapter.consent.promptConsent({
      scope: 'task-execution',
      reason: 'test',
    });
    expect(consent).toEqual({
      ok: true,
      value: {
        outcome: 'granted',
        scope: 'task-execution',
      },
    });

    const outcome = await adapter.outcomes.collectOutcome({
      task: { id: 'task-1', prompt: 'test' },
      model: {
        id: 'wavemill/default',
        provider: 'wavemill',
        capabilities: ['reasoning'],
      },
    });
    expect(outcome.ok).toBe(true);

    const preview = adapter.payloads.previewPayload({
      payload: {
        task: { id: 'task-1', prompt: 'Fix the Wavemill Labs task.' },
        prompt: 'Fix the Wavemill Labs task.',
        consent: {
          grantedScopes: ['task-execution'],
          subjectId: 'subject-1',
        },
        model: {
          id: 'wavemill/default',
          provider: 'wavemill',
          capabilities: ['reasoning'],
        },
        correlation: {
          taskId: 'task-1',
          correlationId: 'corr-1',
          createdAt: '2026-06-08T12:00:00.000Z',
        },
        redactions: [],
        createdAt: '2026-06-08T12:00:00.000Z',
      },
    });
    expect(preview).toEqual({
      ok: true,
      value: {
        summary: 'Preview task-1 with replay support',
        promptPreview: 'Fix the Wavemill Labs task.',
        redactionCount: 0,
      },
    });

    await adapter.storage.set('key', 'value');
    expect(await adapter.storage.get('key')).toEqual({
      ok: true,
      value: 'value',
    });
    expect(await adapter.storage.delete('key')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('routes with the shared dispatch builder and client', async () => {
    let requestBody = '';
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport: (_input: string, init: TestTransportInit) => {
        requestBody = init.body ?? '';
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(
              JSON.stringify({
                routeId: 'route_123',
                taskId: 'task-1',
                status: 'accepted',
              }),
            ),
        });
      },
    });
    const dispatchBuilder = new HokusaiDispatchBuilder({
      consent: {
        subjectId: 'subject-1',
        grantedScopes: ['task-execution'],
      },
      modelRegistry: new InMemoryModelRegistry([
        {
          id: 'wavemill/default',
          provider: 'wavemill',
          family: 'wavemill',
          capabilities: ['reasoning'],
          default: true,
        },
      ]),
      clock: () => new Date('2026-06-08T12:00:00.000Z'),
    });

    const response = await routeWithWavemill({
      client,
      dispatchBuilder,
      task: {
        id: 'task-1',
        prompt: 'Route this task.',
      },
      modelId: 'wavemill/default',
    });

    expect(response).toMatchObject({
      routeId: 'route_123',
      taskId: 'task-1',
      status: 'accepted',
    });
    expect(JSON.parse(requestBody)).toMatchObject({
      task: {
        id: 'task-1',
        prompt: 'Route this task.',
      },
      model: {
        id: 'wavemill/default',
      },
    });
  });

  it('reports outcomes with the canonical Wavemill report builder', async () => {
    let requestBody = '';
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport: (_input: string, init: TestTransportInit) => {
        requestBody = init.body ?? '';
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(
              JSON.stringify({
                taskId: 'task-1',
                status: 'accepted',
              }),
            ),
        });
      },
    });

    const response = await reportWavemillOutcome({
      client,
      input: {
        correlationId: 'route-wavemill-001',
        recommendedModel: 'gpt-5-codex',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'medium',
        costBucket: 'high',
        tokenBucket: 'high',
        spendUsdBucket: '0.50-1.00',
        wallClockMinutes: 18,
      },
    });

    expect(response).toEqual({
      requestId: expect.any(String),
      status: 'accepted',
      taskId: 'task-1',
    });
    expect(JSON.parse(requestBody)).toMatchObject({
      correlationId: 'route-wavemill-001',
      extensions: {
        version: '2026-06',
        data: {
          harness: 'wavemill',
          spendUsdBucket: '0.50-1.00',
          wallClockMinutes: 18,
        },
      },
    });
  });
});
