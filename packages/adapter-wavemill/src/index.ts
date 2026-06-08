import { HokusaiClient, type HokusaiClientOptions } from '@hokusai/core';
import type { CorrelationRecord } from '@hokusai/core';

export interface WavemillAdapterOptions {
  integrationId: string;
  supportsCorrelationReplay?: boolean;
  client?: HokusaiClient;
  clientOptions?: HokusaiClientOptions;
}

export interface WavemillAdapter {
  harness: 'wavemill';
  integrationId: string;
  capabilities: string[];
  client: HokusaiClient;
  formatCorrelation(record: CorrelationRecord): string;
}

export function createWavemillAdapter(
  options: WavemillAdapterOptions,
): WavemillAdapter {
  const client =
    options.client ?? new HokusaiClient(options.clientOptions ?? {});
  return {
    harness: 'wavemill',
    integrationId: options.integrationId,
    capabilities: options.supportsCorrelationReplay
      ? ['correlation-replay']
      : [],
    client,
    formatCorrelation(record) {
      return `${options.integrationId}:${record.correlationId}`;
    },
  };
}
