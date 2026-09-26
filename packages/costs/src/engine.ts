/**
 * The task cost engine: accepts usage events for exactly one task and
 * produces cost/token totals with attribution and coverage, entirely offline
 * (no Hokusai credentials, no network).
 *
 * The engine is a thin, stateful shell around the `@hokusai/core` task-cost
 * contract:
 *
 * - it prices friendly inputs per event (`resolveEventPrice`) — the contract
 *   reducer never prices anything;
 * - it stamps provenance (`pricing_source` / `price_table` /
 *   `pricing_revision`) on every priced row;
 * - it dedupes by `event_id` at ingest time (idempotent replays);
 * - `snapshot()` delegates every summary semantic — replay chains,
 *   cumulative-vs-delta reconciliation, coverage promotion, model segments,
 *   deterministic nano-USD rounding — to `aggregateTaskCost`.
 *
 * All state lives in per-engine closure locals; two engines can never share
 * accounting state.
 *
 * @module engine
 */

import {
  TASK_COST_DIAGNOSTIC_CODES,
  TASK_COST_EVENT_SCHEMA_VERSION,
  TaskCostValidationError,
  aggregateTaskCost,
  normalizeModelId,
  validateTaskCostEventV1,
  type TaskCostBasis,
  type TaskCostDiagnosticCode,
  type TaskCostEventV1,
  type TaskCostHarness,
  type TaskCostJoinConfidence,
  type TaskCostPriceTable,
  type TaskCostSummaryV1,
  type TaskCostTokenUsage,
  type TaskCostUsageKind,
} from '@hokusai/core';
import {
  buildOverrideIndex,
  resolveEventPrice,
  type HostPriceOverride,
} from './pricing-resolver.js';
import {
  buildTaskCostEvent,
  mergeDiagnostics,
  normalizeUsage,
} from './usage-normalizer.js';

export interface CreateTaskCostEngineOptions {
  /** Required. Every ingested event's task id must equal this. */
  taskId: string;
  /** Explicit host overrides that beat the built-in price table. */
  priceOverrides?: readonly HostPriceOverride[];
  /** Revision stamped on rows priced from the built-in table; defaults to `MODEL_PRICING_AS_OF`. */
  pricingRevision?: string;
  /** Passed through to `aggregateTaskCost` on `snapshot()`. */
  collectedAt?: string;
  joinConfidence?: TaskCostJoinConfidence;
  rootSessionId?: string;
  turnsTruncated?: boolean;
}

/** Friendly ingest input. The engine derives pricing, coverage, and source. */
export interface IngestUsageInput {
  eventId: string;
  taskId: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  harness: TaskCostHarness;
  harnessVersion?: string;
  providerContractVersion: string;
  observedModel: string;
  /** Tokens the caller measured; missing counters are stored as `null`, never `0`. */
  usage: Partial<TaskCostTokenUsage>;
  /** Defaults to `'delta'`. */
  usageKind?: TaskCostUsageKind;
  /** Provider-reported charge. `0` is a known-zero charge; `null`/absent is missing. */
  actualCostUsd?: number | null;
  observedAt: string;
  /** Defaults to `'per_token_api'`. */
  costBasis?: TaskCostBasis;
  replayOfEventId?: string;
  parentEventId?: string;
  isSubagent?: boolean;
  diagnostics?: readonly TaskCostDiagnosticCode[];
  /**
   * Caller-supplied estimate (OpenRouter-style adapters). When present —
   * including an explicit `null` — the engine trusts it and skips its own
   * pricing.
   */
  estimatedCostUsd?: number | null;
  pricingSource?: 'local_estimate' | 'openrouter_api';
  priceTable?: TaskCostPriceTable;
}

export type IngestResult =
  | { status: 'accepted'; event: TaskCostEventV1 }
  | { status: 'duplicate'; eventId: string; event: TaskCostEventV1 }
  | {
      status: 'rejected';
      reason: string;
      diagnostics: readonly TaskCostDiagnosticCode[];
    };

export interface TaskCostEngine {
  readonly taskId: string;
  /** Ingest one friendly input OR a pre-built (already priced) `TaskCostEventV1`. */
  ingest(input: IngestUsageInput | TaskCostEventV1): IngestResult;
  ingestMany(
    inputs: readonly (IngestUsageInput | TaskCostEventV1)[],
  ): readonly IngestResult[];
  /** All accepted contract events, in ingest order. Frozen. */
  events(): readonly TaskCostEventV1[];
  /** Delegates to `aggregateTaskCost`. Throws `TaskCostValidationError` on inconsistency. */
  snapshot(): TaskCostSummaryV1;
}

function isPrebuiltEvent(
  input: IngestUsageInput | TaskCostEventV1,
): input is TaskCostEventV1 {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { schema_version?: unknown }).schema_version ===
      TASK_COST_EVENT_SCHEMA_VERSION
  );
}

function reject(
  reason: string,
  diagnostics: readonly TaskCostDiagnosticCode[] = [],
): IngestResult {
  return { status: 'rejected', reason, diagnostics };
}

/**
 * Create a fresh, isolated engine for one task. Throws `TypeError` for a
 * malformed configuration (empty task id, invalid or duplicate price
 * overrides) so misconfiguration fails at construction, not mid-accounting.
 */
