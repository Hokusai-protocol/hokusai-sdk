/**
 * Reference reducer: turns a task's events into a `TaskCostSummaryV1`.
 *
 * This is the executable definition of the contract's semantics (replay,
 * cumulative reconciliation, missing-vs-zero, source/coverage promotion) and
 * the oracle the fixtures are checked against. It is pure: no clock, no I/O,
 * no pricing. Prices come from the events; the reducer only sums and promotes.
 *
 * Pipeline: validate -> select one task -> {@link resolveReplays} ->
 * {@link reconcileCumulative} -> aggregate.
 *
 * @module task-cost/aggregate
 */

import {
  TASK_COST_DIAGNOSTIC_CODES,
  type TaskCostBasis,
  type TaskCostCoverage,
  type TaskCostDiagnosticCode,
  type TaskCostEventSource,
  type TaskCostFieldAvailability,
  type TaskCostJoinConfidence,
  type TaskCostPricingSource,
  type TaskCostReplayDecision,
  type TaskCostSource,
} from './enums.js';
import type { TaskCostEventV1 } from './event.js';
import { TASK_COST_SUMMARY_SCHEMA_VERSION } from './schema-version.js';
import type { TaskCostModelSegment, TaskCostSummaryV1 } from './summary.js';
import {
  TASK_COST_TOKEN_FIELDS,
  addNullable,
  deriveUsageAvailability,
  emptyTokenUsage,
  promoteAvailability,
  type TaskCostTokenUsage,
} from './token-usage.js';
import { TaskCostValidationError, validateTaskCostEventV1 } from './validators.js';

export interface AggregateTaskCostOptions {
  /** Required when `events` span more than one task. */
  taskId?: string;
  /** Defaults to the latest `observed_at` of the task's events (keeps the reducer pure). */
  collectedAt?: string;
  /** Defaults to `unattributed`; the reducer cannot know how the join was made. */
  joinConfidence?: TaskCostJoinConfidence;
  rootSessionId?: string;
  /** Set by callers that bounded the history they passed in. */
  turnsTruncated?: boolean;
}

