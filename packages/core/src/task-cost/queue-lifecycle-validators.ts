/**
 * Runtime validators for `queue_lifecycle_event/v1` (HOK-3338). Normative for
 * single-record shape; the JSON schema
 * (`packages/core/schemas/queue-lifecycle-event.v1.schema.json`) mirrors them
 * for non-JS consumers. Cross-record rules (attempt currency, candidate
 * membership, idempotency, decision-context leakage) belong to the reducer,
 * `reduceQueueLifecycleLog`.
 *
 * @module task-cost/queue-lifecycle-validators
 */

import { validateTaskAttemptRef } from './attempt-validators.js';
import {
  QUEUE_ABANDON_TRIGGERS,
  QUEUE_CHECK_CONCLUSIONS,
  QUEUE_CHECK_TRIGGERS,
  QUEUE_DEQUEUE_TRIGGERS,
  QUEUE_EJECTION_TRIGGERS,
  QUEUE_EXECUTED_MODEL_EVIDENCE,
  QUEUE_FINDING_LOCATIONS,
  QUEUE_LIFECYCLE_ACTOR_KINDS,
  QUEUE_LIFECYCLE_CANDIDATE_LINKED_TYPES,
  QUEUE_LIFECYCLE_EVENT_SCOPES,
  QUEUE_LIFECYCLE_EVENT_TYPES,
  QUEUE_MERGE_METHODS,
  QUEUE_PROPENSITY_SOURCES,
  QUEUE_REBASE_METHODS,
  QUEUE_RECOVERY_ACTIONS,
  type QueueLifecycleEventV1,
  type QueueLifecycleScope,
} from './queue-lifecycle.js';
import { QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION } from './schema-version.js';
import {
  TaskCostValidationError,
  assertNoForbiddenKeys,
  checkSchemaVersion,
  fail,
  requireBoolean,
  requireEnum,
  requireId,
  requireMintedId,
  requireModel,
  requireObject,
  requirePattern,
  requireTimestamp,
} from './validators.js';

export const QUEUE_SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
/** Normalized check names keep `.`, `:` and `/`-free separators. */
export const QUEUE_CHECK_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const HARNESS_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PROVIDER_ID_PATTERN = /^[0-9]{1,20}$/;
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
/** Probabilities must sum to 1 within this tolerance. */
export const QUEUE_PROPENSITY_TOLERANCE = 1e-9;

function forbidKey(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined) fail(`${label}.${key} is not allowed here`);
}

function rejectNulls(record: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === null) fail(`${label}.${key} must be omitted when not reported, not null`);
  }
}

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) fail(`${label} must be a positive integer`);
  return value;
}

function requireNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireSha(value: unknown, label: string): string {
  return requirePattern(value, GIT_SHA_PATTERN, label);
}

function requireArray(value: unknown, label: string, { nonEmpty = false } = {}): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (nonEmpty && value.length === 0) fail(`${label} must not be empty`);
  return value;
}