export function createTaskCostEngine(
  options: CreateTaskCostEngineOptions,
): TaskCostEngine {
  const { taskId } = options;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new TypeError('createTaskCostEngine requires a non-empty taskId');
  }
  // Validate overrides eagerly (throws TypeError naming the offending model).
  const overrides = options.priceOverrides ?? [];
  buildOverrideIndex(overrides);
  const pricingContext = {
    overrides,
    ...(options.pricingRevision !== undefined
      ? { pricingRevision: options.pricingRevision }
      : {}),
  };

  const events: TaskCostEventV1[] = [];
  const byId = new Map<string, TaskCostEventV1>();

  function accept(event: TaskCostEventV1): IngestResult {
    events.push(event);
    byId.set(event.event_id, event);
    return { status: 'accepted', event };
  }

  function ingestPrebuilt(event: TaskCostEventV1): IngestResult {
    try {
      validateTaskCostEventV1(event);
    } catch (error) {
      if (error instanceof TaskCostValidationError) {
        return reject(`${error.code}: ${error.message}`);
      }
      throw error;
    }
    if (event.task_id !== taskId) {
      return reject(
        `schema_validation_failed: event.task_id "${event.task_id}" does not belong to this engine's taskId "${taskId}"`,
      );
    }
    const existing = byId.get(event.event_id);
    if (existing !== undefined) {
      return { status: 'duplicate', eventId: event.event_id, event: existing };
    }
    return accept(event);
  }

  function ingestFriendly(input: IngestUsageInput): IngestResult {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof input.eventId !== 'string'
    ) {
      return reject(
        'schema_validation_failed: input must be an object with a string eventId',
      );
    }
    if (input.taskId !== taskId) {
      return reject(
        `schema_validation_failed: input.taskId "${String(input.taskId)}" does not belong to this engine's taskId "${taskId}"`,
      );
    }
    const existing = byId.get(input.eventId);
    if (existing !== undefined) {
      return { status: 'duplicate', eventId: input.eventId, event: existing };
    }

    const normalized = normalizeUsage(input.usage ?? {});
    if (!normalized.ok) {
      return reject(
        `invalid_token_usage: ${normalized.problems.join('; ')}`,
        normalized.diagnostics,
      );
    }

    // A subscription has no per-call charge by definition; a caller that
    // claims both is contradicting itself, and neither figure can be trusted.
    if (
      input.costBasis === 'subscription' &&
      typeof input.actualCostUsd === 'number' &&
      Number.isFinite(input.actualCostUsd)
    ) {
      return reject(
        'schema_validation_failed: actualCostUsd must be null/absent when costBasis is "subscription"',
      );
    }

    const observedModel =
      typeof input.observedModel === 'string'
        ? normalizeModelId(input.observedModel)
        : '';
    const pricing = resolveEventPrice(
      {
        observedModel,
        usage: normalized.usage,
        harness: input.harness,
        ...(input.actualCostUsd !== undefined
          ? { actualCostUsd: input.actualCostUsd }
          : {}),
        ...(input.costBasis !== undefined
          ? { costBasis: input.costBasis }
          : {}),
        ...(input.estimatedCostUsd !== undefined
          ? { estimatedCostUsd: input.estimatedCostUsd }
          : {}),
        ...(input.pricingSource !== undefined
          ? { pricingSource: input.pricingSource }
          : {}),
        ...(input.priceTable !== undefined
          ? { priceTable: input.priceTable }
          : {}),
      },
      pricingContext,
    );

    const diagnostics = mergeDiagnostics(
      TASK_COST_DIAGNOSTIC_CODES,
      input.diagnostics ?? [],
      pricing.diagnostics,
    );
    const event = buildTaskCostEvent(
      input,
      observedModel,
      normalized.usage,
      pricing,
      diagnostics,
    );

    // Safety net: the contract validator is the normative schema. Anything it
    // rejects (bad ids, timestamps, enum values, forbidden keys) never enters
    // the ledger.
    try {
      validateTaskCostEventV1(event);
    } catch (error) {
      if (error instanceof TaskCostValidationError) {
        return reject(`${error.code}: ${error.message}`, diagnostics);
      }
      throw error;
    }
    return accept(event);
  }

  const ingest = (input: IngestUsageInput | TaskCostEventV1): IngestResult =>
    isPrebuiltEvent(input) ? ingestPrebuilt(input) : ingestFriendly(input);

  return {
    taskId,
    ingest,
    ingestMany(inputs) {
      return inputs.map(ingest);
    },
    events() {
      return Object.freeze([...events]);
    },
    snapshot() {
      if (events.length === 0) {
        throw new TaskCostValidationError(
          'schema_validation_failed',
          `no events ingested for task "${taskId}"`,
        );
      }
      return aggregateTaskCost(events, {
        taskId,
        ...(options.collectedAt !== undefined
          ? { collectedAt: options.collectedAt }
          : {}),
        ...(options.joinConfidence !== undefined
          ? { joinConfidence: options.joinConfidence }
          : {}),
        ...(options.rootSessionId !== undefined
          ? { rootSessionId: options.rootSessionId }
          : {}),
        ...(options.turnsTruncated !== undefined
          ? { turnsTruncated: options.turnsTruncated }
          : {}),
      });
    },
  };
}
