import type { CorrelationRecord, HarnessAdapter } from '@hokusai/core';

export interface WavemillAdapterOptions {
  integrationId: string;
  supportsCorrelationReplay?: boolean;
}

export interface WavemillAdapter {
  harness: 'wavemill';
  integrationId: string;
  capabilities: string[];
  formatCorrelation(record: CorrelationRecord): string;
}

export function createWavemillAdapter(
  options: WavemillAdapterOptions,
): WavemillAdapter {
  return {
    harness: 'wavemill',
    integrationId: options.integrationId,
    capabilities: options.supportsCorrelationReplay
      ? ['correlation-replay']
      : [],
    formatCorrelation(record) {
      return `${options.integrationId}:${record.correlationId}`;
    },
  };
}

void ({
  context: {
    collectTaskContext() {
      return Promise.resolve({
        ok: true,
        value: {
          task: {
            id: 'task-1',
            prompt: 'Wavemill task',
          },
          harness: {
            name: 'wavemill',
          },
        },
      });
    },
  },
  models: {
    discoverModels(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: [
          {
            id: 'wavemill/default',
            label: 'Wavemill Default',
          },
        ],
      });
    },
    mapModel(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          id: 'wavemill-default',
          provider: 'wavemill',
          capabilities: ['reasoning'],
        },
      });
    },
  },
  recommendations: {
    displayRecommendation() {
      return {
        ok: true,
        value: undefined,
      };
    },
  },
  outcomes: {
    collectOutcome(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          taskId: 'task-1',
          status: 'completed',
          summary: 'Completed by Wavemill',
        },
      });
    },
  },
  payloads: {
    previewPayload(request) {
      return {
        ok: true,
        value: {
          summary: `Preview ${request.payload.task.id}`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        },
      };
    },
  },
  consent: {
    promptConsent(request) {
      return Promise.resolve({
        ok: true,
        value: {
          outcome: 'granted',
          scope: request.scope,
        },
      });
    },
  },
  storage: {
    get(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    set(key, value) {
      void key;
      void value;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    delete(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
  },
} satisfies HarnessAdapter);
