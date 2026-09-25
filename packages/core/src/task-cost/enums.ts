/**
 * Closed enums for the task-cost contract. Each is exported both as a
 * readonly value tuple (for validators and exhaustive tests) and as a union
 * type derived from it, so the two can never drift.
 *
 * @module task-cost/enums
 */

/**
 * Availability of a single field or field class. A literal zero is only ever
 * `known_zero` (observed and confirmed); a missing value is `unavailable`
 * (with the value itself `null`). Matches Wavemill's `FieldAvailability`.
 */
export const TASK_COST_FIELD_AVAILABILITIES = [
  'available',
  'partial',
  'unavailable',
  'known_zero',
] as const;
export type TaskCostFieldAvailability = (typeof TASK_COST_FIELD_AVAILABILITIES)[number];

/**
 * Record-level cost coverage. Matches Wavemill's
 * `WorkflowCostAttributionCoverage`.
 */
export const TASK_COST_COVERAGES = [
  'complete',
  'partial',
  'unavailable',
  'known_zero',
] as const;
export type TaskCostCoverage = (typeof TASK_COST_COVERAGES)[number];

/**
 * Where a cost figure came from. `provider_reported` is an actual charge;
 * `local_estimate` is a token-equivalent estimate priced locally. `mixed` only
 * exists on summaries (a task composed of both kinds of events); events are
 * always one of the other three.
 */
export const TASK_COST_SOURCES = [
  'provider_reported',
  'local_estimate',
  'mixed',
  'none',
] as const;
export type TaskCostSource = (typeof TASK_COST_SOURCES)[number];

/** The subset of {@link TaskCostSource} legal on a single event. */
export const TASK_COST_EVENT_SOURCES = ['provider_reported', 'local_estimate', 'none'] as const;
export type TaskCostEventSource = (typeof TASK_COST_EVENT_SOURCES)[number];

/**
 * How the underlying usage is paid for. `subscription` means no per-call
 * charge exists, so any dollar figure is a token-equivalent estimate and never
 * an actual charge.
 */
export const TASK_COST_BASES = ['per_token_api', 'subscription', 'unknown'] as const;
export type TaskCostBasis = (typeof TASK_COST_BASES)[number];

/** Confidence tier for attributing a session to a task. Matches Wavemill. */
export const TASK_COST_JOIN_CONFIDENCES = [
  'branch_worktree',
  'timestamp_window',
  'unattributed',
] as const;
export type TaskCostJoinConfidence = (typeof TASK_COST_JOIN_CONFIDENCES)[number];

export const TASK_COST_HARNESSES = [
  'claude-code',
  'codex',
  'native',
  'pi',
  'wavemill',
  'unknown',
] as const;
export type TaskCostHarness = (typeof TASK_COST_HARNESSES)[number];

/**
 * Whether an event's usage is an increment since the previous observation
 * (`delta`) or a running total for the `(task_id, session_id)` scope
 * (`cumulative`).
 */
export const TASK_COST_USAGE_KINDS = ['delta', 'cumulative'] as const;
export type TaskCostUsageKind = (typeof TASK_COST_USAGE_KINDS)[number];

/**
 * Origin of the price table behind `estimated_cost_usd`. `none` means no
 * estimate was produced. `mixed` only exists on summaries. Actual charges are
 * carried by {@link TaskCostSource}, not here.
 */
export const TASK_COST_PRICING_SOURCES = [
  'local_estimate',
  'openrouter_api',
  'mixed',
  'none',
] as const;
export type TaskCostPricingSource = (typeof TASK_COST_PRICING_SOURCES)[number];

/** Which price table produced an estimate. */
export const TASK_COST_PRICE_TABLES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'override',
  'external',
] as const;
export type TaskCostPriceTable = (typeof TASK_COST_PRICE_TABLES)[number];

/**
 * Diagnostic codes. Codes marked "reducer" are derived by
 * `aggregateTaskCost`; the rest are emitted by adapters on events and are
 * passed through to the summary. The first seven mirror Wavemill's
 * `WorkflowCostAttributionReason`.
 */
export const TASK_COST_DIAGNOSTIC_CODES = [
  /** reducer: an event lacks input/output token counts. */
  'missing_token_usage',
  /** adapter: source usage was unparseable, negative, or non-finite. */
  'invalid_token_usage',
  /** reducer: usage was complete enough to price but no price was applied. */
  'unpriced_model',
  /** reducer: summary coverage is `partial`. */
  'mixed_coverage',
  /** reducer: at least one event was resolved from a provider-reported charge. */
  'provider_reported_cost',
  /** adapter: no price table was available at all. */
  'no_pricing_data',
  /** reducer: events exist but none produced a cost. */
  'no_priced_sessions',
  /** reducer: events were priced against more than one pricing revision. */
  'stale_pricing_revision',
  /** reducer: an event repeating a prior `event_id` was ignored. */
  'replay_dropped',
  /** reducer: a cumulative snapshot regressed and its delta was clamped. */
  'cumulative_backward_jump',
  /** reducer: subscription-basis events carry no actual charge. */
  'subscription_basis_no_charge',
] as const;
export type TaskCostDiagnosticCode = (typeof TASK_COST_DIAGNOSTIC_CODES)[number];

/** What the reducer decided for one input event. */
export const TASK_COST_REPLAY_DECISIONS = [
  'accept_first',
  'drop_duplicate',
  'supersede_prior',
] as const;
export type TaskCostReplayDecision = (typeof TASK_COST_REPLAY_DECISIONS)[number];
