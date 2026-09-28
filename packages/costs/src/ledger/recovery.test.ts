import { describe, expect, it } from 'vitest';
import { TaskCostLedgerError } from './errors.js';
import { openTaskCostLedger } from './ledger.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

describe('ledger recovery', () => {
  it('truncates only a torn tail and preserves earlier bytes', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    for (let i = 0; i < 3; i++)
      await ledger.append(input({ ts: i }), { eventKey: `e${i}` });
    const prior = storage.contents();
    await storage.append('{"partial":');
    const reopened = await openTaskCostLedger({ storage, hashFn: hash });
    expect(storage.contents()).toBe(prior);
    expect(reopened.diagnostics().recoveredTornTailBytes).toBe(11);
    expect(reopened.query({}).totals.recordCount).toBe(3);
  });
  it('truncates a file containing only a partial line', async () => {
    const storage = createMemoryLedgerStorage();
    await storage.append('partial');
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    expect(storage.contents()).toBe('');
    expect(ledger.records()).toHaveLength(0);
  });
  it('rolls back a partial failed append, then accepts another record', async () => {
    let count = 0;
    const storage = createMemoryLedgerStorage({
      onAppend: (chunk) => {
        count++;
        return Promise.resolve(
          count === 2
            ? {
                write: chunk.slice(0, 20),
                throw: new TaskCostLedgerError('STORAGE_FAILURE', 'Injected'),
              }
            : ('ok' as const),
        );
      },
    });
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    await ledger.append(input(), { eventKey: 'e1' });
    await expect(
      ledger.append(input(), { eventKey: 'e2' }),
    ).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
    await ledger.append(input(), { eventKey: 'e3' });
    const reopened = await openTaskCostLedger({ storage, hashFn: hash });
    expect(reopened.query({}).totals.recordCount).toBe(2);
    expect(reopened.diagnostics().corruptLines).toBe(0);
  });
  it('skips a checksum mismatch in the middle and keeps later lines', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    await ledger.append(input(), { eventKey: 'a' });
    const first = storage.contents() ?? '';
    await storage.append(first.replace('1000', '1001'));
    await ledger.append(input(), { eventKey: 'b' });
    const reopened = await openTaskCostLedger({ storage, hashFn: hash });
    expect(reopened.diagnostics().corruptLines).toBe(1);
    expect(reopened.records()).toHaveLength(2);
  });
  it('counts corrupt complete lines without rewriting them', async () => {
    const storage = createMemoryLedgerStorage();
    await storage.append('not json\n');
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    expect(ledger.diagnostics().corruptLines).toBe(1);
    expect(storage.contents()).toBe('not json\n');
  });
});
