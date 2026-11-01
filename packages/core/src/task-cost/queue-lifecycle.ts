/**
 * Queue, CI and repair lifecycle events for the task-cost contract
 * (`queue_lifecycle_event/v1`, contract 1.2.0, HOK-3338 / MQ-1.2).
 *
 * Integration and repair work are cost events for a task, so they extend the
 * task-cost contract instead of starting a parallel schema:
 *
 * - **Identity is `task_attempt/v1`.** Every event names the attempt(s) it is
 *   about with a `TaskAttemptRef` (PR scope) or `attempt_refs` (candidate
 *   scope). Nothing here defines a run or attempt id. `event_id` and
 *   `candidate_id` are minted idempotency keys, never hashes.
 * - **Write class is fixed by event type.** Enqueue, candidate, eject, rerun,
 *   recovery, merge, dequeue, abandon and review-start events are *control*
 *   writes (accepted only for the current, unsettled run). Check runs,
 *   rebases, repair commits and review results are *evidence* (always accepted
 *   against their own attempt).
 * - **Facts, not interpretations.** Conclusions, run attempts, SHAs, actors
 *   and timestamps. Durations, failure classes and time-to-land are derived by
 *   versioned functions elsewhere (MQ-1.4, MQ-0.2) and never stored here.
 * - **Intended vs observed are separate fields.** An observed model needs
 *   observation evidence; it is never copied from intent.
 * - **Absent means not reported.** `0`, `false` and `[]` are observed values;
 *   `unknown` is an explicit "the source did not say". `null` is not used.
 *
 * Full rules: `queue-lifecycle.md` in this directory.
 *
 * @module task-cost/queue-lifecycle
 */

import type { TaskAttemptRef } from './attempt.js';
import type { QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION } from './schema-version.js';

export const QUEUE_LIFECYCLE_EVENT_TYPES = [
  'enqueued',
  'candidate_prepared',
  'check_run_completed',
  'ejected',
  'rerun_requested',
  'rebase_performed',
  'repair_commit_pushed',
  'recovery_decision',
  'merged',
  'dequeued',
  'abandoned',
  'review_round_started',
  'review_round_completed',
] as const;
export type QueueLifecycleEventType = (typeof QUEUE_LIFECYCLE_EVENT_TYPES)[number];

export const QUEUE_LIFECYCLE_WRITE_CLASSES = ['control', 'evidence'] as const;
export type QueueLifecycleWriteClass = (typeof QUEUE_LIFECYCLE_WRITE_CLASSES)[number];

/**
 * HOK-3372 write class of each event type. Control events change what the
 * queue will do with a run; evidence events describe what happened to it.
 */
export const QUEUE_LIFECYCLE_EVENT_WRITE_CLASS: Readonly<Record<QueueLifecycleEventType, QueueLifecycleWriteClass>> =
  Object.freeze({
    enqueued: 'control',
    candidate_prepared: 'control',
    check_run_completed: 'evidence',
    ejected: 'control',
    rerun_requested: 'control',
    rebase_performed: 'evidence',
    repair_commit_pushed: 'evidence',
    recovery_decision: 'control',
    merged: 'control',
    dequeued: 'control',
    abandoned: 'control',
    review_round_started: 'control',
    review_round_completed: 'evidence',
  });

export const QUEUE_LIFECYCLE_SCOPES = ['pr', 'candidate'] as const;
export type QueueLifecycleScope = (typeof QUEUE_LIFECYCLE_SCOPES)[number];

/** Which scopes each event type may use. */
export const QUEUE_LIFECYCLE_EVENT_SCOPES: Readonly<Record<QueueLifecycleEventType, readonly QueueLifecycleScope[]>> =
  Object.freeze({
    enqueued: ['pr'],
    candidate_prepared: ['candidate'],
    check_run_completed: ['pr', 'candidate'],
    ejected: ['pr'],
    rerun_requested: ['pr', 'candidate'],
    rebase_performed: ['pr'],
    repair_commit_pushed: ['pr'],
    recovery_decision: ['pr', 'candidate'],
    merged: ['pr'],
    dequeued: ['pr'],
    abandoned: ['pr'],
    review_round_started: ['pr'],
    review_round_completed: ['pr'],
  });

/** PR-scoped events that may name the candidate they happened in. */
export const QUEUE_LIFECYCLE_CANDIDATE_LINKED_TYPES = ['ejected', 'merged'] as const;

// ── Actors ────────────────────────────────────────────────────────────────

export const QUEUE_LIFECYCLE_ACTOR_KINDS = ['agent', 'operator', 'tend', 'monitor', 'github'] as const;
export type QueueLifecycleActorKind = (typeof QUEUE_LIFECYCLE_ACTOR_KINDS)[number];

