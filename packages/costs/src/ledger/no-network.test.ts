import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openTaskCostLedger } from './ledger.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

describe('offline ledger', () => {
  it('contains no networking calls in production source', () => {
    const root = new URL('.', import.meta.url).pathname;
    const files = readdirSync(root).filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        name !== 'test-support.ts',
    );
    for (const file of files)
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(
        /from ['"](node:)?(http|https|net|dgram|undici)['"]|\bfetch\(|XMLHttpRequest/,
      );
  });
  it('opens, persists and queries without fetch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network attempted');
    });
    try {
      const storage = createMemoryLedgerStorage();
      const ledger = await openTaskCostLedger({ storage, hashFn: hash });
      await ledger.append(input(), { eventKey: 'e' });
      ledger.close();
      expect(
        (await openTaskCostLedger({ storage, hashFn: hash })).query({}).totals
          .recordCount,
      ).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
