import type {
  TaskAttemptCodeIdentity,
  TaskAttemptControlAction,
  TaskAttemptControlWriteV1,
  TaskAttemptDerivedInput,
  TaskAttemptDerivedResultV1,
  TaskAttemptEvidenceKind,
  TaskAttemptEvidenceWriteV1,
  TaskAttemptKind,
  TaskAttemptLogEntryV1,
  TaskAttemptOutcome,
  TaskAttemptRecordV1,
  TaskAttemptRef,
  TaskAttemptSessionRef,
} from '../../../task-cost/attempt.js';
import type {
  TaskAttemptDecision,
  TaskAttemptDecisionReason,
  TaskAttemptDerivedState,
  TaskAttemptLogResult,
  TaskAttemptState,
} from '../../../task-cost/attempt-reducer.js';

/**
 * A golden attempt-identity fixture: an ordered `task_attempt/v1` log and the
 * hand-written result `reduceTaskAttemptLog` must produce.
 */
export interface TaskAttemptFixture {
  name: string;
  description: string;
  log: TaskAttemptLogEntryV1[];
  expected: TaskAttemptLogResult;
  /** Expected `derived` states after only the first `length` entries. */
  prefixExpectations?: { length: number; derived: TaskAttemptDerivedState[] }[];
  /**
   * Illustrative downstream records (e.g. an MQ-1.2 merge candidate) that embed
   * attempt refs instead of defining their own run ids. Not log entries.
   */
  extensionRecords?: { event_id: string; candidate_id: string; attempt_refs: TaskAttemptRef[] }[];
}

/** Deterministic UUIDv7-shaped ids. Synthetic; never derived from anything. */
export function mint(n: number): string {
  return `019a3c00-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Seconds after 2026-10-31T12:00:00Z. */
export function at(seconds: number): string {
  const date = new Date(Date.UTC(2026, 9, 31, 12, 0, 0) + seconds * 1000);
  return date.toISOString().replace('.000Z', 'Z');
}

export const TASK = 'HOK-9001';
export const OTHER_TASK = 'HOK-9002';
export const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
export const BASE = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';

export interface AttemptInput {
  kind: TaskAttemptKind;
  id: string;
  parent: string;
  task?: string;
  stage?: string;
  role?: 'primary' | 'challenger';
  retryOf?: string;
  t: number;
  legacy?: string[];
  code?: TaskAttemptCodeIdentity;
  sessions?: TaskAttemptSessionRef[];
}

export function attempt(input: AttemptInput): TaskAttemptRecordV1 {
  return {
    schema_version: 'task_attempt/v1',
    record_type: 'attempt',
    observed_at: at(input.t),
    kind: input.kind,
    id: input.id,
    task_id: input.task ?? TASK,
    parent_id: input.parent,
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.retryOf !== undefined ? { retry_of: input.retryOf } : {}),
    ...(input.code !== undefined ? { code_identity: input.code } : {}),
    ...(input.sessions !== undefined ? { session_refs: input.sessions } : {}),
    ...(input.legacy !== undefined ? { legacy_ids: input.legacy } : {}),
  };
}

export function ref(runId: string, stageAttemptId?: string, task: string = TASK): TaskAttemptRef {
  return {
    task_id: task,
    run_id: runId,
    ...(stageAttemptId !== undefined ? { stage_attempt_id: stageAttemptId } : {}),
  };
}

export function outcome(
  writeId: string,
  attemptRef: TaskAttemptRef,
  value: TaskAttemptOutcome,
  t: number,
): TaskAttemptControlWriteV1 {
  return {
    schema_version: 'task_attempt/v1',
    record_type: 'control',
    observed_at: at(t),
    write_id: writeId,
    attempt: attemptRef,
    action: 'outcome',
    outcome: value,
  };
}

export function control(
  writeId: string,
  attemptRef: TaskAttemptRef,
  action: Exclude<TaskAttemptControlAction, 'outcome'>,
  value: string,
  t: number,
): TaskAttemptControlWriteV1 {
  return {
    schema_version: 'task_attempt/v1',
    record_type: 'control',
    observed_at: at(t),
    write_id: writeId,
    attempt: attemptRef,
    action,
    value,
  };
}

export function evidence(
  writeId: string,
  attemptRef: TaskAttemptRef,
  kind: TaskAttemptEvidenceKind,
  version: number,
  t: number,
  payload: Partial<
    Pick<TaskAttemptEvidenceWriteV1, 'executed_model' | 'session_refs' | 'code_identity' | 'cost_event_ids'>
  > = {},
): TaskAttemptEvidenceWriteV1 {
  return {
    schema_version: 'task_attempt/v1',
    record_type: 'evidence',
    observed_at: at(t),
    write_id: writeId,
    attempt: attemptRef,
    evidence_kind: kind,
    evidence_version: version,
    ...payload,
  };
}

export function derivedResult(
  derivedId: string,
  inputs: TaskAttemptDerivedInput[],
  t: number,
  supersedes?: string,
): TaskAttemptDerivedResultV1 {
  return {
    schema_version: 'task_attempt/v1',
    record_type: 'derived',
    observed_at: at(t),
    derived_id: derivedId,
    derived_kind: 'challenge_comparison',
    inputs,
    ...(supersedes !== undefined ? { supersedes } : {}),
  };
}

/** Expected decision for log position `index`. */
export function decision(
  index: number,
  entry: TaskAttemptLogEntryV1,
  value: TaskAttemptDecision['decision'],
  reasons?: TaskAttemptDecisionReason[],
): TaskAttemptDecision {
  const key =
    entry.record_type === 'attempt'
      ? entry.id
      : entry.record_type === 'derived'
        ? entry.derived_id
        : entry.write_id;
  return {
    index,
    record_type: entry.record_type,
    key,
    decision: value,
    ...(reasons !== undefined ? { reasons } : {}),
  };
}

/** Expected state of a declared entity. */
export function state(
  record: TaskAttemptRecordV1,
  overrides: Partial<TaskAttemptState> & Pick<TaskAttemptState, 'current'>,
): TaskAttemptState {
  return {
    id: record.id,
    kind: record.kind,
    task_id: record.task_id,
    parent_id: record.parent_id,
    ...(record.stage !== undefined ? { stage: record.stage } : {}),
    ...(record.role !== undefined ? { role: record.role } : {}),
    ...(record.retry_of !== undefined ? { retry_of: record.retry_of } : {}),
    outcome: null,
    ...(record.code_identity !== undefined ? { code_identity: record.code_identity } : {}),
    session_refs: record.session_refs ?? [],
    ...overrides,
  };
}