function requireMintedIdList(value: unknown, label: string): string[] {
  const ids = requireArray(value, label).map((id, index) => requireMintedId(id, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) fail(`${label} must not repeat an id`);
  return ids;
}

function requireIdList(value: unknown, label: string): string[] {
  return requireArray(value, label).map((id, index) => requireId(id, `${label}[${index}]`));
}

function validatePolicy(value: unknown, label: string): void {
  const policy = requireObject(value, label);
  requirePattern(policy.name, QUEUE_SLUG_PATTERN, `${label}.name`);
  requirePattern(policy.version, POLICY_VERSION_PATTERN, `${label}.version`);
}

/** Intended and observed models are separate; an observed model needs evidence. */
function validateModelAttribution(record: Record<string, unknown>, label: string): void {
  requirePattern(record.harness, HARNESS_SLUG_PATTERN, `${label}.harness`);
  if (record.intended_model !== undefined) requireModel(record.intended_model, `${label}.intended_model`);
  const evidence = requireEnum(
    record.executed_model_evidence,
    QUEUE_EXECUTED_MODEL_EVIDENCE,
    `${label}.executed_model_evidence`,
  );
  if (evidence === 'not_observed') {
    if (record.executed_model !== undefined) {
      fail(`${label}.executed_model requires observation evidence (executed_model_evidence is not_observed)`);
    }
  } else {
    requireModel(record.executed_model, `${label}.executed_model`);
  }
}

function validateActor(value: unknown): void {
  const actor = requireObject(value, 'actor');
  rejectNulls(actor, 'actor');
  const kind = requireEnum(actor.kind, QUEUE_LIFECYCLE_ACTOR_KINDS, 'actor.kind');
  const modelKeys = ['harness', 'intended_model', 'executed_model', 'executed_model_evidence'];
  if (kind === 'agent') {
    validateModelAttribution(actor, 'actor');
  } else {
    for (const key of modelKeys) forbidKey(actor, key, 'actor');
  }
  if (kind === 'tend' || kind === 'monitor') {
    if (actor.component !== undefined) requirePattern(actor.component, QUEUE_SLUG_PATTERN, 'actor.component');
  } else {
    forbidKey(actor, 'component', 'actor');
  }
  if (kind === 'github') {
    if (actor.app !== undefined) requirePattern(actor.app, QUEUE_SLUG_PATTERN, 'actor.app');
  } else {
    forbidKey(actor, 'app', 'actor');
  }
}

function validateScope(record: Record<string, unknown>, eventType: (typeof QUEUE_LIFECYCLE_EVENT_TYPES)[number]): QueueLifecycleScope {
  const hasPr = record.attempt !== undefined;
  const hasCandidate = record.attempt_refs !== undefined;
  if (hasPr === hasCandidate) {
    fail(`${eventType} must name exactly one scope: attempt (PR) or attempt_refs (candidate)`);
  }
  const scope: QueueLifecycleScope = hasPr ? 'pr' : 'candidate';
  if (!QUEUE_LIFECYCLE_EVENT_SCOPES[eventType].includes(scope)) {
    fail(`${eventType} does not allow the ${scope} scope`);
  }
  if (scope === 'pr') {
    validateTaskAttemptRef(record.attempt, 'attempt');
    requirePositiveInt(record.pr_number, 'pr_number');
    requireSha(record.head_sha, 'head_sha');
    if (record.candidate_id !== undefined) {
      if (!(QUEUE_LIFECYCLE_CANDIDATE_LINKED_TYPES as readonly string[]).includes(eventType)) {
        fail(`candidate_id is only allowed on PR-scoped ${QUEUE_LIFECYCLE_CANDIDATE_LINKED_TYPES.join(', ')} events`);
      }
      requireMintedId(record.candidate_id, 'candidate_id');
    }
  } else {
    requireMintedId(record.candidate_id, 'candidate_id');
    forbidKey(record, 'pr_number', eventType);
    const refs = requireArray(record.attempt_refs, 'attempt_refs', { nonEmpty: true });
    const runIds = new Set<string>();
    for (const [index, ref] of refs.entries()) {
      validateTaskAttemptRef(ref, `attempt_refs[${index}]`);
      const runId = (ref as { run_id: string }).run_id;
      if (runIds.has(runId)) fail('attempt_refs must name each run once');
      runIds.add(runId);
    }
  }
  return scope;
}

function validateCheckRunFields(record: Record<string, unknown>, label: string): void {
  requirePattern(record.check_run_id, PROVIDER_ID_PATTERN, `${label}.check_run_id`);
  requirePattern(record.check_key, QUEUE_CHECK_KEY_PATTERN, `${label}.check_key`);
  requirePositiveInt(record.run_attempt, `${label}.run_attempt`);
}

function validatePropensities(
  record: Record<string, unknown>,
  available: readonly string[],
  chosen: string,
  source: string,
): void {
  if (source === 'none') {
    forbidKey(record, 'propensities', 'recovery_decision');
    return;
  }
  const entries = requireArray(record.propensities, 'recovery_decision.propensities', { nonEmpty: true });
  const seen = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const label = `recovery_decision.propensities[${index}]`;
    const item = requireObject(entry, label);
    const action = requireEnum(item.action, QUEUE_RECOVERY_ACTIONS, `${label}.action`);
    const probability = item.probability;
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      fail(`${label}.probability must be a number in [0, 1]`);
    }
    if (seen.has(action)) fail(`${label}.action repeats ${action}`);
    seen.set(action, probability);
  }
  if (seen.size !== available.length || available.some((action) => !seen.has(action))) {
    fail('recovery_decision.propensities must cover exactly the available actions');
  }
  const total = [...seen.values()].reduce((sum, p) => sum + p, 0);
  if (Math.abs(total - 1) > QUEUE_PROPENSITY_TOLERANCE) fail('recovery_decision.propensities must sum to 1');
  const chosenProbability = seen.get(chosen) ?? 0;
  if (chosenProbability <= 0) fail('recovery_decision.chosen_action must have a positive propensity');
  if (source === 'deterministic' && chosenProbability !== 1) {
    fail('a deterministic recovery_decision gives the chosen action probability 1');
  }
}

