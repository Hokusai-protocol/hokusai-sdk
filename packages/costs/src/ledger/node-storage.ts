import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { TaskCostLedgerError } from './errors.js';
import type { LedgerStorage } from './storage.js';

function storageError(error: unknown): TaskCostLedgerError {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : 'unknown';
  return new TaskCostLedgerError(
    'STORAGE_FAILURE',
    `Ledger storage failed (${code})`,
    { cause: error },
  );
}
function checkPath(path: string, field: string): void {
  if (typeof path !== 'string' || !isAbsolute(path))
    throw new TaskCostLedgerError(
      'INVALID_STORAGE_ARGUMENT',
      `Invalid ${field}`,
      { field },
    );
}
export function defaultLedgerHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
export function resolveDefaultLedgerPath({
  homeDir,
}: {
  homeDir: string;
}): string {
  checkPath(homeDir, 'homeDir');
  return join(homeDir, '.hokusai', 'costs', 'task-cost-ledger.v1.jsonl');
}
/** One writer per path is required; the append is one write followed by fsync. */
export function createNodeFileLedgerStorage({
  path,
}: {
  path: string;
}): LedgerStorage {
  checkPath(path, 'path');
  return {
    async readAll({ maxBytes }) {
      try {
        const stat = await fs.stat(path);
        if (stat.size > maxBytes)
          throw new TaskCostLedgerError(
            'READ_LIMIT_EXCEEDED',
            'Ledger exceeds maxBytes',
          );
        const bytes = await fs.readFile(path);
        if (bytes.length > maxBytes)
          throw new TaskCostLedgerError(
            'READ_LIMIT_EXCEEDED',
            'Ledger exceeds maxBytes',
          );
        return bytes.toString('utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        if (error instanceof TaskCostLedgerError) throw error;
        throw storageError(error);
      }
    },
    async append(chunk) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
        handle = await fs.open(path, 'a', 0o600);
        const data = Buffer.from(chunk, 'utf8');
        const { bytesWritten } = await handle.write(data, 0, data.length);
        if (bytesWritten !== data.length) throw new Error('short write');
        await handle.sync();
      } catch (error) {
        throw storageError(error);
      } finally {
        await handle?.close();
      }
    },
    async truncate(byteLength) {
      if (!Number.isSafeInteger(byteLength) || byteLength < 0)
        throw new TaskCostLedgerError(
          'INVALID_STORAGE_ARGUMENT',
          'Invalid truncate length',
          { field: 'byteLength' },
        );
      let currentSize: number | null = null;
      try {
        currentSize = (await fs.stat(path)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (byteLength === 0) return;
          throw new TaskCostLedgerError(
            'INVALID_STORAGE_ARGUMENT',
            'Invalid truncate length',
            { field: 'byteLength' },
          );
        }
        throw storageError(error);
      }
      if (byteLength > currentSize)
        throw new TaskCostLedgerError(
          'INVALID_STORAGE_ARGUMENT',
          'Invalid truncate length',
          { field: 'byteLength' },
        );
      try {
        await fs.truncate(path, byteLength);
      } catch (error) {
        throw storageError(error);
      }
    },
  };
}
