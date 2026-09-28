import {
  TASK_COST_EVENT_SOURCES,
  type TaskCostEventSource,
} from '@hokusai/core';
import { TaskCostLedgerError } from './errors.js';
import type { LedgerRecordV1 } from './record.js';

export type GroupByKey = 'model' | 'harness' | 'backend' | 'source';
export interface QuerySpec {
  taskId?: string;
  from?: number | string;
  to?: number | string;
  groupBy?: readonly GroupByKey[];
}
export interface BySourceEntry {
  recordCount: number;
  meteredMicros: number;
  tokenEquivalentMicros: number;
}
export interface QueryTotals extends BySourceEntry {
  unpricedRecordCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  coverage: 'complete' | 'partial' | 'none';
  bySource: Record<TaskCostEventSource, BySourceEntry>;
}
export interface QueryGroup {
  key: Partial<Record<GroupByKey, string>>;
  totals: QueryTotals;
}
export interface QueryResult {
  totals: QueryTotals;
  groups: readonly QueryGroup[];
}
export interface TaskSummary {
  taskId: string;
  totals: QueryTotals;
  byModel: readonly QueryGroup[];
  byHarness: readonly QueryGroup[];
  byBackend: readonly QueryGroup[];
  bySource: readonly QueryGroup[];
}
export function parseWindow(
  value: number | string | undefined,
  field: 'from' | 'to',
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new TaskCostLedgerError('INVALID_QUERY', `Invalid ${field}`, {
      field,
    });
  return parsed;
}
export function validateQuery(spec: QuerySpec): { from?: number; to?: number } {
  if (
    spec.taskId !== undefined &&
    (typeof spec.taskId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(spec.taskId))
  )
    throw new TaskCostLedgerError('INVALID_QUERY', 'Invalid taskId', {
      field: 'taskId',
    });
  if (
    spec.groupBy !== undefined &&
    (!Array.isArray(spec.groupBy) ||
      spec.groupBy.some(
        (key: unknown) =>
          typeof key !== 'string' ||
          !['model', 'harness', 'backend', 'source'].includes(key),
      ))
  )
    throw new TaskCostLedgerError('INVALID_QUERY', 'Invalid groupBy', {
      field: 'groupBy',
    });
  const from = parseWindow(spec.from, 'from');
  const to = parseWindow(spec.to, 'to');
  if (from !== undefined && to !== undefined && from >= to)
    throw new TaskCostLedgerError('INVALID_QUERY', 'Invalid time window', {
      field: 'from',
    });
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}
function addSafe(current: number, increment: number): number {
  const next = current + increment;
  if (!Number.isSafeInteger(next))
    throw new TaskCostLedgerError(
      'INVALID_QUERY',
      'Ledger total exceeds safe integer range',
    );
  return next;
}
function totals(records: readonly LedgerRecordV1[]): QueryTotals {
  const bySource = Object.fromEntries(
    TASK_COST_EVENT_SOURCES.map((source) => [
      source,
      { recordCount: 0, meteredMicros: 0, tokenEquivalentMicros: 0 },
    ]),
  ) as Record<TaskCostEventSource, BySourceEntry>;
  const result: QueryTotals = {
    recordCount: 0,
    meteredMicros: 0,
    tokenEquivalentMicros: 0,
    unpricedRecordCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    coverage: 'none',
    bySource,
  };
  for (const record of records) {
    result.recordCount++;
    result.inputTokens = addSafe(result.inputTokens, record.inputTokens);
    result.outputTokens = addSafe(result.outputTokens, record.outputTokens);
    result.cacheReadTokens = addSafe(
      result.cacheReadTokens,
      record.cacheReadTokens,
    );
    result.cacheWriteTokens = addSafe(
      result.cacheWriteTokens,
      record.cacheWriteTokens,
    );
    const source = bySource[record.source];
    source.recordCount++;
    if (record.pricingBasis === 'metered') {
      result.meteredMicros = addSafe(
        result.meteredMicros,
        record.amountMicros ?? 0,
      );
      source.meteredMicros = addSafe(
        source.meteredMicros,
        record.amountMicros ?? 0,
      );
    } else if (record.pricingBasis === 'token_equivalent') {
      result.tokenEquivalentMicros = addSafe(
        result.tokenEquivalentMicros,
        record.amountMicros ?? 0,
      );
      source.tokenEquivalentMicros = addSafe(
        source.tokenEquivalentMicros,
        record.amountMicros ?? 0,
      );
    } else result.unpricedRecordCount++;
    if (record.coverage === 'partial' || record.pricingBasis === 'unpriced')
      result.coverage = 'partial';
    else if (result.coverage === 'none') result.coverage = 'complete';
  }
  return result;
}
export function queryLedger(
  records: readonly LedgerRecordV1[],
  spec: QuerySpec = {},
): QueryResult {
  const { from, to } = validateQuery(spec);
  const filtered = records.filter(
    (record) =>
      (spec.taskId === undefined || record.taskId === spec.taskId) &&
      (from === undefined || record.ts >= from) &&
      (to === undefined || record.ts < to),
  );
  const keys = spec.groupBy ?? [];
  if (keys.length === 0) return { totals: totals(filtered), groups: [] };
  const groups = new Map<
    string,
    { key: QueryGroup['key']; records: LedgerRecordV1[] }
  >();
  for (const record of filtered) {
    const key = Object.fromEntries(
      keys.map((k) => [k, record[k]]),
    ) as QueryGroup['key'];
    const name = JSON.stringify(key);
    let group = groups.get(name);
    if (!group) {
      group = { key, records: [] };
      groups.set(name, group);
    }
    group.records.push(record);
  }
  return {
    totals: totals(filtered),
    groups: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => ({ key: group.key, totals: totals(group.records) })),
  };
}
export function summarizeTaskRecords(
  records: readonly LedgerRecordV1[],
  taskId: string,
): TaskSummary {
  const base = { taskId };
  return {
    taskId,
    totals: queryLedger(records, base).totals,
    byModel: queryLedger(records, { ...base, groupBy: ['model'] }).groups,
    byHarness: queryLedger(records, { ...base, groupBy: ['harness'] }).groups,
    byBackend: queryLedger(records, { ...base, groupBy: ['backend'] }).groups,
    bySource: queryLedger(records, { ...base, groupBy: ['source'] }).groups,
  };
}
