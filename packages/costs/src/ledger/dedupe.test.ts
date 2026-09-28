import { describe, expect, it } from 'vitest';
import { openTaskCostLedger } from './ledger.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

describe('replay deduplication', () => {
  it('dedupes across restart without file growth and scopes ids by task', async () => {
    const storage = createMemoryLedgerStorage();
    const first = await openTaskCostLedger({ storage, hashFn: hash });
    await first.append(input(), { eventKey: 'same' });
    const bytes = storage.contents();
    const second = await openTaskCostLedger({ storage, hashFn: hash });
    expect((await second.append(input(), { eventKey: 'same' })).status).toBe(
      'duplicate',
    );
    expect(storage.contents()).toBe(bytes);
    expect(
      (await second.append(input({ taskId: 't2' }), { eventKey: 'same' }))
        .status,
    ).toBe('appended');
  });
  it('keeps first of duplicate persisted lines', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    await ledger.append(input(), { eventKey: 'e' });
    await storage.append(storage.contents() ?? '');
    const reopened = await openTaskCostLedger({ storage, hashFn: hash });
    expect(reopened.records()).toHaveLength(1);
    expect(reopened.diagnostics().duplicateLines).toBe(1);
  });
  it('dedupes 100 concurrent calls', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        ledger.append(input(), { eventKey: 'e' }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'appended'),
    ).toHaveLength(1);
    expect(storage.contents()?.trim().split('\n')).toHaveLength(1);
  });
});