function validateRecoveryContext(value: unknown, observedAt: string): void {
  const context = requireObject(value, 'recovery_decision.context');
  rejectNulls(context, 'recovery_decision.context');
  const asOf = requireTimestamp(context.as_of, 'recovery_decision.context.as_of');
  if (Date.parse(asOf) > Date.parse(observedAt)) {
    fail('recovery_decision.context.as_of must not be after the decision (no post-decision context)');
  }
  requireMintedIdList(context.event_ids, 'recovery_decision.context.event_ids');
  if (context.failing_check_keys !== undefined) {
    requireArray(context.failing_check_keys, 'recovery_decision.context.failing_check_keys').forEach((key, index) =>
      requirePattern(key, QUEUE_CHECK_KEY_PATTERN, `recovery_decision.context.failing_check_keys[${index}]`),
    );
  }
  if (context.failure_class !== undefined) {
    const failureClass = requireObject(context.failure_class, 'recovery_decision.context.failure_class');
    requirePattern(failureClass.label, QUEUE_SLUG_PATTERN, 'recovery_decision.context.failure_class.label');
    requirePattern(
      failureClass.labeler_version,
      POLICY_VERSION_PATTERN,
      'recovery_decision.context.failure_class.labeler_version',
    );
  }
  if (context.attempt_number !== undefined) {
    requirePositiveInt(context.attempt_number, 'recovery_decision.context.attempt_number');
  }
  if (context.base_moved_since_candidate !== undefined) {
    requireBoolean(context.base_moved_since_candidate, 'recovery_decision.context.base_moved_since_candidate');
  }
  if (context.queue_depth !== undefined) {
    requireNonNegativeInt(context.queue_depth, 'recovery_decision.context.queue_depth');
  }
  if (context.provenance !== undefined) {
    const provenance = requireObject(context.provenance, 'recovery_decision.context.provenance');
    if (provenance.harness !== undefined) {
      requirePattern(provenance.harness, HARNESS_SLUG_PATTERN, 'recovery_decision.context.provenance.harness');
    }
    if (provenance.executed_model !== undefined) {
      requireModel(provenance.executed_model, 'recovery_decision.context.provenance.executed_model');
    }
    if (provenance.task_type !== undefined) {
      requirePattern(provenance.task_type, QUEUE_SLUG_PATTERN, 'recovery_decision.context.provenance.task_type');
    }
  }
  if (context.flake_history !== undefined) {
    for (const [index, entry] of requireArray(context.flake_history, 'recovery_decision.context.flake_history').entries()) {
      const label = `recovery_decision.context.flake_history[${index}]`;
      const flake = requireObject(entry, label);
      requirePattern(flake.check_key, QUEUE_CHECK_KEY_PATTERN, `${label}.check_key`);
      const runs = requireNonNegativeInt(flake.window_runs, `${label}.window_runs`);
      const failures = requireNonNegativeInt(flake.window_failures, `${label}.window_failures`);
      if (failures > runs) fail(`${label}.window_failures must not exceed window_runs`);
    }
  }
}

