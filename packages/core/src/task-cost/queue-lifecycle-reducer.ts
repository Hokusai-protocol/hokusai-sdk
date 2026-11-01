/**
 * Reference reducer for `queue_lifecycle_event/v1` (HOK-3338). It applies the
 * contract's write rules to one arrival-ordered stream that interleaves queue
 * events with the `task_attempt/v1` log they depend on, and reports for every
 * queue event whether it was accepted.
 *
 * Attempt rules are not redefined here: before judging a control event the
 * reducer runs `reduceTaskAttemptLog` over the attempt records seen so far and
 * applies HOK-3372's `unknown_attempt` / `ref_mismatch` / `stale_run` /
 * `stale_stage_attempt` / `settled` rules to every ref the event names.
 *
 * The reducer produces decisions and candidate composition only. Durations,
 * failure classes, attempts-to-land and time-to-land are derived elsewhere
 * (MQ-1.4) from the accepted events. Pure: no clock, no I/O.
 *
 * @module task-cost/queue-lifecycle-reducer
 */

import type { TaskAttemptLogEntryV1, TaskAttemptRef } from './attempt.js';
import { reduceTaskAttemptLog, type TaskAttemptState } from './attempt-reducer.js';
import { validateTaskAttemptLogEntryV1 } from './attempt-validators.js';
import {
  QUEUE_LIFECYCLE_EVENT_WRITE_CLASS,
  queueLifecycleEventAttemptRefs,
  type QueueCandidateEntry,
  type QueueLifecycleEventType,
  type QueueLifecycleEventV1,
} from './queue-lifecycle.js';
import { validateQueueLifecycleEventV1 } from './queue-lifecycle-validators.js';
import { QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION } from './schema-version.js';

export const QUEUE_LIFECYCLE_DECISIONS = ['accepted', 'rejected', 'duplicate'] as const;
export type QueueLifecycleDecisionKind = (typeof QUEUE_LIFECYCLE_DECISIONS)[number];

/** Why an event was rejected, or a note on an accepted one. Contract order. */
export const QUEUE_LIFECYCLE_DECISION_REASONS = [
  // Any event (rejected).
  'event_id_conflict',
  // Control events, per HOK-3372 (rejected). `ref_mismatch` also rejects evidence.
  'unknown_attempt',
  'ref_mismatch',
  'stale_run',
  'stale_stage_attempt',
  'settled',
  // Candidates (rejected).
  'candidate_id_reused',
  'unknown_candidate',
  'candidate_mismatch',
  'ejected_from_candidate',
  // Recovery decisions (rejected).
  'context_leak',
  // Evidence (accepted, noted).
  'undeclared_attempt',
  'undeclared_candidate',
] as const;
export type QueueLifecycleDecisionReason = (typeof QUEUE_LIFECYCLE_DECISION_REASONS)[number];

export interface QueueLifecycleDecision {
  /** Position in the input stream (attempt records count too). */
  index: number;
  event_id: string;
  event_type: QueueLifecycleEventType;
  decision: QueueLifecycleDecisionKind;
  /** Omitted when empty. */
  reasons?: QueueLifecycleDecisionReason[];
}

export interface QueueCandidateState {
  candidate_id: string;
  base_sha: string;
  attempt_refs: TaskAttemptRef[];
  entries: QueueCandidateEntry[];
  /** Runs with an accepted `ejected` naming this candidate, in arrival order. */
  ejected_run_ids: string[];
  /** Runs with an accepted `merged` naming this candidate, in arrival order. */
  merged_run_ids: string[];
}

export interface QueueLifecycleLogResult {
  /** One per queue event, in stream order. */
  decisions: QueueLifecycleDecision[];
  /** Accepted queue events, in arrival order. The input for derivations. */
  accepted_event_ids: string[];
  candidates: QueueCandidateState[];
}

export type QueueLifecycleStreamEntry = QueueLifecycleEventV1 | TaskAttemptLogEntryV1;

function isQueueEvent(entry: QueueLifecycleStreamEntry): entry is QueueLifecycleEventV1 {
  return entry.schema_version === QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION;
}

