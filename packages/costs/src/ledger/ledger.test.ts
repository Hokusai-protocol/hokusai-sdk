import { describe, expect, it } from 'vitest';
import { TaskCostLedgerError } from './errors.js';
import { openTaskCostLedger } from './ledger.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

describe('task cost ledger', () => {
  it('reopens with identical summary and grouped totals', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    await ledger.append(input(), { eventKey: 'e1' });
    await ledger.append(
      input({
        model: 'openai/gpt-5',
        backend: 'openai',
        source: 'local_estimate',
        pricingBasis: 'token_equivalent',
        amountMicros: 500,
      }),
      { eventKey: 'e2' },
    );
    const summary = ledger.summarizeTask('t1');
    const grouped = ledger.query({
      taskId: 't1',
      groupBy: ['model', 'backend'],
    });
    ledger.close();
    const reopened = await openTaskCostLedger({ storage, hashFn: hash });
    expect(reopened.summarizeTask('t1')).toEqual(summary);
    expect(
      reopened.query({ taskId: 't1', groupBy: ['model', 'backend'] }),
    ).toEqual(grouped);
    expect(() => ledger.records()).toThrow();
  });
  it('appendMany persists prior entries when a later entry fails', async () => {
    let calls = 0;
    const storage = createMemoryLedgerStorage({
      onAppend: () => {
        calls += 1;
        if (calls === 3)
          return Promise.resolve({
            write: '',
            throw: new TaskCostLedgerError('STORAGE_FAILURE', 'disk full'),
          });
        return Promise.resolve('ok');
      },
    });
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    await expect(
      ledger.appendMany([
        { input: input({ ts: 1 }), eventKey: 'a' },
        { input: input({ ts: 2 }), eventKey: 'b' },
        { input: input({ ts: 3 }), eventKey: 'c' },
      ]),
    ).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
    expect(ledger.records().map((record) => record.ts)).toEqual([1, 2]);
  });
  it('serializes concurrent appends in arrival order', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        ledger.append(input({ ts: i }), { eventKey: `e${i}` }),
      ),
    );
    expect(results.every((result) => result.status === 'appended')).toBe(true);
    expect(ledger.records().map((record) => record.ts)).toEqual(
      Array.from({ length: 100 }, (_, i) => i),
    );
    expect(storage.contents()?.trim().split('\n')).toHaveLength(100);
  });
});