function validateRecoveryDecision(record: Record<string, unknown>, observedAt: string): void {
  validatePolicy(record.policy, 'recovery_decision.policy');
  validateRecoveryContext(record.context, observedAt);
  const available = requireArray(record.available_actions, 'recovery_decision.available_actions', {
    nonEmpty: true,
  }).map((action, index) => requireEnum(action, QUEUE_RECOVERY_ACTIONS, `recovery_decision.available_actions[${index}]`));
  if (new Set(available).size !== available.length) fail('recovery_decision.available_actions must not repeat');
  const chosen = requireEnum(record.chosen_action, QUEUE_RECOVERY_ACTIONS, 'recovery_decision.chosen_action');
  if (!available.includes(chosen)) fail('recovery_decision.chosen_action must be one of available_actions');
  const source = requireEnum(record.propensity_source, QUEUE_PROPENSITY_SOURCES, 'recovery_decision.propensity_source');
  validatePropensities(record, available, chosen, source);
}

function validateReviewRoundStarted(record: Record<string, unknown>): void {
  requirePositiveInt(record.round, 'review_round_started.round');
  const reviewers = requireArray(record.reviewers, 'review_round_started.reviewers', { nonEmpty: true });
  const keys = new Set<string>();
  for (const [index, entry] of reviewers.entries()) {
    const label = `review_round_started.reviewers[${index}]`;
    const reviewer = requireObject(entry, label);
    rejectNulls(reviewer, label);
    const key = requirePattern(reviewer.reviewer_key, QUEUE_SLUG_PATTERN, `${label}.reviewer_key`);
    if (keys.has(key)) fail(`${label}.reviewer_key repeats ${key}`);
    keys.add(key);
    requirePattern(reviewer.stage, QUEUE_SLUG_PATTERN, `${label}.stage`);
    if (reviewer.stage_attempt_id !== undefined) requireMintedId(reviewer.stage_attempt_id, `${label}.stage_attempt_id`);
    if (reviewer.harness !== undefined) requirePattern(reviewer.harness, HARNESS_SLUG_PATTERN, `${label}.harness`);
    if (reviewer.intended_model !== undefined) requireModel(reviewer.intended_model, `${label}.intended_model`);
    // A configuration is intent: it cannot claim what executed.
    forbidKey(reviewer, 'executed_model', label);
    forbidKey(reviewer, 'executed_model_evidence', label);
    if (reviewer.challenge !== undefined) requireBoolean(reviewer.challenge, `${label}.challenge`);
  }
  if (record.selection !== undefined) {
    const selection = requireObject(record.selection, 'review_round_started.selection');
    validatePolicy(selection.policy, 'review_round_started.selection.policy');
    const source = requireEnum(
      selection.propensity_source,
      QUEUE_PROPENSITY_SOURCES,
      'review_round_started.selection.propensity_source',
    );
    if (source === 'none') {
      forbidKey(selection, 'propensity', 'review_round_started.selection');
    } else {
      const p = selection.propensity;
      if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 1) {
        fail('review_round_started.selection.propensity must be a number in (0, 1]');
      }
      if (source === 'deterministic' && p !== 1) {
        fail('a deterministic review selection has propensity 1');
      }
    }
  }
}

