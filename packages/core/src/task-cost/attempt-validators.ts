/**
 * Runtime validators for `task_attempt/v1` records. Like the other task-cost
 * validators they are normative for single-record shape; the JSON schema
 * (`packages/core/schemas/task-attempt.v1.schema.json`) mirrors them for
 * non-JS consumers. Cross-record rules (currency, settlement, edge targets)
 * belong to the reducer, `reduceTaskAttemptLog`.
 *
 * @module task-cost/attempt-validators
 */

import {
  TASK_ATTEMPT_ARM_ROLES,
  TASK_ATTEMPT_CONTROL_ACTIONS,
  TASK_ATTEMPT_EVIDENCE_KINDS,
  TASK_ATTEMPT_KINDS,
  TASK_ATTEMPT_OUTCOMES,
  TASK_ATTEMPT_RECORD_TYPES,
  type TaskAttemptLogEntryV1,
  type TaskAttemptRef,
} from './attempt.js';
import { TASK_ATTEMPT_SCHEMA_VERSION } from './schema-version.js';
import {
  TaskCostValidationError,
  assertNoForbiddenKeys,
  checkSchemaVersion,
  fail,
  requireEnum,
  requireId,
  requireMintedId,
  requireModel,
  requireObject,
  requirePattern,
  requireTimestamp,
} from './validators.js';

export const TASK_ATTEMPT_SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const HARNESS_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CHANGE_ID_PATTERN = /^[a-z0-9-]{1,16}:[0-9a-f]{16,128}$/;
const PENDING_SESSION_PATTERN = /^pending:[A-Za-z0-9._-]{1,120}$/;
/** Producer labels may carry `@`/`#` (Wavemill's `kind@head7#epoch`), never a dotted domain. */
const LEGACY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@#-]{0,127}$/;
const EMAIL_SHAPE = /@[^@]*\.[A-Za-z]{2,}$/;

function forbidKey(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined) fail(`${label}.${key} is not allowed here`);
}

export function validateTaskAttemptRef(value: unknown, label = 'attempt'): asserts value is TaskAttemptRef {
  const ref = requireObject(value, label);
  requireId(ref.task_id, `${label}.task_id`);
  requireMintedId(ref.run_id, `${label}.run_id`);
  if (ref.stage_attempt_id !== undefined) {
    requireMintedId(ref.stage_attempt_id, `${label}.stage_attempt_id`);
  }
}

function validateCodeIdentity(value: unknown, label: string): void {
  const code = requireObject(value, label);
  if (code.head_sha !== undefined) requirePattern(code.head_sha, GIT_SHA_PATTERN, `${label}.head_sha`);
  if (code.base_sha !== undefined) requirePattern(code.base_sha, GIT_SHA_PATTERN, `${label}.base_sha`);
  if (code.change_id !== undefined) requirePattern(code.change_id, CHANGE_ID_PATTERN, `${label}.change_id`);
}

function validateSessionRefs(value: unknown, label: string): void {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  for (const [index, entry] of value.entries()) {
    const itemLabel = `${label}[${index}]`;
    const ref = requireObject(entry, itemLabel);
    requirePattern(ref.harness, HARNESS_SLUG_PATTERN, `${itemLabel}.harness`);
    const sessionId = requireId(ref.session_id, `${itemLabel}.session_id`);
    if (ref.resolves !== undefined) {
      requirePattern(ref.resolves, PENDING_SESSION_PATTERN, `${itemLabel}.resolves`);
      if (PENDING_SESSION_PATTERN.test(sessionId)) {
        fail(`${itemLabel}.session_id must be resolved when it resolves a pending session`);
      }
    }
  }
}

function validateEvidenceVersion(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(`${label} must be a positive integer`);
  }
  return value;
}

function validateAttemptRecord(record: Record<string, unknown>): void {
  const kind = requireEnum(record.kind, TASK_ATTEMPT_KINDS, 'attempt.kind');
  const id = requireMintedId(record.id, 'attempt.id');
  const taskId = requireId(record.task_id, 'attempt.task_id');
  const parentId = requireId(record.parent_id, 'attempt.parent_id');
  if (parentId === id) fail('attempt.parent_id must not reference the attempt itself');

  switch (kind) {
    case 'pair':
      if (parentId !== taskId) fail('attempt.parent_id of a pair must be its task_id');
      break;
    case 'run':
      if (parentId !== taskId) requireMintedId(parentId, 'attempt.parent_id');
      break;
    case 'arm':
    case 'stage_attempt':
      requireMintedId(parentId, 'attempt.parent_id');
      break;
  }

  if (kind === 'stage_attempt') {
    requirePattern(record.stage, TASK_ATTEMPT_SLUG_PATTERN, 'attempt.stage');
  } else {
    forbidKey(record, 'stage', 'attempt');
  }
  if (kind === 'arm') {
    requireEnum(record.role, TASK_ATTEMPT_ARM_ROLES, 'attempt.role');
  } else {
    forbidKey(record, 'role', 'attempt');
  }
  if (record.retry_of !== undefined) {
    if (kind !== 'run' && kind !== 'stage_attempt') fail('attempt.retry_of is only legal on runs and stage attempts');
    const retryOf = requireMintedId(record.retry_of, 'attempt.retry_of');
    if (retryOf === id) fail('attempt.retry_of must not reference the attempt itself');
    if (retryOf === parentId) fail('attempt.retry_of must not reference the parent (a child is not a retry)');
  }
  if (record.code_identity !== undefined) validateCodeIdentity(record.code_identity, 'attempt.code_identity');
  if (record.session_refs !== undefined) validateSessionRefs(record.session_refs, 'attempt.session_refs');
  if (record.legacy_ids !== undefined) {
    if (!Array.isArray(record.legacy_ids)) fail('attempt.legacy_ids must be an array');
    for (const [index, legacy] of record.legacy_ids.entries()) {
      const label = `attempt.legacy_ids[${index}]`;
      const text = requirePattern(legacy, LEGACY_ID_PATTERN, label);
      if (EMAIL_SHAPE.test(text)) fail(`${label} must not be address-shaped`);
    }
  }
}

