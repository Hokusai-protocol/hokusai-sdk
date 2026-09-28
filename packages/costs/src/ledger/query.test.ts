import { describe, expect, it } from 'vitest';
import { queryLedger, summarizeTaskRecords } from './query.js';
import { toLedgerRecord } from './record.js';
import { hash, input } from './test-support.js';

const records = [
  toLedgerRecord(
    input({ model: 'A', amountMicros: 1_000_000, ts: 100 }),
    { eventKey: 'a' },
    hash,
  ),
  toLedgerRecord(
    input({
      model: 'A',
      source: 'local_estimate',
      pricingBasis: 'token_equivalent',
      amountMicros: 500_000,
      ts: 200,
    }),
    { eventKey: 'b' },
    hash,
  ),
  toLedgerRecord(
    input({ model: 'B', amountMicros: 250_000, ts: 300 }),
    { eventKey: 'c' },
    hash,
  ),
  toLedgerRecord(
    input({
      taskId: 't2',
      model: 'B',
      source: 'none',
      pricingBasis: 'unpriced',
      amountMicros: null,
      coverage: 'partial',
      ts: 400,
    }),
    { eventKey: 'd' },
    hash,
  ),
];
describe('queries', () => {
  it('separates metered and equivalent costs, with source and coverage', () => {
    const t1 = queryLedger(records, { taskId: 't1', groupBy: ['model'] });
    expect(t1.totals).toMatchObject({
      recordCount: 3,
      meteredMicros: 1_250_000,
      tokenEquivalentMicros: 500_000,
      coverage: 'complete',
    });
    expect(t1.totals.bySource.local_estimate).toMatchObject({
      recordCount: 1,
      tokenEquivalentMicros: 500_000,
    });
    expect(t1.groups[0]?.totals).toMatchObject({
      meteredMicros: 1_000_000,
      tokenEquivalentMicros: 500_000,
    });
    expect(t1.groups[1]?.totals.meteredMicros).toBe(250_000);
    expect(queryLedger(records, { taskId: 't2' }).totals).toMatchObject({
      coverage: 'partial',
      unpricedRecordCount: 1,
    });
    expect(summarizeTaskRecords(records, 't1').byBackend).toHaveLength(1);
  });
  it('uses a half-open time window and validates spec', () => {
    expect(
      queryLedger(records, { from: 100, to: 200 }).totals.recordCount,
    ).toBe(1);
    expect(
      queryLedger(records, { from: 200, to: 300 }).totals.recordCount,
    ).toBe(1);
    expect(() => queryLedger(records, { from: 'not-a-date' })).toThrow();
    expect(() => queryLedger(records, { from: 2, to: 2 })).toThrow();
    expect(() =>
      queryLedger(records, { groupBy: ['account' as 'model'] }),
    ).toThrow();
    expect(queryLedger([], {}).totals.coverage).toBe('none');
  });
  it('rejects totals beyond the safe integer range', () => {
    const large = toLedgerRecord(
      input({ amountMicros: Number.MAX_SAFE_INTEGER }),
      { eventKey: 'large' },
      hash,
    );
    expect(() => queryLedger([large, records[0]!], {})).toThrowError(
      'Ledger total exceeds safe integer range',
    );
  });
  it('sorts groups consistently across input order', () => {
    const spec = { groupBy: ['model', 'source'] as const };
    expect(queryLedger(records, spec).groups).toEqual(
      queryLedger([...records].reverse(), spec).groups,
    );
  });
});
