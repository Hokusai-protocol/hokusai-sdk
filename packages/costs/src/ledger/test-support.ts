import { defaultLedgerHash } from './node-storage.js';
import type { ToLedgerRecordInput } from './record.js';
export const hash = defaultLedgerHash;
export function input(
  overrides: Partial<ToLedgerRecordInput> = {},
): ToLedgerRecordInput {
  return {
    taskId: 't1',
    model: 'anthropic/claude',
    harness: 'claude-code',
    backend: 'anthropic',
    source: 'provider_reported',
    pricingBasis: 'metered',
    amountMicros: 1000,
    ts: 1000,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    coverage: 'complete',
    ...overrides,
  };
}