/**
 * How an executed model was observed. `not_observed` means no executed model
 * is recorded; the intended model is never promoted into its place.
 */
export const QUEUE_EXECUTED_MODEL_EVIDENCE = ['provider_response', 'harness_session', 'not_observed'] as const;
export type QueueExecutedModelEvidence = (typeof QUEUE_EXECUTED_MODEL_EVIDENCE)[number];

/** An agent's model attribution: intent and observation in separate fields. */
export interface QueueModelAttribution {
  harness: string;
  /** What the router or launcher asked for. Never evidence of execution. */
  intended_model?: string;
  executed_model_evidence: QueueExecutedModelEvidence;
  /** Present iff `executed_model_evidence !== 'not_observed'`. */
  executed_model?: string;
}

export interface QueueAgentActor extends QueueModelAttribution {
  kind: 'agent';
}

/** A human. Carries no identity, by design. */
export interface QueueOperatorActor {
  kind: 'operator';
}

/** Wavemill automation: Tend's merge lane, or the monitor (watchdog, reconciler). */
export interface QueueAutomationActor {
  kind: 'tend' | 'monitor';
  /** Slug naming the module, e.g. `ready-watchdog`. */
  component?: string;
}

export interface QueueGithubActor {
  kind: 'github';
  /** Slug, e.g. `merge-queue`, `actions`. */
  app?: string;
}

export type QueueLifecycleActor = QueueAgentActor | QueueOperatorActor | QueueAutomationActor | QueueGithubActor;

// ── Scopes ────────────────────────────────────────────────────────────────

/** An event about one PR of one run. */
export interface QueuePrScope {
  attempt: TaskAttemptRef;
  pr_number: number;
  /** The PR head the event is about (after the change, for code-moving events). */
  head_sha: string;
}

/**
 * An event about a merge candidate. The candidate is not a run: it carries one
 * ref per run it contains, predecessors first, exactly as prepared.
 */
export interface QueueCandidateScope {
  candidate_id: string;
  attempt_refs: TaskAttemptRef[];
}

interface QueueLifecycleEventBase {
  schema_version: typeof QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION;
  /** Minted idempotency key. A replay with the same id is a duplicate. */
  event_id: string;
  event_type: QueueLifecycleEventType;
  /** ISO-8601 UTC. When the fact happened, or was first observed. */
  observed_at: string;
  actor: QueueLifecycleActor;
}

// ── Event payloads ────────────────────────────────────────────────────────

export interface QueueEnqueuedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'enqueued';
  base_sha?: string;
  /** Entries ahead of this one at enqueue time. */
  queue_depth?: number;
}

export interface QueueCandidateEntry {
  pr_number: number;
  head_sha: string;
}

/**
 * The composition of a merge candidate. `entries[i]` is the PR of
 * `attempt_refs[i]`. An entry's code identity is
 * `(base_sha, heads of entries[0..i-1], entries[i].head_sha)`; see
 * `queueCandidateCodeIdentity`.
 */
export interface QueueCandidatePreparedEvent extends QueueLifecycleEventBase, QueueCandidateScope {
  event_type: 'candidate_prepared';
  base_sha: string;
  entries: QueueCandidateEntry[];
  /** The commit the queue will test (e.g. a merge_group head), when known. */
  candidate_sha?: string;
}

export const QUEUE_CHECK_TRIGGERS = ['pull_request', 'merge_group', 'push', 'other'] as const;
export type QueueCheckTrigger = (typeof QUEUE_CHECK_TRIGGERS)[number];

/** GitHub check-run conclusions, verbatim. */
export const QUEUE_CHECK_CONCLUSIONS = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
  'startup_failure',
] as const;
export type QueueCheckConclusion = (typeof QUEUE_CHECK_CONCLUSIONS)[number];

interface QueueCheckRunFields {
  /** Provider check-run id (digits). */
  check_run_id: string;
  /** Normalized check name: lowercase slug, stable across attempts. */
  check_key: string;
  trigger: QueueCheckTrigger;
  /** Provider run attempt, from 1. */
  run_attempt: number;
  conclusion: QueueCheckConclusion;
  started_at?: string;
  completed_at: string;
}

export type QueueCheckRunCompletedEvent = QueueLifecycleEventBase &
  QueueCheckRunFields & { event_type: 'check_run_completed' } & (
    | QueuePrScope
    | (QueueCandidateScope & {
        /** The commit that was checked (the candidate's tested commit). */
        head_sha: string;
      })
  );