function validateControlWrite(record: Record<string, unknown>): void {
  requireMintedId(record.write_id, 'control.write_id');
  validateTaskAttemptRef(record.attempt, 'control.attempt');
  const action = requireEnum(record.action, TASK_ATTEMPT_CONTROL_ACTIONS, 'control.action');
  if (action === 'outcome') {
    requireEnum(record.outcome, TASK_ATTEMPT_OUTCOMES, 'control.outcome');
    forbidKey(record, 'value', 'control');
  } else {
    forbidKey(record, 'outcome', 'control');
    requirePattern(record.value, TASK_ATTEMPT_SLUG_PATTERN, 'control.value');
  }
}

function validateEvidenceWrite(record: Record<string, unknown>): void {
  requireMintedId(record.write_id, 'evidence.write_id');
  validateTaskAttemptRef(record.attempt, 'evidence.attempt');
  requireEnum(record.evidence_kind, TASK_ATTEMPT_EVIDENCE_KINDS, 'evidence.evidence_kind');
  validateEvidenceVersion(record.evidence_version, 'evidence.evidence_version');
  if (record.executed_model !== undefined) requireModel(record.executed_model, 'evidence.executed_model');
  if (record.session_refs !== undefined) validateSessionRefs(record.session_refs, 'evidence.session_refs');
  if (record.code_identity !== undefined) validateCodeIdentity(record.code_identity, 'evidence.code_identity');
  if (record.cost_event_ids !== undefined) {
    if (!Array.isArray(record.cost_event_ids)) fail('evidence.cost_event_ids must be an array');
    for (const [index, eventId] of record.cost_event_ids.entries()) {
      requireId(eventId, `evidence.cost_event_ids[${index}]`);
    }
  }
}

function validateDerivedResult(record: Record<string, unknown>): void {
  const derivedId = requireMintedId(record.derived_id, 'derived.derived_id');
  requirePattern(record.derived_kind, TASK_ATTEMPT_SLUG_PATTERN, 'derived.derived_kind');
  if (!Array.isArray(record.inputs) || record.inputs.length === 0) {
    fail('derived.inputs must be a non-empty array');
  }
  for (const [index, entry] of record.inputs.entries()) {
    const label = `derived.inputs[${index}]`;
    const input = requireObject(entry, label);
    validateTaskAttemptRef(input.attempt, `${label}.attempt`);
    requireEnum(input.evidence_kind, TASK_ATTEMPT_EVIDENCE_KINDS, `${label}.evidence_kind`);
    validateEvidenceVersion(input.evidence_version, `${label}.evidence_version`);
  }
  if (record.supersedes !== undefined) {
    const supersedes = requireMintedId(record.supersedes, 'derived.supersedes');
    if (supersedes === derivedId) fail('derived.supersedes must not reference the result itself');
  }
}

/** Validates one `task_attempt/v1` log entry of any record type. */
export function validateTaskAttemptLogEntryV1(value: unknown): asserts value is TaskAttemptLogEntryV1 {
  const record = requireObject(value, 'task_attempt');
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_ATTEMPT_SCHEMA_VERSION, 'task_attempt');
  const recordType = requireEnum(record.record_type, TASK_ATTEMPT_RECORD_TYPES, 'task_attempt.record_type');
  requireTimestamp(record.observed_at, `${recordType}.observed_at`);
  switch (recordType) {
    case 'attempt':
      validateAttemptRecord(record);
      break;
    case 'control':
      validateControlWrite(record);
      break;
    case 'evidence':
      validateEvidenceWrite(record);
      break;
    case 'derived':
      validateDerivedResult(record);
      break;
  }
}

export function isTaskAttemptLogEntryV1(value: unknown): value is TaskAttemptLogEntryV1 {
  try {
    validateTaskAttemptLogEntryV1(value);
    return true;
  } catch (error) {
    if (error instanceof TaskCostValidationError) return false;
    throw error;
  }
}
