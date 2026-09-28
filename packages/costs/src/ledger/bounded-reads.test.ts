import { describe, expect, it } from 'vitest';
import { openTaskCostLedger } from './ledger.js';
import { serializeLine, toLedgerRecord } from './record.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

describe('read bounds', () => {
  it('rejects excess records but accepts the exact limit', async () => {
    const storage = createMemoryLedgerStorage();
    for (let i = 0; i < 3; i++)
      await storage.append(
        serializeLine(toLedgerRecord(input(), { eventKey: `e${i}` }, hash)),
      );
    await expect(
      openTaskCostLedger({ storage, hashFn: hash, maxRecords: 2 }),
    ).rejects.toMatchObject({ code: 'READ_LIMIT_EXCEEDED' });
    expect(
      (
        await openTaskCostLedger({ storage, hashFn: hash, maxRecords: 3 })
      ).records(),
    ).toHaveLength(3);
  });
  it('rejects invalid limits and oversized bytes', async () => {
    const storage = createMemoryLedgerStorage();
    await storage.append('x'.repeat(2048));
    await expect(
      openTaskCostLedger({ storage, hashFn: hash, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'READ_LIMIT_EXCEEDED' });
    await expect(
      openTaskCostLedger({ storage, hashFn: hash, maxRecords: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_STORAGE_ARGUMENT' });
  });
});