export const QUEUE_EJECTION_TRIGGERS = [
  'check_failed',
  'merge_conflict',
  'predecessor_ejected',
  'base_moved',
  'operator',
  'timeout',
  'policy',
  'unknown',
] as const;
export type QueueEjectionTrigger = (typeof QUEUE_EJECTION_TRIGGERS)[number];

export interface QueueEjectedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'ejected';
  /** What the queue reported as the trigger. Not a failure class. */
  trigger: QueueEjectionTrigger;
  /** The candidate the PR was ejected from, if any. */
  candidate_id?: string;
  /** Lifecycle events that caused the ejection (failed check runs, a predecessor's ejection). */
  cause_event_ids?: string[];
}

export type QueueRerunRequestedEvent = QueueLifecycleEventBase & {
  event_type: 'rerun_requested';
  /** The check run being re-run. */
  check_run_id: string;
  check_key: string;
  /** The run attempt being re-run. The rerun's own attempt is a later `check_run_completed`. */
  run_attempt: number;
} & (QueuePrScope | QueueCandidateScope);

export const QUEUE_REBASE_METHODS = ['rebase', 'merge'] as const;
export type QueueRebaseMethod = (typeof QUEUE_REBASE_METHODS)[number];

/** A head move onto a new base. A code-identity fact, not a new attempt. */
export interface QueueRebasePerformedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'rebase_performed';
  previous_head_sha: string;
  previous_base_sha?: string;
  base_sha: string;
  method: QueueRebaseMethod;
  had_conflicts?: boolean;
}

/**
 * A commit pushed to repair a PR. `actor` is the commit's author (agent,
 * operator, ...), so operator edits are never credited to a model.
 */
export interface QueueRepairCommitPushedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'repair_commit_pushed';
  parent_sha: string;
  /** Commits in the push, from 1. */
  commits_pushed?: number;
  cause_event_ids?: string[];
  /** `TaskCostEventV1.event_id`s for the repair work. */
  cost_event_ids?: string[];
}

export const QUEUE_RECOVERY_ACTIONS = ['retry', 'rebase', 'fix', 'split', 'wait_for_predecessor', 'escalate'] as const;
export type QueueRecoveryAction = (typeof QUEUE_RECOVERY_ACTIONS)[number];

/**
 * Where a propensity came from. `exact`: the policy randomized and logged its
 * probabilities. `deterministic`: the policy picks one action with
 * probability 1. `none`: not known (e.g. a human chose).
 */
export const QUEUE_PROPENSITY_SOURCES = ['exact', 'deterministic', 'none'] as const;
export type QueuePropensitySource = (typeof QUEUE_PROPENSITY_SOURCES)[number];

export interface QueuePolicyRef {
  name: string;
  version: string;
}

export interface QueueActionPropensity {
  action: QueueRecoveryAction;
  probability: number;
}

export interface QueueFlakeHistory {
  check_key: string;
  window_runs: number;
  window_failures: number;
}

/**
 * What the policy saw, frozen at decision time. Every field is an input to the
 * decision; nothing observed after `as_of` may appear.
 */
export interface QueueRecoveryContext {
  /** The snapshot's cut-off. `<= observed_at` of the decision. */
  as_of: string;
  /** Lifecycle events the policy read. Each must precede the decision and `as_of`. */
  event_ids: string[];
  failing_check_keys?: string[];
  /** The failure class *the policy was given*, with the labeler that produced it. */
  failure_class?: { label: string; labeler_version: string };
  /** Which landing attempt this is for the run, from 1. */
  attempt_number?: number;
  base_moved_since_candidate?: boolean;
  queue_depth?: number;
  provenance?: { harness?: string; executed_model?: string; task_type?: string };
  flake_history?: QueueFlakeHistory[];
}

export type QueueRecoveryDecisionEvent = QueueLifecycleEventBase & {
  event_type: 'recovery_decision';
  policy: QueuePolicyRef;
  context: QueueRecoveryContext;
  available_actions: QueueRecoveryAction[];
  chosen_action: QueueRecoveryAction;
  propensity_source: QueuePropensitySource;
  /** Exactly the available actions, summing to 1. Required unless `propensity_source === 'none'`. */
  propensities?: QueueActionPropensity[];
} & (QueuePrScope | QueueCandidateScope);

export const QUEUE_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
export type QueueMergeMethod = (typeof QUEUE_MERGE_METHODS)[number];

export interface QueueMergedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'merged';
  merge_commit_sha: string;
  base_sha?: string;
  candidate_id?: string;
  method?: QueueMergeMethod;
}

export const QUEUE_DEQUEUE_TRIGGERS = ['pr_closed', 'head_changed', 'operator', 'policy', 'unknown'] as const;
export type QueueDequeueTrigger = (typeof QUEUE_DEQUEUE_TRIGGERS)[number];

