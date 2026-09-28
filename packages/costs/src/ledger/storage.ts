import { TaskCostLedgerError } from './errors.js';

export interface LedgerStorage {
  readAll(opts: { maxBytes: number }): Promise<string | null>;
  append(chunk: string): Promise<void>;
  truncate(byteLength: number): Promise<void>;
}

export interface MemoryLedgerStorage extends LedgerStorage {
  /** Test and offline inspection; returns the exact stored bytes. */
  contents(): string | null;
}

export function createMemoryLedgerStorage(
  options: {
    onAppend?: (
      chunk: string,
      current: string,
    ) => Promise<'ok' | { write: string; throw: TaskCostLedgerError }>;
  } = {},
): MemoryLedgerStorage {
  let buffer = '';
  let hasFile = false;
  return {
    contents: () => (hasFile ? buffer : null),
    readAll({ maxBytes }) {
      if (!hasFile) return Promise.resolve(null);
      if (new TextEncoder().encode(buffer).length > maxBytes) {
        return Promise.reject(
          new TaskCostLedgerError(
            'READ_LIMIT_EXCEEDED',
            'Ledger exceeds maxBytes',
          ),
        );
      }
      return Promise.resolve(buffer);
    },
    async append(chunk) {
      const action = await options.onAppend?.(chunk, buffer);
      hasFile = true;
      if (action && action !== 'ok') {
        buffer += action.write;
        throw action.throw;
      }
      buffer += chunk;
    },
    truncate(byteLength) {
      if (
        !Number.isSafeInteger(byteLength) ||
        byteLength < 0 ||
        byteLength > new TextEncoder().encode(buffer).length
      ) {
        throw new TaskCostLedgerError(
          'INVALID_STORAGE_ARGUMENT',
          'Invalid truncate length',
          { field: 'byteLength' },
        );
      }
      hasFile = true;
      buffer = new TextDecoder().decode(
        new TextEncoder().encode(buffer).subarray(0, byteLength),
      );
      return Promise.resolve();
    },
  };
}
