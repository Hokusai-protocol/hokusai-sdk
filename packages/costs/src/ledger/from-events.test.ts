import { describe, expect, it } from 'vitest';
import { createTaskCostEngine } from '../engine.js';
import { toLedgerEntries } from './from-events.js';
import { validateLedgerInput } from './record.js';

function engineWith(
  overrides: Partial<Parameters<ReturnType<typeof createTaskCostEngine>['ingest']>[0]>,
) {
  const engine = createTaskCostEngine({ taskId: 'task-0001' });
  const result = engine.ingest({
    eventId: 'e1',
    taskId: 'task-0001',
    sessionId: 's1',
    turnId: 't1',
    sequence: 1,
    harness: 'claude-code',
    providerContractVersion: 'claude-code/1',
    observedModel: 'claude-sonnet-5',
    usage: { input_tokens: 1000, output_tokens: 100 },
    observedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as never);
  expect(result.status).toBe('accepted');
  return engine;
}

describe('toLedgerEntries', () => {
  it('maps a locally estimated event to a token_equivalent record', () => {
    const [entry] = toLedgerEntries(engineWith({}).events());
    expect(entry?.eventKey).toBe('e1');
    expect(entry?.input).toMatchObject({
      taskId: 'task-0001',
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      backend: 'anthropic', // from the event's price_table
      source: 'local_estimate',
      pricingBasis: 'token_equivalent',
      ts: Date.parse('2026-01-01T00:00:00Z'),
      inputTokens: 1000,
      outputTokens: 100,
      // Null counters are stored as 0 but marked partial, so the zero is
      // never read back as a known value.
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      coverage: 'partial',
    });
    expect(entry?.input.amountMicros).toBeGreaterThan(0);
    expect(() => validateLedgerInput(entry!.input)).not.toThrow();
  });

  it('maps a provider-reported charge to a metered record', () => {
    const [entry] = toLedgerEntries(
      engineWith({
        actualCostUsd: 0.1234,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 1,
          cache_write_tokens: 2,
          reasoning_tokens: 0,
        },
      }).events(),
    );
    expect(entry?.input).toMatchObject({
      source: 'provider_reported',
      pricingBasis: 'metered',
      amountMicros: 123_400,
      coverage: 'complete',
    });
  });

  it('maps an unpriced event to an unpriced record with a null amount, never $0', () => {
    const [entry] = toLedgerEntries(
      engineWith({ observedModel: 'mystery-model' }).events(),
    );
    expect(entry?.input).toMatchObject({
      pricingBasis: 'unpriced',
      amountMicros: null,
      source: 'none',
      backend: 'unknown', // no price table and no provider/model prefix
    });
    expect(() => validateLedgerInput(entry!.input)).not.toThrow();
  });
});