/** Left the queue; the run may enqueue again. */
export interface QueueDequeuedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'dequeued';
  trigger: QueueDequeueTrigger;
}

export const QUEUE_ABANDON_TRIGGERS = ['retry_budget_exhausted', 'superseded', 'operator', 'policy', 'unknown'] as const;
export type QueueAbandonTrigger = (typeof QUEUE_ABANDON_TRIGGERS)[number];

/** The run stops trying to land this PR. */
export interface QueueAbandonedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'abandoned';
  trigger: QueueAbandonTrigger;
}

/** One reviewer configured for a round. */
export interface QueueReviewerConfig {
  /** Slug naming the reviewer (lens, layer or check), stable across rounds. */
  reviewer_key: string;
  stage: string;
  stage_attempt_id?: string;
  harness?: string;
  intended_model?: string;
  /** True when this reviewer is a challenge arm. */
  challenge?: boolean;
}

/** How a round's reviewer configuration was selected. */
export interface QueueReviewSelection {
  policy: QueuePolicyRef;
  propensity_source: QueuePropensitySource;
  /** Probability of this configuration. Required unless `propensity_source === 'none'`. */
  propensity?: number;
}

export interface QueueReviewRoundStartedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'review_round_started';
  round: number;
  reviewers: QueueReviewerConfig[];
  selection?: QueueReviewSelection;
}

/** One reviewer that ran, with its observed model. */
export interface QueueReviewerRun extends QueueModelAttribution {
  reviewer_key: string;
  stage: string;
  stage_attempt_id?: string;
}

/**
 * Where a finding points, relative to the code the first round reviewed.
 * `first_round`: the finding is from round 1. `changed_since_first_round`:
 * lines changed after round 1. `unchanged_since_first_round`: code round 1
 * already saw (a re-flag of pre-existing code).
 */
export const QUEUE_FINDING_LOCATIONS = [
  'first_round',
  'changed_since_first_round',
  'unchanged_since_first_round',
  'unknown',
] as const;
export type QueueFindingLocation = (typeof QUEUE_FINDING_LOCATIONS)[number];

export interface QueueReviewFinding {
  /** Minted per finding. */
  finding_id: string;
  reviewer_key: string;
  blocking: boolean;
  location: QueueFindingLocation;
  /** An earlier finding this one raises again. */
  reflag_of?: string;
}

export interface QueueReviewRoundCompletedEvent extends QueueLifecycleEventBase, QueuePrScope {
  event_type: 'review_round_completed';
  round: number;
  /** The head round 1 reviewed: the baseline for `location`. Equals `head_sha` in round 1. */
  first_round_head_sha: string;
  reviewers: QueueReviewerRun[];
  /** Every finding. `[]` is an observed clean round. Counts are derived from it. */
  findings: QueueReviewFinding[];
}

export type QueueLifecycleEventV1 =
  | QueueEnqueuedEvent
  | QueueCandidatePreparedEvent
  | QueueCheckRunCompletedEvent
  | QueueEjectedEvent
  | QueueRerunRequestedEvent
  | QueueRebasePerformedEvent
  | QueueRepairCommitPushedEvent
  | QueueRecoveryDecisionEvent
  | QueueMergedEvent
  | QueueDequeuedEvent
  | QueueAbandonedEvent
  | QueueReviewRoundStartedEvent
  | QueueReviewRoundCompletedEvent;

// ── Helpers ───────────────────────────────────────────────────────────────

export function queueLifecycleEventScope(event: QueueLifecycleEventV1): QueueLifecycleScope {
  return 'attempt_refs' in event ? 'candidate' : 'pr';
}

/** Every attempt an event names: its `attempt`, or its `attempt_refs`. */
export function queueLifecycleEventAttemptRefs(event: QueueLifecycleEventV1): TaskAttemptRef[] {
  return 'attempt_refs' in event ? event.attempt_refs : [event.attempt];
}

/**
 * The code identity of entry `index` in a candidate: the base, the ordered
 * heads of its predecessors, and its own head. Fully determined by the stored
 * composition, so it is derived rather than stored.
 */
export function queueCandidateCodeIdentity(
  candidate: QueueCandidatePreparedEvent,
  index: number,
): { base_sha: string; predecessor_shas: string[]; head_sha: string } {
  const entry = candidate.entries[index];
  if (entry === undefined) throw new RangeError(`candidate has no entry ${index}`);
  return {
    base_sha: candidate.base_sha,
    predecessor_shas: candidate.entries.slice(0, index).map((predecessor) => predecessor.head_sha),
    head_sha: entry.head_sha,
  };
}
