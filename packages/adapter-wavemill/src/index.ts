import type { CorrelationRecord } from '@hokusai/core';

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
