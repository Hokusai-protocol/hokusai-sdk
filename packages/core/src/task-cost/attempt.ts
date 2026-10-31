/**
 * Attempt identity for the task-cost contract (`task_attempt/v1`, HOK-3372).
 *
 * One definition of *which attempt* a fact belongs to, shared by every
 * producer (Wavemill task rows, stage results, session ownership, queue/CI
 * events) and every consumer (Hokusai training data, challenge comparisons).
 *
 * - **IDs are minted, not derived.** `run_id`, `pair_id`, `arm_id`,
 *   `stage_attempt_id`, `write_id` and `derived_id` are UUIDs (v7
 *   recommended) or ULIDs, minted before the launch, persisted with it, and
 *   never recomputed from a head SHA, a timestamp or a session. `task_id` is
 *   the issue identifier.
 * - **Edges are typed and separate.** `parent_id` is structural containment
 *   (stage attempt in a run, run in a task or arm, arm in a pair, pair in a
 *   task). `retry_of` says "this replaces a failed or abandoned sibling". A
 *   child is never a retry.
 * - **Associated fields are not identity.** `code_identity`, `session_refs`
 *   and `evidence_version` may change or arrive late without changing an ID.
 * - **Control writes** (outcome, phase, next action, Linear transition, merge
 *   decision) are accepted only for the current, unsettled attempt.
 *   **Evidence writes** (executed model, session resolution, cost, review
 *   findings, check runs, code identity) are always accepted against their own
 *   attempt, current or not.
 *
 * Full rules: `attempt-identity.md` in this directory.
 *
 * @module task-cost/attempt
 */

import type { TASK_ATTEMPT_SCHEMA_VERSION } from './schema-version.js';

/** Kinds of minted entity. A task is the issue itself and is never minted. */
export const TASK_ATTEMPT_KINDS = ['pair', 'arm', 'run', 'stage_attempt'] as const;
export type TaskAttemptKind = (typeof TASK_ATTEMPT_KINDS)[number];

export const TASK_ATTEMPT_ARM_ROLES = ['primary', 'challenger'] as const;
export type TaskAttemptArmRole = (typeof TASK_ATTEMPT_ARM_ROLES)[number];

/** Writes that change execution state. Rejected unless the attempt is current. */
export const TASK_ATTEMPT_CONTROL_ACTIONS = [
  'outcome',
  'phase',
  'next_action',
  'linear_transition',
  'merge_decision',
] as const;
export type TaskAttemptControlAction = (typeof TASK_ATTEMPT_CONTROL_ACTIONS)[number];

/** The settled outcome of an attempt. Settles once. */
export const TASK_ATTEMPT_OUTCOMES = ['succeeded', 'failed', 'aborted', 'abandoned'] as const;
export type TaskAttemptOutcome = (typeof TASK_ATTEMPT_OUTCOMES)[number];

/** Writes that describe an attempt. Always accepted against their own identity. */
export const TASK_ATTEMPT_EVIDENCE_KINDS = [
  'executed_model',
  'session_resolution',
  'cost',
  'review_findings',
  'check_run',
  'code_identity',
] as const;
export type TaskAttemptEvidenceKind = (typeof TASK_ATTEMPT_EVIDENCE_KINDS)[number];

export const TASK_ATTEMPT_RECORD_TYPES = ['attempt', 'control', 'evidence', 'derived'] as const;
export type TaskAttemptRecordType = (typeof TASK_ATTEMPT_RECORD_TYPES)[number];

/**
 * The code an attempt saw. Associated with the attempt, never part of its
 * identity: a head can move, or be learned late, without a new ID.
 */
export interface TaskAttemptCodeIdentity {
  /** Full 40- or 64-hex git object id. */
  head_sha?: string;
  base_sha?: string;
  /**
   * The change identity when head/base are not enough: a digest of the diff
   * against the merge-base (`sha256:<64 hex>` recommended).
   */
  change_id?: string;
}

/**
 * A harness session that worked on an attempt. A pending Codex session is
 * `pending:<nonce>`; its resolution is a new ref with `resolves` set to the
 * pending value, added to the same attempt.
 */
