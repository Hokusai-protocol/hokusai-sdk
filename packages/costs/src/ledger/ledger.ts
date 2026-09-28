import { TaskCostLedgerError } from './errors.js';
import {
  parseLine,
  serializeLine,
  toLedgerRecord,
  type HashFn,
  type LedgerRecordV1,
  type ToLedgerRecordInput,
} from './record.js';
import {
  queryLedger,
  summarizeTaskRecords,
  validateQuery,
  type QueryResult,
  type QuerySpec,
  type TaskSummary,
} from './query.js';
import type { LedgerStorage } from './storage.js';

export interface OpenTaskCostLedgerOptions {
  storage: LedgerStorage;
  hashFn: HashFn;
  maxBytes?: number;
  maxRecords?: number;
}
export interface LedgerDiagnostics {
  recoveredTornTailBytes: number;
  corruptLines: number;
  duplicateLines: number;
  unsupportedVersionLines: number;
}
export interface AppendResult {
  status: 'appended' | 'duplicate';
  id: string;
}
export interface RecordsFilter {
  taskId?: string;
  from?: number | string;
  to?: number | string;
}
export interface TaskCostLedger {
  append(
    input: ToLedgerRecordInput,
    opts: { eventKey: string },
  ): Promise<AppendResult>;
  appendMany(
    entries: readonly { input: ToLedgerRecordInput; eventKey: string }[],
  ): Promise<readonly AppendResult[]>;
  records(filter?: RecordsFilter): readonly LedgerRecordV1[];
  query(spec: QuerySpec): QueryResult;
  summarizeTask(taskId: string): TaskSummary;
  diagnostics(): LedgerDiagnostics;
  close(): void;
}
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 1_000_000;

export async function openTaskCostLedger(
  opts: OpenTaskCostLedgerOptions,
): Promise<TaskCostLedger> {
  if (
    !opts ||
    !opts.storage ||
    typeof opts.storage.readAll !== 'function' ||
    typeof opts.storage.append !== 'function' ||
    typeof opts.storage.truncate !== 'function'
  )
    throw new TaskCostLedgerError(
      'INVALID_STORAGE_ARGUMENT',
      'Invalid storage',
      { field: 'storage' },
    );
  if (typeof opts.hashFn !== 'function')
    throw new TaskCostLedgerError(
      'INVALID_STORAGE_ARGUMENT',
      'Invalid hashFn',
      { field: 'hashFn' },
    );
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRecords = opts.maxRecords ?? DEFAULT_MAX_RECORDS;
  for (const [field, value] of [
    ['maxBytes', maxBytes],
    ['maxRecords', maxRecords],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TaskCostLedgerError(
        'INVALID_STORAGE_ARGUMENT',
        `Invalid ${field}`,
        { field },
      );
  }
  const byId = new Map<string, LedgerRecordV1>();
  const stats: LedgerDiagnostics = {
    recoveredTornTailBytes: 0,
    corruptLines: 0,
    duplicateLines: 0,
    unsupportedVersionLines: 0,
  };
  let raw: string | null;
  try {
    raw = await opts.storage.readAll({ maxBytes });
  } catch (error) {
    throw error instanceof TaskCostLedgerError
      ? error
      : new TaskCostLedgerError('STORAGE_FAILURE', 'Ledger read failed', {
          cause: error,
        });
  }
  let sizeBytes = 0;
  if (raw !== null) {
    const lastNewline = raw.lastIndexOf('\n');
    const complete = raw.slice(0, lastNewline + 1);
    sizeBytes = new TextEncoder().encode(complete).length;
    stats.recoveredTornTailBytes =
      new TextEncoder().encode(raw).length - sizeBytes;
    if (stats.recoveredTornTailBytes > 0) {
      try {
        await opts.storage.truncate(sizeBytes);
      } catch (error) {
        throw new TaskCostLedgerError(
          'STORAGE_FAILURE',
          'Ledger recovery failed',
          { cause: error },
        );
      }
    }
    for (const line of complete.split('\n')) {
      if (line.length === 0) continue;
      const result = parseLine(line, opts.hashFn);
      if (!result.ok) {
        if (result.reason === 'unsupported_version')
          stats.unsupportedVersionLines++;
        else stats.corruptLines++;
        continue;
      }
      if (byId.has(result.record.id)) {
        stats.duplicateLines++;
        continue;
      }
      byId.set(result.record.id, Object.freeze(result.record));
      if (byId.size > maxRecords)
        throw new TaskCostLedgerError(
          'READ_LIMIT_EXCEEDED',
          'Ledger exceeds maxRecords',
        );
    }
  }
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  function ensureOpen(): void {
    if (closed)
      throw new TaskCostLedgerError('LEDGER_CLOSED', 'Ledger is closed');
  }
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    ensureOpen();
    const work = queue.then(() => {
      ensureOpen();
      return action();
    });
    queue = work.catch(() => undefined);
    return work;
  }
  async function appendOne(
    input: ToLedgerRecordInput,
    eventKey: string,
  ): Promise<AppendResult> {
    const record = toLedgerRecord(input, { eventKey }, opts.hashFn);
    if (byId.has(record.id)) return { status: 'duplicate', id: record.id };
    const chunk = serializeLine(record);
    const chunkBytes = new TextEncoder().encode(chunk).length;
    if (byId.size >= maxRecords || sizeBytes + chunkBytes > maxBytes)
      throw new TaskCostLedgerError(
        'READ_LIMIT_EXCEEDED',
        'Ledger append exceeds configured limit',
      );
    const priorSize = sizeBytes;
    try {
      await opts.storage.append(chunk);
    } catch (error) {
      // Under the documented single-writer contract, the prior offset is the
      // last known good boundary, including if a write succeeded but fsync failed.
      try {
        await opts.storage.truncate(priorSize);
      } catch (recoveryError) {
        throw new TaskCostLedgerError(
          'STORAGE_FAILURE',
          'Ledger write and recovery failed',
          { cause: recoveryError },
        );
      }
      throw new TaskCostLedgerError('STORAGE_FAILURE', 'Ledger append failed', {
        cause: error,
      });
    }
    sizeBytes += chunkBytes;
    byId.set(record.id, Object.freeze(record));
    return { status: 'appended', id: record.id };
  }
  return {
    append(input, { eventKey }) {
      return enqueue(() => appendOne(input, eventKey));
    },
    appendMany(entries) {
      return enqueue(async () => {
        const results: AppendResult[] = [];
        for (const { input, eventKey } of entries)
          results.push(await appendOne(input, eventKey));
        return results;
      });
    },
    records(filter = {}) {
      ensureOpen();
      const { from, to } = validateQuery(filter);
      return [...byId.values()].filter(
        (record) =>
          (filter.taskId === undefined || record.taskId === filter.taskId) &&
          (from === undefined || record.ts >= from) &&
          (to === undefined || record.ts < to),
      );
    },
    query(spec) {
      ensureOpen();
      return queryLedger([...byId.values()], spec);
    },
    summarizeTask(taskId) {
      ensureOpen();
      return summarizeTaskRecords([...byId.values()], taskId);
    },
    diagnostics() {
      ensureOpen();
      return Object.freeze({ ...stats });
    },
    close() {
      closed = true;
    },
  };
}
