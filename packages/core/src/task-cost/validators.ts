/**
 * Runtime validators for the task-cost wire records. They are the normative
 * schema: a record is a valid versioned task-cost record iff the matching
 * `validate*` function accepts it.
 *
 * Validators tolerate unknown *fields* (additive compatibility) but reject
 * unknown *enum values* and any forbidden key (prompt/transcript/path/
 * credential/account identifiers), at any depth.
 *
 * @module task-cost/validators
 */

import {
  TASK_COST_BASES,
  TASK_COST_COVERAGES,
  TASK_COST_DIAGNOSTIC_CODES,
  TASK_COST_EVENT_SOURCES,
  TASK_COST_FIELD_AVAILABILITIES,
  TASK_COST_HARNESSES,
  TASK_COST_JOIN_CONFIDENCES,
  TASK_COST_PRICE_TABLES,
  TASK_COST_PRICING_SOURCES,
  TASK_COST_SOURCES,
  TASK_COST_USAGE_KINDS,
} from './enums.js';
import type { TaskCostEventV1 } from './event.js';
import type { TaskCostLedgerV1 } from './ledger.js';
import {
  TASK_COST_EVENT_SCHEMA_VERSION,
  TASK_COST_LEDGER_SCHEMA_VERSION,
  TASK_COST_SUMMARY_SCHEMA_VERSION,
} from './schema-version.js';
import type { TaskCostSummaryV1 } from './summary.js';
import {
  TASK_COST_TOKEN_FIELDS,
  deriveUsageAvailability,
  type TaskCostTokenUsage,
} from './token-usage.js';

export type TaskCostValidationCode =
  | 'schema_validation_failed'
  | 'forbidden_field'
  | 'unknown_schema_version'
  | 'usage_out_of_range'
  | 'invalid_timestamp'
  | 'replay_cycle'
  | 'mixed_scope';

export class TaskCostValidationError extends Error {
  code: TaskCostValidationCode;

  constructor(code: TaskCostValidationCode, message: string) {
    super(message);
    this.name = 'TaskCostValidationError';
    this.code = code;
  }
}

/**
 * Keys that may never appear anywhere in a task-cost record. Compared after
 * lower-casing and stripping `_`/`-`, so `account_id`, `accountId`, and
 * `Account-ID` are all caught. Includes the contribution-row denylist.
 */
export const TASK_COST_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  // Shared with contribution rows.
  'prompt',
  'messages',
  'tasktext',
  'rawinput',
  'evalrecord',
  'originalprompt',
  'description',
  'issuebody',
  // Transcript / content.
  'transcript',
  'content',
  'text',
  'prompthash',
  // Filesystem and repository locations.
  'path',
  'filepath',
  'cwd',
  'directory',
  'dir',
  'repo',
  'repository',
  'workspace',
  'worktree',
  'branch',
  // Credentials and identity.
  'token',
  'apikey',
  'secret',
  'password',
  'credentials',
  'authorization',
  'email',
  'accountid',
  'userid',
  'username',
  'hostname',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
}

export function assertNoForbiddenKeys(value: unknown, path: readonly string[] = []): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, [...path, String(index)]);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (TASK_COST_FORBIDDEN_KEYS.has(normalizeKey(key))) {
      throw new TaskCostValidationError(
        'forbidden_field',
        `Forbidden field at ${[...path, key].join('.')}`,
      );
    }
    assertNoForbiddenKeys(child, [...path, key]);
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const PROVIDER_CONTRACT_PATTERN = /^[a-z][a-z0-9-]{0,31}\/[0-9]{1,4}$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string, code: TaskCostValidationCode = 'schema_validation_failed'): never {
  throw new TaskCostValidationError(code, message);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail(`${label} must be an identifier matching ${ID_PATTERN}`);
  }
  return value;
}

function optionalId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireId(value, label);
}

function requirePattern(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(`${label} must match ${pattern}`);
  }
  return value;
}