export interface TaskAttemptSessionRef {
  harness: string;
  session_id: string;
  resolves?: string;
}

/**
 * How a record or event names the attempt it belongs to. Every downstream
 * record (cost events, stage results, queue/CI events) embeds this instead of
 * defining its own run or attempt id.
 */
export interface TaskAttemptRef {
  task_id: string;
  run_id: string;
  /** Present for facts about one stage attempt. Must belong to `run_id`. */
  stage_attempt_id?: string;
}

interface TaskAttemptRecordBase {
  schema_version: typeof TASK_ATTEMPT_SCHEMA_VERSION;
  record_type: TaskAttemptRecordType;
  /** ISO-8601 UTC. Informational; the log's arrival order decides currency. */
  observed_at: string;
}

/**
 * The launch of one minted entity. Written before the work starts.
 *
 * Containment (`parent_id`):
 * - `pair`: the task (`task_id`).
 * - `arm`: a pair. `role` is required.
 * - `run`: the task, or an arm when the run is a challenge arm.
 * - `stage_attempt`: a run. `stage` is required.
 */
export interface TaskAttemptRecordV1 extends TaskAttemptRecordBase {
  record_type: 'attempt';
  kind: TaskAttemptKind;
  /** The minted ID of this entity (its `run_id`, `stage_attempt_id`, ...). */
  id: string;
  task_id: string;
  parent_id: string;
  /** Stage slug, e.g. `planning`. Required iff `kind === 'stage_attempt'`. */
  stage?: string;
  /** Required iff `kind === 'arm'`. */
  role?: TaskAttemptArmRole;
  /** A failed or abandoned sibling (same kind, parent and stage) this replaces. */
  retry_of?: string;
  code_identity?: TaskAttemptCodeIdentity;
  session_refs?: TaskAttemptSessionRef[];
  /**
   * Producer-local labels (e.g. Wavemill's `planning@abc1234#1793396483`).
   * Not unique and never a key; carried only to join legacy records.
   */
  legacy_ids?: string[];
}

/** A write that changes execution state. */
export interface TaskAttemptControlWriteV1 extends TaskAttemptRecordBase {
  record_type: 'control';
  /** Minted idempotency key. */
  write_id: string;
  attempt: TaskAttemptRef;
  action: TaskAttemptControlAction;
  /** Required iff `action === 'outcome'`. */
  outcome?: TaskAttemptOutcome;
  /** Slug for the other actions (phase name, next action, Linear state, merge decision). */
  value?: string;
}

/** A write that describes an attempt. */
export interface TaskAttemptEvidenceWriteV1 extends TaskAttemptRecordBase {
  record_type: 'evidence';
  write_id: string;
  attempt: TaskAttemptRef;
  evidence_kind: TaskAttemptEvidenceKind;
  /**
   * Monotonic per `(attempt, evidence_kind)`, starting at 1. A higher version
   * supersedes a lower one; derived results record the versions they read.
   */
  evidence_version: number;
  executed_model?: string;
  session_refs?: TaskAttemptSessionRef[];
  code_identity?: TaskAttemptCodeIdentity;
  /** `TaskCostEventV1.event_id`s this cost evidence covers. */
  cost_event_ids?: string[];
}

/** One evidence version a derived result read. */
export interface TaskAttemptDerivedInput {
  attempt: TaskAttemptRef;
  evidence_kind: TaskAttemptEvidenceKind;
  evidence_version: number;
}

/**
 * A result computed from evidence (e.g. a challenge comparison). It records the
 * evidence versions it read, so a newer version makes it stale and it is
 * recomputed as a new `derived_id` that `supersedes` the old one.
 */
export interface TaskAttemptDerivedResultV1 extends TaskAttemptRecordBase {
  record_type: 'derived';
  derived_id: string;
  /** Slug, e.g. `challenge_comparison`. */
  derived_kind: string;
  inputs: TaskAttemptDerivedInput[];
  supersedes?: string;
}

export type TaskAttemptLogEntryV1 =
  | TaskAttemptRecordV1
  | TaskAttemptControlWriteV1
  | TaskAttemptEvidenceWriteV1
  | TaskAttemptDerivedResultV1;
