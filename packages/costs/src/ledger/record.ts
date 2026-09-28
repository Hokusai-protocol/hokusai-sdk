import {
  TASK_COST_EVENT_SOURCES,
  TASK_COST_HARNESSES,
  type TaskCostEventSource,
  type TaskCostHarness,
} from '@hokusai/core';
import { TaskCostLedgerError } from './errors.js';

export const LEDGER_RECORD_CURRENT_VERSION = 1 as const;
export type LedgerCoverage = 'complete' | 'partial';
export type LedgerPricingBasis = 'metered' | 'token_equivalent' | 'unpriced';
export interface HashFn {
  (input: string): string;
}
export interface ToLedgerRecordInput {
  taskId: string;
  model: string;
  harness: TaskCostHarness;
  backend: string;
  source: TaskCostEventSource;
  pricingBasis: LedgerPricingBasis;
  amountMicros: number | null;
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  coverage: LedgerCoverage;
}
export interface LedgerRecordV1 extends ToLedgerRecordInput {
  v: 1;
  id: string;
  c: string;
  currency: 'USD';
}
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const BACKEND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const HEX_32 = /^[a-f0-9]{32}$/;
const HEX_16 = /^[a-f0-9]{16}$/;
const FIELDS = [
  'v',
  'id',
  'c',
  'ts',
  'taskId',
  'model',
  'harness',
  'backend',
  'source',
  'pricingBasis',
  'amountMicros',
  'currency',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'coverage',
] as const;

function invalid(field: string): never {
  throw new TaskCostLedgerError(
    'INVALID_RECORD',
    `Invalid ledger field: ${field}`,
    { field },
  );
}
function safeCount(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    invalid(field);
}
function safeLabel(value: unknown, pattern: RegExp, field: string): void {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.includes('..') ||
    value.includes('//') ||
    /^(sk(-ant)?-|AKIA|acct[_-])/i.test(value) ||
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  )
    invalid(field);
}
export function validateLedgerInput(input: ToLedgerRecordInput): void {
  safeLabel(input.taskId, TASK_ID_PATTERN, 'taskId');
  safeLabel(input.model, MODEL_PATTERN, 'model');
  safeLabel(input.backend, BACKEND_PATTERN, 'backend');
  if (!(TASK_COST_HARNESSES as readonly string[]).includes(input.harness))
    invalid('harness');
  if (!(TASK_COST_EVENT_SOURCES as readonly string[]).includes(input.source))
    invalid('source');
  if (!['metered', 'token_equivalent', 'unpriced'].includes(input.pricingBasis))
    invalid('pricingBasis');
  if (
    input.pricingBasis === 'unpriced'
      ? input.amountMicros !== null
      : input.amountMicros === null
  )
    invalid('amountMicros');
  if (input.amountMicros !== null)
    safeCount(input.amountMicros, 'amountMicros');
  for (const field of [
    'ts',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
  ] as const)
    safeCount(input[field], field);
  if (!['complete', 'partial'].includes(input.coverage)) invalid('coverage');
}

/** Canonical JSON has sorted keys, recursively, with only safe integer numeric values. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  throw new TaskCostLedgerError(
    'INVALID_RECORD',
    'Invalid canonical JSON value',
  );
}
function digest(hashFn: HashFn, value: string, length: number): string {
  const result = hashFn(value);
  if (!/^[a-f0-9]{64}$/i.test(result))
    throw new TaskCostLedgerError(
      'INVALID_STORAGE_ARGUMENT',
      'Hash function must return SHA-256 hex',
      { field: 'hashFn' },
    );
  return result.toLowerCase().slice(0, length);
}
export function toLedgerRecord(
  input: ToLedgerRecordInput,
  opts: { eventKey: string },
  hashFn: HashFn,
): LedgerRecordV1 {
  validateLedgerInput(input);
  if (typeof opts.eventKey !== 'string' || opts.eventKey.length === 0)
    invalid('eventKey');
  const base = {
    v: 1 as const,
    id: digest(
      hashFn,
      JSON.stringify([input.taskId, input.source, opts.eventKey]),
      32,
    ),
    ts: input.ts,
    taskId: input.taskId,
    model: input.model,
    harness: input.harness,
    backend: input.backend,
    source: input.source,
    pricingBasis: input.pricingBasis,
    amountMicros: input.amountMicros,
    currency: 'USD' as const,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    coverage: input.coverage,
  };
  return { ...base, c: digest(hashFn, canonicalJson(base), 16) };
}
export function serializeLine(record: LedgerRecordV1): string {
  return `${canonicalJson(record)}\n`;
}
export type ParseLineResult =
  | { ok: true; record: LedgerRecordV1 }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'checksum'
        | 'unsupported_version'
        | 'invalid_record';
    };
export function parseLine(line: string, hashFn: HashFn): ParseLineResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { ok: false, reason: 'malformed' };
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.v === 'number' &&
    Number.isSafeInteger(obj.v) &&
    obj.v > LEDGER_RECORD_CURRENT_VERSION
  )
    return { ok: false, reason: 'unsupported_version' };
  if (
    obj.v !== 1 ||
    Object.keys(obj).length !== FIELDS.length ||
    FIELDS.some((field) => !(field in obj))
  )
    return { ok: false, reason: 'invalid_record' };
  try {
    validateLedgerInput(obj as unknown as ToLedgerRecordInput);
    if (
      !HEX_32.test(String(obj.id)) ||
      !HEX_16.test(String(obj.c)) ||
      obj.currency !== 'USD'
    )
      return { ok: false, reason: 'invalid_record' };
    const unsigned = Object.fromEntries(
      Object.entries(obj).filter(([key]) => key !== 'c'),
    );
    if (digest(hashFn, canonicalJson(unsigned), 16) !== obj.c)
      return { ok: false, reason: 'checksum' };
    return { ok: true, record: obj as unknown as LedgerRecordV1 };
  } catch {
    return { ok: false, reason: 'invalid_record' };
  }
}
/** Future readers can register explicit in-memory migrations; existing bytes are never rewritten. */
export const migrations: Record<
  number,
  (record: Record<string, unknown>) => Record<string, unknown>
> = {};
export function applyMigrations(
  record: Record<string, unknown>,
  targetVersion: number = LEDGER_RECORD_CURRENT_VERSION,
):
  | { record: Record<string, unknown>; toVersion: number }
  | { unsupported: true } {
  let current = record;
  let version = record.v;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    return { unsupported: true };
  while (version < targetVersion) {
    const migration = migrations[version];
    if (!migration) return { unsupported: true };
    current = migration(current);
    version++;
    current = { ...current, v: version };
  }
  return version === targetVersion
    ? { record: current, toVersion: version }
    : { unsupported: true };
}