/** Key-sorted JSON, so a replay with reordered keys is still the same event. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameRefs(a: readonly TaskAttemptRef[], b: readonly TaskAttemptRef[]): boolean {
  return a.length === b.length && a.every((ref, index) => canonicalJson(ref) === canonicalJson(b[index]));
}

function inContractOrder(reasons: Set<QueueLifecycleDecisionReason>): QueueLifecycleDecisionReason[] {
  return QUEUE_LIFECYCLE_DECISION_REASONS.filter((reason) => reasons.has(reason));
}

/** HOK-3372 control rules for one ref, against the attempt state seen so far. */
function checkControlRef(
  ref: TaskAttemptRef,
  attempts: ReadonlyMap<string, TaskAttemptState>,
  reasons: Set<QueueLifecycleDecisionReason>,
): void {
  const run = attempts.get(ref.run_id);
  if (run === undefined) {
    reasons.add('unknown_attempt');
    return;
  }
  if (run.kind !== 'run' || run.task_id !== ref.task_id) {
    reasons.add('ref_mismatch');
    return;
  }
  let stage: TaskAttemptState | undefined;
  if (ref.stage_attempt_id !== undefined) {
    stage = attempts.get(ref.stage_attempt_id);
    if (stage === undefined) {
      reasons.add('unknown_attempt');
      return;
    }
    if (stage.kind !== 'stage_attempt' || stage.parent_id !== run.id) {
      reasons.add('ref_mismatch');
      return;
    }
  }
  if (!run.current) reasons.add('stale_run');
  if (stage !== undefined && !stage.current) reasons.add('stale_stage_attempt');
  if (run.outcome !== null || (stage !== undefined && stage.outcome !== null)) reasons.add('settled');
}

/** Evidence is accepted against its own attempt; only a contradictory ref is rejected. */
function checkEvidenceRef(
  ref: TaskAttemptRef,
  attempts: ReadonlyMap<string, TaskAttemptState>,
  reasons: Set<QueueLifecycleDecisionReason>,
): void {
  const run = attempts.get(ref.run_id);
  if (run !== undefined && (run.kind !== 'run' || run.task_id !== ref.task_id)) {
    reasons.add('ref_mismatch');
    return;
  }
  const stage = ref.stage_attempt_id === undefined ? undefined : attempts.get(ref.stage_attempt_id);
  if (stage !== undefined && (stage.kind !== 'stage_attempt' || stage.parent_id !== ref.run_id)) {
    reasons.add('ref_mismatch');
    return;
  }
  if (run === undefined || (ref.stage_attempt_id !== undefined && stage === undefined)) {
    reasons.add('undeclared_attempt');
  }
}

const ACCEPTED_NOTES: ReadonlySet<QueueLifecycleDecisionReason> = new Set(['undeclared_attempt', 'undeclared_candidate']);

/**
 * Applies the `queue_lifecycle_event/v1` rules to an arrival-ordered stream of
 * queue events and `task_attempt/v1` entries. Validates every entry first and
 * throws `TaskCostValidationError` on an invalid one.
 */
