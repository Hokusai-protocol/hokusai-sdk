import { describe, expect, it } from 'vitest';
import { createMemoryLedgerStorage } from './storage.js';
import { TaskCostLedgerError } from './errors.js';

describe('memory storage', () => {
  it('distinguishes missing from empty, limits reads and truncates', async () => {
    const storage = createMemoryLedgerStorage();
    expect(await storage.readAll({ maxBytes: 1 })).toBeNull();
    await storage.append('abc');
    await expect(storage.readAll({ maxBytes: 2 })).rejects.toMatchObject({
      code: 'READ_LIMIT_EXCEEDED',
    });
    await storage.truncate(1);
    expect(await storage.readAll({ maxBytes: 1 })).toBe('a');
    await storage.truncate(0);
    expect(await storage.readAll({ maxBytes: 1 })).toBe('');
  });
  it('simulates one torn write', async () => {
    let first = true;
    const storage = createMemoryLedgerStorage({
      onAppend: () => {
        if (first) {
          first = false;
          return Promise.resolve({
            write: 'x',
            throw: new TaskCostLedgerError('STORAGE_FAILURE', 'Injected'),
          });
        }
        return Promise.resolve('ok' as const);
      },
    });
    await expect(storage.append('xyz')).rejects.toThrow();
    expect(storage.contents()).toBe('x');
    await storage.append('z');
    expect(storage.contents()).toBe('xz');
  });
});
