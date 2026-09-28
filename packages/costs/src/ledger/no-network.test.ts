import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openTaskCostLedger } from './ledger.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

function walkProductionSources(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkProductionSources(full));
      continue;
    }
    if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      entry.name !== 'test-support.ts'
    )
      out.push(full);
  }
  return out;
}

describe('offline ledger', () => {
  it('contains no networking calls in production source', () => {
    const root = new URL('.', import.meta.url).pathname;
    const files = walkProductionSources(root);
    for (const file of files)
      expect(readFileSync(file, 'utf8')).not.toMatch(
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