export function reduceQueueLifecycleLog(stream: readonly QueueLifecycleStreamEntry[]): QueueLifecycleLogResult {
  for (const entry of stream) {
    if (isQueueEvent(entry)) validateQueueLifecycleEventV1(entry);
    else validateTaskAttemptLogEntryV1(entry);
  }

  const decisions: QueueLifecycleDecision[] = [];
  const acceptedIds: string[] = [];
  const acceptedObservedAt = new Map<string, number>();
  const firstSeen = new Map<string, string>();
  const candidates = new Map<string, QueueCandidateState>();
  const attemptPrefix: TaskAttemptLogEntryV1[] = [];
  let attemptState: Map<string, TaskAttemptState> | null = new Map();

  const currentAttempts = (): Map<string, TaskAttemptState> => {
    if (attemptState === null) {
      attemptState = new Map(reduceTaskAttemptLog(attemptPrefix).attempts.map((state) => [state.id, state]));
    }
    return attemptState;
  };

  for (const [index, entry] of stream.entries()) {
    if (!isQueueEvent(entry)) {
      attemptPrefix.push(entry);
      attemptState = null;
      continue;
    }
    const event = entry;
    const base = { index, event_id: event.event_id, event_type: event.event_type };

    // Idempotency: first wins; an identical replay is a duplicate, a different
    // body under the same id is a conflict and never overwrites.
    const body = canonicalJson(event);
    const previous = firstSeen.get(event.event_id);
    if (previous !== undefined) {
      decisions.push(
        previous === body
          ? { ...base, decision: 'duplicate' }
          : { ...base, decision: 'rejected', reasons: ['event_id_conflict'] },
      );
      continue;
    }
    firstSeen.set(event.event_id, body);

    const reasons = new Set<QueueLifecycleDecisionReason>();
    const writeClass = QUEUE_LIFECYCLE_EVENT_WRITE_CLASS[event.event_type];
    const attempts = currentAttempts();
    for (const ref of queueLifecycleEventAttemptRefs(event)) {
      if (writeClass === 'control') checkControlRef(ref, attempts, reasons);
      else checkEvidenceRef(ref, attempts, reasons);
    }

    // Candidate rules.
    if (event.event_type === 'candidate_prepared') {
      if (candidates.has(event.candidate_id)) reasons.add('candidate_id_reused');
    } else if ('attempt_refs' in event) {
      const candidate = candidates.get(event.candidate_id);
      if (candidate === undefined) {
        reasons.add(writeClass === 'control' ? 'unknown_candidate' : 'undeclared_candidate');
      } else if (!sameRefs(candidate.attempt_refs, event.attempt_refs)) {
        reasons.add('candidate_mismatch');
      }
    } else if ((event.event_type === 'ejected' || event.event_type === 'merged') && event.candidate_id !== undefined) {
      const candidate = candidates.get(event.candidate_id);
      if (candidate === undefined) {
        reasons.add('unknown_candidate');
      } else if (!candidate.attempt_refs.some((ref) => canonicalJson(ref) === canonicalJson(event.attempt))) {
        reasons.add('candidate_mismatch');
      } else if (event.event_type === 'merged' && candidate.ejected_run_ids.includes(event.attempt.run_id)) {
        reasons.add('ejected_from_candidate');
      }
    }

    // A decision may only read what existed when it was made.
    if (event.event_type === 'recovery_decision') {
      const asOf = Date.parse(event.context.as_of);
      for (const id of event.context.event_ids) {
        const seenAt = acceptedObservedAt.get(id);
        if (seenAt === undefined || seenAt > asOf) reasons.add('context_leak');
      }
    }

    const rejected = [...reasons].some((reason) => !ACCEPTED_NOTES.has(reason));
    const ordered = inContractOrder(reasons);
    decisions.push({
      ...base,
      decision: rejected ? 'rejected' : 'accepted',
      ...(ordered.length > 0 ? { reasons: ordered } : {}),
    });
    if (rejected) continue;

    acceptedIds.push(event.event_id);
    acceptedObservedAt.set(event.event_id, Date.parse(event.observed_at));
    if (event.event_type === 'candidate_prepared') {
      candidates.set(event.candidate_id, {
        candidate_id: event.candidate_id,
        base_sha: event.base_sha,
        attempt_refs: event.attempt_refs,
        entries: event.entries,
        ejected_run_ids: [],
        merged_run_ids: [],
      });
    } else if ((event.event_type === 'ejected' || event.event_type === 'merged') && event.candidate_id !== undefined) {
      const candidate = candidates.get(event.candidate_id);
      const list = event.event_type === 'ejected' ? candidate?.ejected_run_ids : candidate?.merged_run_ids;
      if (list !== undefined && !list.includes(event.attempt.run_id)) list.push(event.attempt.run_id);
    }
  }

  return { decisions, accepted_event_ids: acceptedIds, candidates: [...candidates.values()] };
}