function validateReviewRoundCompleted(record: Record<string, unknown>): void {
  const round = requirePositiveInt(record.round, 'review_round_completed.round');
  const firstRoundHead = requireSha(record.first_round_head_sha, 'review_round_completed.first_round_head_sha');
  if (round === 1 && firstRoundHead !== record.head_sha) {
    fail('review_round_completed.first_round_head_sha must equal head_sha in round 1');
  }
  const reviewers = requireArray(record.reviewers, 'review_round_completed.reviewers', { nonEmpty: true });
  const keys = new Set<string>();
  for (const [index, entry] of reviewers.entries()) {
    const label = `review_round_completed.reviewers[${index}]`;
    const reviewer = requireObject(entry, label);
    rejectNulls(reviewer, label);
    const key = requirePattern(reviewer.reviewer_key, QUEUE_SLUG_PATTERN, `${label}.reviewer_key`);
    if (keys.has(key)) fail(`${label}.reviewer_key repeats ${key}`);
    keys.add(key);
    requirePattern(reviewer.stage, QUEUE_SLUG_PATTERN, `${label}.stage`);
    if (reviewer.stage_attempt_id !== undefined) requireMintedId(reviewer.stage_attempt_id, `${label}.stage_attempt_id`);
    validateModelAttribution(reviewer, label);
  }
  const findings = requireArray(record.findings, 'review_round_completed.findings');
  const findingIds = new Set<string>();
  for (const [index, entry] of findings.entries()) {
    const label = `review_round_completed.findings[${index}]`;
    const finding = requireObject(entry, label);
    rejectNulls(finding, label);
    const id = requireMintedId(finding.finding_id, `${label}.finding_id`);
    if (findingIds.has(id)) fail(`${label}.finding_id repeats`);
    findingIds.add(id);
    const reviewerKey = requirePattern(finding.reviewer_key, QUEUE_SLUG_PATTERN, `${label}.reviewer_key`);
    if (!keys.has(reviewerKey)) fail(`${label}.reviewer_key must name a reviewer that ran this round`);
    requireBoolean(finding.blocking, `${label}.blocking`);
    const location = requireEnum(finding.location, QUEUE_FINDING_LOCATIONS, `${label}.location`);
    if (round === 1 && location !== 'first_round' && location !== 'unknown') {
      fail(`${label}.location must be first_round in round 1`);
    }
    if (round > 1 && location === 'first_round') fail(`${label}.location first_round is only legal in round 1`);
    if (finding.reflag_of !== undefined) {
      if (round === 1) fail(`${label}.reflag_of is not legal in round 1`);
      const reflagOf = requireMintedId(finding.reflag_of, `${label}.reflag_of`);
      if (reflagOf === id) fail(`${label}.reflag_of must not reference the finding itself`);
    }
  }
}

