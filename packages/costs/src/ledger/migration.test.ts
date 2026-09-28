import { describe, expect, it } from 'vitest';
import { openTaskCostLedger } from './ledger.js';
import {
  canonicalJson,
  serializeLine,
  toLedgerRecord,
  applyMigrations,
  migrations,
} from './record.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

describe('version compatibility', () => {
  it('skips future lines and preserves their bytes across append', async () => {
    const a = toLedgerRecord(input(), { eventKey: 'a' }, hash);
    const unsigned = Object.fromEntries(
      Object.entries(a).filter(([key]) => key !== 'c'),
    );
    const futureUnsigned = { ...unsigned, v: 2 };
    const future = {
      ...futureUnsigned,
      c: hash(canonicalJson(futureUnsigned)).slice(0, 16),
    };
    const storage = createMemoryLedgerStorage();
    const original = serializeLine(a) + `${canonicalJson(future)}\n`;
    await storage.append(original);
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    expect(ledger.diagnostics().unsupportedVersionLines).toBe(1);
    expect(ledger.query({}).totals.recordCount).toBe(1);
    expect(storage.contents()).toBe(original);
    await ledger.append(input(), { eventKey: 'b' });
    expect(storage.contents()?.startsWith(original)).toBe(true);
  });
  it('migrates in memory through a registered step', () => {
    migrations[1] = (record) => ({ ...record, added: 1 });
    try {
      expect(applyMigrations({ v: 1, old: 1 }, 2)).toEqual({
        record: { v: 2, old: 1, added: 1 },
        toVersion: 2,
      });
    } finally {
      delete migrations[1];
    }
  });
  it('treats invalid versions as corrupt lines', async () => {
    const storage = createMemoryLedgerStorage();
    await storage.append('{"v":0}\n{"v":"a"}\n');
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    expect(ledger.diagnostics().corruptLines).toBe(2);
  });
});