/** USD arithmetic is rounded to nanodollars to strip floating-point noise. */
function roundUsd(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function addUsd(a: number | null, b: number | null): number | null {
  const sum = addNullable(a, b);
  return sum === null ? null : roundUsd(sum);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical cross-session order: time, then session, then sequence, then id. */
function compareEvents(a: TaskCostEventV1, b: TaskCostEventV1): number {
  return (
    Date.parse(a.observed_at) - Date.parse(b.observed_at) ||
    compareStrings(a.session_id, b.session_id) ||
    a.sequence - b.sequence ||
    compareStrings(a.event_id, b.event_id)
  );
}

export interface ReplayResolution {
  /** Events that count, in input order. */
  contributing: TaskCostEventV1[];
  /** One decision per *input* event position. */
  decisions: TaskCostReplayDecision[];
  /** Events discarded as duplicates of an earlier `event_id`. */
  droppedDuplicates: number;
}

/**
 * Replay semantics:
 *
 * - The first event with a given `event_id` wins; later ones are
 *   `drop_duplicate`.
 * - An event with `replay_of_event_id` supersedes that event (if present): the
 *   superseded event is excluded, and the superseder is `supersede_prior`.
 *   Chains resolve naturally (only the last link counts). A reference to an
 *   event that is not present is harmless.
 * - Reference cycles are a contract violation and throw `replay_cycle`.
 */
export function resolveReplays(events: readonly TaskCostEventV1[]): ReplayResolution {
  const firstById = new Map<string, TaskCostEventV1>();
  const decisions: TaskCostReplayDecision[] = [];
  let droppedDuplicates = 0;

  for (const event of events) {
    if (firstById.has(event.event_id)) {
      decisions.push('drop_duplicate');
      droppedDuplicates += 1;
    } else {
      firstById.set(event.event_id, event);
      decisions.push(
        event.replay_of_event_id !== undefined ? 'supersede_prior' : 'accept_first',
      );
    }
  }

  for (const start of firstById.values()) {
    const seen = new Set<string>([start.event_id]);
    let next = start.replay_of_event_id;
    while (next !== undefined) {
      if (seen.has(next)) {
        throw new TaskCostValidationError(
          'replay_cycle',
          `replay_of_event_id cycle involving "${next}"`,
        );
      }
      seen.add(next);
      next = firstById.get(next)?.replay_of_event_id;
    }
  }

  const superseded = new Set<string>();
  for (const event of firstById.values()) {
    if (event.replay_of_event_id !== undefined && firstById.has(event.replay_of_event_id)) {
      superseded.add(event.replay_of_event_id);
    }
  }

  // A supersede that targeted nothing present is just a first observation.
  const resolvedDecisions = decisions.map((decision, index) => {
    const target = events[index]?.replay_of_event_id;
    return decision === 'supersede_prior' && (target === undefined || !firstById.has(target))
      ? 'accept_first'
      : decision;
  });

  return {
    contributing: [...firstById.values()].filter((event) => !superseded.has(event.event_id)),
    decisions: resolvedDecisions,
    droppedDuplicates,
  };
}

/** One event's incremental contribution after cumulative snapshots are differenced. */
export interface EffectiveObservation {
  event: TaskCostEventV1;
  usage: TaskCostTokenUsage;
  actual: number | null;
  estimated: number | null;
}

export interface CumulativeReconciliation {
  /** Canonical order. */
  observations: EffectiveObservation[];
  backwardJump: boolean;
}

interface CumulativeBaseline {
  usage: TaskCostTokenUsage;
  actual: number | null;
  estimated: number | null;
}

function differenceField(
  current: number | null,
  previous: number | null,
  onBackward: () => void,
  round: (value: number) => number,
): { delta: number | null; baseline: number | null } {
  if (current === null) return { delta: null, baseline: previous };
  if (previous === null) return { delta: current, baseline: current };
  if (current >= previous) return { delta: round(current - previous), baseline: current };
  onBackward();
  return { delta: 0, baseline: current };
}

/**
 * Cumulative semantics: a `cumulative` event carries the running total for its
 * `(task_id, session_id)` scope. Snapshots are differenced in `sequence` order
 * against the previous snapshot's non-null values.
 *
 * - The first snapshot's total is its own delta (baseline zero).
 * - A `null` counter contributes a `null` delta and leaves the baseline alone.
 * - A regressing counter yields a delta of `0` (never negative), sets
 *   `backwardJump`, and rebases to the new lower value so later growth counts.
 *   The regressed snapshot's own usage is conservatively not counted.
 * - `delta` events pass through untouched and never move the baseline.
 */
export function reconcileCumulative(
  events: readonly TaskCostEventV1[],
): CumulativeReconciliation {
  let backwardJump = false;
  const markBackward = (): void => {
    backwardJump = true;
  };

  const derived = new Map<string, EffectiveObservation>();
  const bySession = new Map<string, TaskCostEventV1[]>();
  for (const event of events) {
    const list = bySession.get(event.session_id) ?? [];
    list.push(event);
    bySession.set(event.session_id, list);
  }

  for (const sessionEvents of bySession.values()) {
    const baseline: CumulativeBaseline = {
      usage: emptyTokenUsage(),
      actual: null,
      estimated: null,
    };
    const ordered = [...sessionEvents].sort(
      (a, b) => a.sequence - b.sequence || compareStrings(a.event_id, b.event_id),
    );
    for (const event of ordered) {
      if (event.usage_kind === 'delta') {
        derived.set(event.event_id, {
          event,
          usage: { ...event.usage },
          actual: event.actual_cost_usd,
          estimated: event.estimated_cost_usd,
        });
        continue;
      }

      const usage = emptyTokenUsage();
      for (const field of TASK_COST_TOKEN_FIELDS) {
        const result = differenceField(
          event.usage[field],
          baseline.usage[field],
          markBackward,
          (value) => value,
        );
        usage[field] = result.delta;
        baseline.usage[field] = result.baseline;
      }
      const actual = differenceField(event.actual_cost_usd, baseline.actual, markBackward, roundUsd);
      const estimated = differenceField(
        event.estimated_cost_usd,
        baseline.estimated,
        markBackward,
        roundUsd,
      );
      baseline.actual = actual.baseline;
      baseline.estimated = estimated.baseline;
      derived.set(event.event_id, {
        event,
        usage,
        actual: actual.delta,
        estimated: estimated.delta,
      });
    }
  }

  const observations = [...events]
    .sort(compareEvents)
    .map((event) => derived.get(event.event_id) as EffectiveObservation);
  return { observations, backwardJump };
}

/**
 * `provider_reported` and `local_estimate` together are `mixed`; `none` entries
 * are gaps, not a third source, and are ignored unless nothing else is present.
 */
export function promoteCostSource(
  sources: readonly (TaskCostEventSource | TaskCostSource)[],
): TaskCostSource {
  const hasProvider = sources.some((s) => s === 'provider_reported' || s === 'mixed');
  const hasEstimate = sources.some((s) => s === 'local_estimate' || s === 'mixed');
  if (hasProvider && hasEstimate) return 'mixed';
  if (hasProvider) return 'provider_reported';
  if (hasEstimate) return 'local_estimate';
  return 'none';
}

/**
 * Wavemill's `aggregateCoverage`, except that a confirmed-zero observation
 * counts as complete when mixed with complete ones (a real zero is not a gap).
 * Empty -> `unavailable`; all `unavailable` -> `unavailable`; all `known_zero`
 * -> `known_zero`; all `complete`/`known_zero` -> `complete`; else `partial`.
 */
export function promoteCoverage(coverages: readonly TaskCostCoverage[]): TaskCostCoverage {
  if (coverages.length === 0) return 'unavailable';
  if (coverages.every((c) => c === 'unavailable')) return 'unavailable';
  if (coverages.every((c) => c === 'known_zero')) return 'known_zero';
  if (coverages.every((c) => c === 'complete' || c === 'known_zero')) return 'complete';
  return 'partial';
}

function resolvedCost(observation: EffectiveObservation): number | null {
  return observation.actual ?? observation.estimated;
}

function observationSource(observation: EffectiveObservation): TaskCostEventSource {
  if (observation.actual !== null) return 'provider_reported';
  if (observation.estimated !== null) return 'local_estimate';
  return 'none';
}

/**
 * Per-observation cost coverage (Wavemill `normalizeSession` semantics):
 * no cost -> `unavailable` if no usage either, else `partial`; a confirmed-zero
 * cost -> `known_zero`; a cost with fully-observed usage -> `complete`; a cost
 * with incomplete usage -> `partial`.
 */
function observationCoverage(observation: EffectiveObservation): TaskCostCoverage {
  const usage = deriveUsageAvailability(observation.usage);
  const cost = resolvedCost(observation);
  if (cost === null) return usage === 'unavailable' ? 'unavailable' : 'partial';
  if (observation.actual === 0 || (cost === 0 && usage === 'known_zero')) return 'known_zero';
  return usage === 'available' ? 'complete' : 'partial';
}

function costAvailability(value: number | null): TaskCostFieldAvailability {
  if (value === null) return 'unavailable';
  return value === 0 ? 'known_zero' : 'available';
}

function sumUsage(usages: readonly TaskCostTokenUsage[]): TaskCostTokenUsage {
  const total = emptyTokenUsage();
  for (const usage of usages) {
    for (const field of TASK_COST_TOKEN_FIELDS) {
      total[field] = addNullable(total[field], usage[field]);
    }
  }
  return total;
}

function sumUsd(values: readonly (number | null)[]): number | null {
  return values.reduce<number | null>((sum, value) => addUsd(sum, value), null);
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function turnKey(event: TaskCostEventV1): string {
  return `${event.session_id}\u0000${event.turn_id}`;
}

function buildSegments(observations: readonly EffectiveObservation[]): TaskCostModelSegment[] {
  const runs: { model: string; members: EffectiveObservation[] }[] = [];
  for (const observation of observations) {
    const model = observation.event.observed_model;
    const last = runs[runs.length - 1];
    if (last && last.model === model) {
      last.members.push(observation);
    } else {
      runs.push({ model, members: [observation] });
    }
  }
  return runs.map(({ model, members: run }) => ({
    model,
    turn_count: new Set(run.map((o) => turnKey(o.event))).size,
    usage: sumUsage(run.map((o) => o.usage)),
    actual_cost_usd: sumUsd(run.map((o) => o.actual)),
    estimated_cost_usd: sumUsd(run.map((o) => o.estimated)),
    cost_source: promoteCostSource(run.map(observationSource)),
  }));
}

function promoteBasis(bases: readonly TaskCostBasis[]): TaskCostBasis {
  const [first, ...rest] = bases;
  return first !== undefined && rest.every((basis) => basis === first) ? first : 'unknown';
}

function promotePricingSource(sources: readonly TaskCostPricingSource[]): TaskCostPricingSource {
  const [first, ...rest] = distinct(sources.filter((s) => s !== 'none'));
  if (first === undefined) return 'none';
  return rest.length === 0 ? first : 'mixed';
}

/**
 * Summarize one task. Throws {@link TaskCostValidationError} for invalid
 * events (`schema_validation_failed` and friends), events spanning several
 * tasks/harnesses/provider contracts (`mixed_scope`), or replay cycles
 * (`replay_cycle`).
 */
export function aggregateTaskCost(
  events: readonly TaskCostEventV1[],
  options: AggregateTaskCostOptions = {},
): TaskCostSummaryV1 {
  for (const event of events) validateTaskCostEventV1(event);

  const taskIds = distinct(events.map((event) => event.task_id));
  if (options.taskId === undefined && taskIds.length > 1) {
    throw new TaskCostValidationError(
      'mixed_scope',
      'events span multiple task_ids; pass options.taskId to select one',
    );
  }
  const taskId = options.taskId ?? taskIds[0];
  const taskEvents = events.filter((event) => event.task_id === taskId);
  const [firstEvent] = taskEvents;
  if (taskId === undefined || firstEvent === undefined) {
    throw new TaskCostValidationError(
      'schema_validation_failed',
      'aggregateTaskCost requires at least one event for the task',
    );
  }

  const harness = firstEvent.harness;
  const providerContract = firstEvent.provider_contract_version;
  if (
    taskEvents.some(
      (event) =>
        event.harness !== harness || event.provider_contract_version !== providerContract,
    )
  ) {
    throw new TaskCostValidationError(
      'mixed_scope',
      'a summary covers one harness and one provider contract; aggregate per harness',
    );
  }

  const replay = resolveReplays(taskEvents);
  const { observations, backwardJump } = reconcileCumulative(replay.contributing);
  const contributing = observations.map((o) => o.event);

  const resolved = observations.map(resolvedCost);
  const totalComplete = resolved.every((cost) => cost !== null);
  const usage = sumUsage(observations.map((o) => o.usage));
  const coverage = promoteCoverage(observations.map(observationCoverage));
  const costSource = promoteCostSource(observations.map(observationSource));
  const bases = contributing.map((event) => event.cost_basis);

  const pricedEvents = contributing.filter((event) => event.estimated_cost_usd !== null);
  const revisions = distinct(
    pricedEvents.flatMap((event) => (event.pricing_revision ? [event.pricing_revision] : [])),
  ).sort();
  const pricingRevision = revisions[revisions.length - 1];

  const collectedAt =
    options.collectedAt ??
    taskEvents.reduce((latest, event) =>
      Date.parse(event.observed_at) > Date.parse(latest.observed_at) ? event : latest,
    ).observed_at;

  const derived = new Set<TaskCostDiagnosticCode>();
  if (observations.some((o) => o.usage.input_tokens === null || o.usage.output_tokens === null)) {
    derived.add('missing_token_usage');
  }
  if (
    observations.some(
      (o) =>
        resolvedCost(o) === null && o.usage.input_tokens !== null && o.usage.output_tokens !== null,
    )
  ) {
    derived.add('unpriced_model');
  }
  if (coverage === 'partial') derived.add('mixed_coverage');
  if (observations.some((o) => o.actual !== null)) derived.add('provider_reported_cost');
  if (resolved.every((cost) => cost === null)) derived.add('no_priced_sessions');
  if (revisions.length > 1) derived.add('stale_pricing_revision');
  if (replay.droppedDuplicates > 0) derived.add('replay_dropped');
  if (backwardJump) derived.add('cumulative_backward_jump');
  if (bases.includes('subscription')) derived.add('subscription_basis_no_charge');
  for (const event of contributing) {
    for (const code of event.diagnostics ?? []) derived.add(code);
  }

  const [harnessVersion, ...otherVersions] = distinct(
    contributing.flatMap((e) => (e.harness_version ? [e.harness_version] : [])),
  );

  return {
    schema_version: TASK_COST_SUMMARY_SCHEMA_VERSION,
    task_id: taskId,
    session_ids: distinct(contributing.map((event) => event.session_id)).sort(),
    ...(options.rootSessionId !== undefined ? { root_session_id: options.rootSessionId } : {}),
    harness,
    ...(harnessVersion !== undefined && otherVersions.length === 0
      ? { harness_version: harnessVersion }
      : {}),
    provider_contract_version: providerContract,
    models: distinct(contributing.map((event) => event.observed_model)),
    model_segments: buildSegments(observations),
    turn_count: new Set(contributing.map(turnKey)).size,
    turns_truncated: options.turnsTruncated ?? false,
    usage,
    actual_cost_usd: sumUsd(observations.map((o) => o.actual)),
    estimated_cost_usd: sumUsd(observations.map((o) => o.estimated)),
    total_cost_usd: totalComplete ? sumUsd(resolved) : null,
    cost_source: costSource,
    cost_basis: promoteBasis(bases),
    coverage,
    field_availability: {
      usage: promoteAvailability(observations.map((o) => deriveUsageAvailability(o.usage))),
      actual_cost: promoteAvailability(observations.map((o) => costAvailability(o.actual))),
      estimated_cost: promoteAvailability(observations.map((o) => costAvailability(o.estimated))),
      pricing: promoteAvailability(
        observations.map((o): TaskCostFieldAvailability =>
          o.estimated !== null ? 'available' : 'unavailable',
        ),
      ),
    },
    ...(pricingRevision !== undefined
      ? { pricing_revision: pricingRevision, pricing_timestamp: collectedAt }
      : {}),
    pricing_source: promotePricingSource(contributing.map((event) => event.pricing_source)),
    join_confidence: options.joinConfidence ?? 'unattributed',
    collected_at: collectedAt,
    event_count: contributing.length,
    event_ids: contributing.map((event) => event.event_id),
    diagnostics: TASK_COST_DIAGNOSTIC_CODES.filter((code) => derived.has(code)),
  };
}
