import { promises as fs } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTaskCostLedger } from './ledger.js';
import {
  createNodeFileLedgerStorage,
  defaultLedgerHash,
  resolveDefaultLedgerPath,
} from './node-storage.js';
import { input } from './test-support.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function path(): Promise<{ root: string; ledgerPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'hokusai-ledger-'));
  roots.push(root);
  return { root, ledgerPath: join(root, 'private', 'ledger.jsonl') };
}
describe('Node file storage', () => {
  it('uses explicit paths, secure creation and durable reopen', async () => {
    const { root, ledgerPath } = await path();
    const storage = createNodeFileLedgerStorage({ path: ledgerPath });
    expect(await storage.readAll({ maxBytes: 10 })).toBeNull();
    const ledger = await openTaskCostLedger({
      storage,
      hashFn: defaultLedgerHash,
    });
    await ledger.append(input(), { eventKey: 'e' });
    expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'private'))).mode & 0o777).toBe(0o700);
    const bytes = await readFile(ledgerPath, 'utf8');
    expect(bytes.endsWith('\n')).toBe(true);
    ledger.close();
    expect(
      (await openTaskCostLedger({ storage, hashFn: defaultLedgerHash })).query(
        {},
      ).totals.recordCount,
    ).toBe(1);
  });
  it('validates paths and strips them from storage errors', async () => {
    expect(() => createNodeFileLedgerStorage({ path: '' })).toThrow();
    expect(() => createNodeFileLedgerStorage({ path: 'relative' })).toThrow();
    expect(() => resolveDefaultLedgerPath({ homeDir: '' })).toThrow();
    expect(resolveDefaultLedgerPath({ homeDir: '/tmp/foo' })).toBe(
      '/tmp/foo/.hokusai/costs/task-cost-ledger.v1.jsonl',
    );
    const { ledgerPath } = await path();
    const storage = createNodeFileLedgerStorage({
      path: join(ledgerPath, 'impossible'),
    });
    await expect(storage.readAll({ maxBytes: 100 })).resolves.toBeNull();
  });
  it('does not expose paths in non-ENOENT errors', async () => {
    const { root } = await path();
    const storage = createNodeFileLedgerStorage({ path: root });
    try {
      await storage.readAll({ maxBytes: 1024 });
      throw new Error('accepted');
    } catch (error) {
      expect(error).toMatchObject({ code: 'STORAGE_FAILURE' });
      expect(String(error)).not.toContain(root);
    }
  });
  it('rejects truncation lengths that would extend the file', async () => {
    const { ledgerPath } = await path();
    const storage = createNodeFileLedgerStorage({ path: ledgerPath });
    await storage.append('abcd');
    await expect(storage.truncate(2)).resolves.toBeUndefined();
    await expect(storage.truncate(999)).rejects.toMatchObject({
      code: 'INVALID_STORAGE_ARGUMENT',
    });
    await expect(storage.truncate(-1)).rejects.toMatchObject({
      code: 'INVALID_STORAGE_ARGUMENT',
    });
    const { ledgerPath: missingPath } = await path();
    const missing = createNodeFileLedgerStorage({ path: missingPath });
    await expect(missing.truncate(0)).resolves.toBeUndefined();
    await expect(missing.truncate(1)).rejects.toMatchObject({
      code: 'INVALID_STORAGE_ARGUMENT',
    });
  });
  it('checks size before reading file contents', async () => {
    const { ledgerPath } = await path();
    const storage = createNodeFileLedgerStorage({ path: ledgerPath });
    await storage.append('x'.repeat(2048));
    const readSpy = vi.spyOn(fs, 'readFile');
    try {
      await expect(storage.readAll({ maxBytes: 1024 })).rejects.toMatchObject({
        code: 'READ_LIMIT_EXCEEDED',
      });
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });
});