function requireModel(value: unknown, label: string): string {
  const model = requirePattern(value, MODEL_PATTERN, label);
  if (model.includes('..') || model.includes('//')) {
    fail(`${label} must not contain path-like sequences`);
  }
  return model;
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be an ISO-8601 UTC timestamp`, 'invalid_timestamp');
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) fail(`${label} must be an ISO-8601 UTC timestamp`, 'invalid_timestamp');
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    .map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  if (!roundTrips) fail(`${label} is not a real calendar time`, 'invalid_timestamp');
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function requireCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`, 'usage_out_of_range');
  }
  return value;
}

function requireNullableCount(value: unknown, label: string): number | null {
  return value === null ? null : requireCount(value, label);
}

function requireNullableUsd(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be null or a finite non-negative number`, 'usage_out_of_range');
  }
  return value;
}

function requireDiagnostics(value: unknown, label: string): void {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  for (const [index, code] of value.entries()) {
    requireEnum(code, TASK_COST_DIAGNOSTIC_CODES, `${label}[${index}]`);
  }
}

function requireStringArray(value: unknown, label: string, item: (v: unknown, l: string) => string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => item(entry, `${label}[${index}]`));
}

function requireTokenUsage(value: unknown, label: string): TaskCostTokenUsage {
  const record = requireObject(value, label);
  const usage = {} as TaskCostTokenUsage;
  for (const field of TASK_COST_TOKEN_FIELDS) {
    if (!(field in record)) fail(`${label}.${field} is required (use null for missing)`);
    usage[field] = requireNullableCount(record[field], `${label}.${field}`);
  }
  return usage;
}

function checkSchemaVersion(record: Record<string, unknown>, expected: string, label: string): void {
  const version = record.schema_version;
  if (typeof version !== 'string') fail(`${label}.schema_version is required`);
  if (version !== expected) {
    fail(`${label}.schema_version "${version}" is not supported (expected ${expected})`, 'unknown_schema_version');
  }
}

export function validateTaskCostEventV1(value: unknown): asserts value is TaskCostEventV1 {
  const record = requireObject(value, 'event');
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_COST_EVENT_SCHEMA_VERSION, 'event');

  const eventId = requireId(record.event_id, 'event.event_id');
  requireId(record.task_id, 'event.task_id');
  requireId(record.session_id, 'event.session_id');
  requireId(record.turn_id, 'event.turn_id');
  requireCount(record.sequence, 'event.sequence');
  optionalId(record.parent_event_id, 'event.parent_event_id');
  if (record.is_subagent !== undefined) requireBoolean(record.is_subagent, 'event.is_subagent');
  const replayOf = optionalId(record.replay_of_event_id, 'event.replay_of_event_id');
  if (replayOf === eventId) fail('event.replay_of_event_id must not reference the event itself');

  requireEnum(record.harness, TASK_COST_HARNESSES, 'event.harness');
  if (record.harness_version !== undefined) {
    requirePattern(record.harness_version, VERSION_PATTERN, 'event.harness_version');
  }
  requirePattern(record.provider_contract_version, PROVIDER_CONTRACT_PATTERN, 'event.provider_contract_version');
  requireModel(record.observed_model, 'event.observed_model');
  requireEnum(record.usage_kind, TASK_COST_USAGE_KINDS, 'event.usage_kind');

  const usage = requireTokenUsage(record.usage, 'event.usage');
  const usageCoverage = requireEnum(record.usage_coverage, TASK_COST_FIELD_AVAILABILITIES, 'event.usage_coverage');
  const derivedCoverage = deriveUsageAvailability(usage);
  if (usageCoverage !== derivedCoverage) {
    fail(`event.usage_coverage is "${usageCoverage}" but usage implies "${derivedCoverage}"`);
  }

  const actual = requireNullableUsd(record.actual_cost_usd, 'event.actual_cost_usd');
  const estimated = requireNullableUsd(record.estimated_cost_usd, 'event.estimated_cost_usd');
  const costSource = requireEnum(record.cost_source, TASK_COST_EVENT_SOURCES, 'event.cost_source');
  const expectedSource =
    actual !== null ? 'provider_reported' : estimated !== null ? 'local_estimate' : 'none';
  if (costSource !== expectedSource) {
    fail(`event.cost_source is "${costSource}" but the cost fields imply "${expectedSource}"`);
  }

  const basis = requireEnum(record.cost_basis, TASK_COST_BASES, 'event.cost_basis');
  if (basis === 'subscription' && actual !== null) {
    fail('event.actual_cost_usd must be null when cost_basis is "subscription"');
  }

  const pricingSource = requireEnum(record.pricing_source, TASK_COST_PRICING_SOURCES, 'event.pricing_source');
  if (pricingSource === 'mixed') fail('event.pricing_source "mixed" is only legal on summaries');
  if ((pricingSource === 'none') !== (estimated === null)) {
    fail('event.pricing_source must be "none" exactly when estimated_cost_usd is null');
  }
  if (record.pricing_revision !== undefined) {
    requirePattern(record.pricing_revision, VERSION_PATTERN, 'event.pricing_revision');
  }
  if (record.price_table !== undefined) {
    requireEnum(record.price_table, TASK_COST_PRICE_TABLES, 'event.price_table');
  }
  requireTimestamp(record.observed_at, 'event.observed_at');
  if (record.diagnostics !== undefined) requireDiagnostics(record.diagnostics, 'event.diagnostics');
}

export function validateTaskCostSummaryV1(value: unknown): asserts value is TaskCostSummaryV1 {
  const record = requireObject(value, 'summary');
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_COST_SUMMARY_SCHEMA_VERSION, 'summary');

  requireId(record.task_id, 'summary.task_id');
  requireStringArray(record.session_ids, 'summary.session_ids', requireId);
  optionalId(record.root_session_id, 'summary.root_session_id');
  requireEnum(record.harness, TASK_COST_HARNESSES, 'summary.harness');
  if (record.harness_version !== undefined) {
    requirePattern(record.harness_version, VERSION_PATTERN, 'summary.harness_version');
  }
  requirePattern(record.provider_contract_version, PROVIDER_CONTRACT_PATTERN, 'summary.provider_contract_version');
  requireStringArray(record.models, 'summary.models', requireModel);

  if (!Array.isArray(record.model_segments)) fail('summary.model_segments must be an array');
  for (const [index, entry] of record.model_segments.entries()) {
    const label = `summary.model_segments[${index}]`;
    const segment = requireObject(entry, label);
    requireModel(segment.model, `${label}.model`);
    requireCount(segment.turn_count, `${label}.turn_count`);
    requireTokenUsage(segment.usage, `${label}.usage`);
    requireNullableUsd(segment.actual_cost_usd, `${label}.actual_cost_usd`);
    requireNullableUsd(segment.estimated_cost_usd, `${label}.estimated_cost_usd`);
    requireEnum(segment.cost_source, TASK_COST_SOURCES, `${label}.cost_source`);
  }

  requireCount(record.turn_count, 'summary.turn_count');
  requireBoolean(record.turns_truncated, 'summary.turns_truncated');
  requireTokenUsage(record.usage, 'summary.usage');
  requireNullableUsd(record.actual_cost_usd, 'summary.actual_cost_usd');
  requireNullableUsd(record.estimated_cost_usd, 'summary.estimated_cost_usd');
  requireNullableUsd(record.total_cost_usd, 'summary.total_cost_usd');
  requireEnum(record.cost_source, TASK_COST_SOURCES, 'summary.cost_source');
  requireEnum(record.cost_basis, TASK_COST_BASES, 'summary.cost_basis');
  requireEnum(record.coverage, TASK_COST_COVERAGES, 'summary.coverage');

  const availability = requireObject(record.field_availability, 'summary.field_availability');
  for (const key of ['usage', 'actual_cost', 'estimated_cost', 'pricing']) {
    requireEnum(availability[key], TASK_COST_FIELD_AVAILABILITIES, `summary.field_availability.${key}`);
  }

  if (record.pricing_revision !== undefined) {
    requirePattern(record.pricing_revision, VERSION_PATTERN, 'summary.pricing_revision');
  }
  if (record.pricing_timestamp !== undefined) requireTimestamp(record.pricing_timestamp, 'summary.pricing_timestamp');
  requireEnum(record.pricing_source, TASK_COST_PRICING_SOURCES, 'summary.pricing_source');
  requireEnum(record.join_confidence, TASK_COST_JOIN_CONFIDENCES, 'summary.join_confidence');
  requireTimestamp(record.collected_at, 'summary.collected_at');

  const eventCount = requireCount(record.event_count, 'summary.event_count');
  const eventIds = requireStringArray(record.event_ids, 'summary.event_ids', requireId);
  if (eventIds.length !== eventCount) fail('summary.event_count must equal event_ids.length');
  requireDiagnostics(record.diagnostics, 'summary.diagnostics');
}

export function validateTaskCostLedgerV1(value: unknown): asserts value is TaskCostLedgerV1 {
  const record = requireObject(value, 'ledger');
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_COST_LEDGER_SCHEMA_VERSION, 'ledger');

  const harness = requireEnum(record.harness, TASK_COST_HARNESSES, 'ledger.harness');
  if (record.harness_version !== undefined) {
    requirePattern(record.harness_version, VERSION_PATTERN, 'ledger.harness_version');
  }
  const providerContract = requirePattern(
    record.provider_contract_version,
    PROVIDER_CONTRACT_PATTERN,
    'ledger.provider_contract_version',
  );
  const sessionId = requireId(record.session_id, 'ledger.session_id');
  const taskIds = requireStringArray(record.task_ids, 'ledger.task_ids', requireId);
  requireTimestamp(record.opened_at, 'ledger.opened_at');
  if (record.closed_at !== undefined) requireTimestamp(record.closed_at, 'ledger.closed_at');
  requireBoolean(record.truncated, 'ledger.truncated');
  const eventCount = requireCount(record.event_count, 'ledger.event_count');

  if (!Array.isArray(record.events)) fail('ledger.events must be an array');
  if (record.events.length !== eventCount) fail('ledger.event_count must equal events.length');

  const seenTaskIds = new Set<string>();
  for (const [index, event] of record.events.entries()) {
    validateTaskCostEventV1(event);
    const label = `ledger.events[${index}]`;
    if (event.session_id !== sessionId) fail(`${label}.session_id must match ledger.session_id`);
    if (event.harness !== harness) fail(`${label}.harness must match ledger.harness`);
    if (event.provider_contract_version !== providerContract) {
      fail(`${label}.provider_contract_version must match ledger.provider_contract_version`);
    }
    seenTaskIds.add(event.task_id);
  }

  const expected = [...seenTaskIds].sort();
  if (taskIds.length !== expected.length || taskIds.some((id, index) => id !== expected[index])) {
    fail('ledger.task_ids must be the sorted, de-duplicated task_ids of its events');
  }
}

function makeGuard<T>(validate: (value: unknown) => asserts value is T): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    try {
      validate(value);
      return true;
    } catch (error) {
      if (error instanceof TaskCostValidationError) return false;
      throw error;
    }
  };
}

export const isTaskCostEventV1 = makeGuard<TaskCostEventV1>(validateTaskCostEventV1);
export const isTaskCostSummaryV1 = makeGuard<TaskCostSummaryV1>(validateTaskCostSummaryV1);
export const isTaskCostLedgerV1 = makeGuard<TaskCostLedgerV1>(validateTaskCostLedgerV1);