function validatePayload(record: Record<string, unknown>, observedAt: string): void {
  const eventType = record.event_type as QueueLifecycleEventV1['event_type'];
  switch (eventType) {
    case 'enqueued':
      if (record.base_sha !== undefined) requireSha(record.base_sha, 'enqueued.base_sha');
      if (record.queue_depth !== undefined) requireNonNegativeInt(record.queue_depth, 'enqueued.queue_depth');
      break;
    case 'candidate_prepared': {
      requireSha(record.base_sha, 'candidate_prepared.base_sha');
      const entries = requireArray(record.entries, 'candidate_prepared.entries', { nonEmpty: true });
      const refs = record.attempt_refs as unknown[];
      if (entries.length !== refs.length) {
        fail('candidate_prepared.entries must align with attempt_refs (entries[i] is the PR of attempt_refs[i])');
      }
      const prs = new Set<number>();
      for (const [index, entry] of entries.entries()) {
        const label = `candidate_prepared.entries[${index}]`;
        const item = requireObject(entry, label);
        const pr = requirePositiveInt(item.pr_number, `${label}.pr_number`);
        if (prs.has(pr)) fail(`${label}.pr_number repeats`);
        prs.add(pr);
        requireSha(item.head_sha, `${label}.head_sha`);
      }
      if (record.candidate_sha !== undefined) requireSha(record.candidate_sha, 'candidate_prepared.candidate_sha');
      break;
    }
    case 'check_run_completed': {
      validateCheckRunFields(record, 'check_run_completed');
      requireSha(record.head_sha, 'check_run_completed.head_sha');
      requireEnum(record.trigger, QUEUE_CHECK_TRIGGERS, 'check_run_completed.trigger');
      requireEnum(record.conclusion, QUEUE_CHECK_CONCLUSIONS, 'check_run_completed.conclusion');
      const completed = requireTimestamp(record.completed_at, 'check_run_completed.completed_at');
      if (record.started_at !== undefined) {
        const started = requireTimestamp(record.started_at, 'check_run_completed.started_at');
        if (Date.parse(started) > Date.parse(completed)) {
          fail('check_run_completed.started_at must not be after completed_at');
        }
      }
      if (Date.parse(completed) > Date.parse(observedAt)) {
        fail('check_run_completed.completed_at must not be after observed_at');
      }
      break;
    }
    case 'ejected':
      requireEnum(record.trigger, QUEUE_EJECTION_TRIGGERS, 'ejected.trigger');
      if (record.cause_event_ids !== undefined) requireMintedIdList(record.cause_event_ids, 'ejected.cause_event_ids');
      break;
    case 'rerun_requested':
      validateCheckRunFields(record, 'rerun_requested');
      break;
    case 'rebase_performed':
      requireSha(record.previous_head_sha, 'rebase_performed.previous_head_sha');
      if (record.previous_head_sha === record.head_sha) {
        fail('rebase_performed.head_sha must differ from previous_head_sha');
      }
      if (record.previous_base_sha !== undefined) requireSha(record.previous_base_sha, 'rebase_performed.previous_base_sha');
      requireSha(record.base_sha, 'rebase_performed.base_sha');
      requireEnum(record.method, QUEUE_REBASE_METHODS, 'rebase_performed.method');
      if (record.had_conflicts !== undefined) requireBoolean(record.had_conflicts, 'rebase_performed.had_conflicts');
      break;
    case 'repair_commit_pushed':
      requireSha(record.parent_sha, 'repair_commit_pushed.parent_sha');
      if (record.parent_sha === record.head_sha) fail('repair_commit_pushed.head_sha must differ from parent_sha');
      if (record.commits_pushed !== undefined) requirePositiveInt(record.commits_pushed, 'repair_commit_pushed.commits_pushed');
      if (record.cause_event_ids !== undefined) {
        requireMintedIdList(record.cause_event_ids, 'repair_commit_pushed.cause_event_ids');
      }
      if (record.cost_event_ids !== undefined) requireIdList(record.cost_event_ids, 'repair_commit_pushed.cost_event_ids');
      break;
    case 'recovery_decision':
      validateRecoveryDecision(record, observedAt);
      break;
    case 'merged':
      requireSha(record.merge_commit_sha, 'merged.merge_commit_sha');
      if (record.base_sha !== undefined) requireSha(record.base_sha, 'merged.base_sha');
      if (record.method !== undefined) requireEnum(record.method, QUEUE_MERGE_METHODS, 'merged.method');
      break;
    case 'dequeued':
      requireEnum(record.trigger, QUEUE_DEQUEUE_TRIGGERS, 'dequeued.trigger');
      break;
    case 'abandoned':
      requireEnum(record.trigger, QUEUE_ABANDON_TRIGGERS, 'abandoned.trigger');
      break;
    case 'review_round_started':
      validateReviewRoundStarted(record);
      break;
    case 'review_round_completed':
      validateReviewRoundCompleted(record);
      break;
  }
}

/** Validates one `queue_lifecycle_event/v1` event. */
export function validateQueueLifecycleEventV1(value: unknown): asserts value is QueueLifecycleEventV1 {
  const record = requireObject(value, 'queue_lifecycle_event');
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION, 'queue_lifecycle_event');
  rejectNulls(record, 'queue_lifecycle_event');
  requireMintedId(record.event_id, 'event_id');
  const eventType = requireEnum(record.event_type, QUEUE_LIFECYCLE_EVENT_TYPES, 'event_type');
  const observedAt = requireTimestamp(record.observed_at, `${eventType}.observed_at`);
  validateActor(record.actor);
  validateScope(record, eventType);
  validatePayload(record, observedAt);
}

export function isQueueLifecycleEventV1(value: unknown): value is QueueLifecycleEventV1 {
  try {
    validateQueueLifecycleEventV1(value);
    return true;
  } catch (error) {
    if (error instanceof TaskCostValidationError) return false;
    throw error;
  }
}
