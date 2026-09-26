/**
 * Friendly-input normalization: partial token usage in, contract-shaped
 * `TaskCostTokenUsage` and assembled `TaskCostEventV1` out.
 *
 * The one rule that matters: a missing counter becomes `null` ("not
 * reported"), never `0`. A counter that is *present but malformed* (negative,
 * non-finite, non-integer) makes the whole input invalid — silently coercing
 * it would fabricate usage.
 *
 * @module usage-normalizer
 */

import {
  TASK_COST_EVENT_SCHEMA_VERSION,
  TASK_COST_TOKEN_FIELDS,
  type TaskCostDiagnosticCode,
  type TaskCostEventV1,
  type TaskCostFieldAvailability,
  type TaskCostTokenUsage,
} from '@hokusai/core';
import type { ResolvedEventPricing } from './pricing-resolver.js';
import type { IngestUsageInput } from './engine.js';

export interface NormalizedUsage {
  ok: boolean;
  usage: TaskCostTokenUsage;
  diagnostics: TaskCostDiagnosticCode[];
  /** Human-readable reasons for a rejection; empty when `ok`. */
  problems: string[];
}

/**
 * Normalize a caller's partial usage record. Missing / `undefined` / `null`
 * counters become `null`; finite non-negative integers pass through; anything
 * else fails with `invalid_token_usage`.
 */
export function normalizeUsage(
  partial: Partial<TaskCostTokenUsage>,
): NormalizedUsage {
  const usage = {} as TaskCostTokenUsage;
  const problems: string[] = [];
  for (const field of TASK_COST_TOKEN_FIELDS) {
    const value = partial[field];
    if (value === undefined || value === null) {
      usage[field] = null;
    } else if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0
    ) {
      usage[field] = value;
    } else {
      usage[field] = null;
      problems.push(
        `usage.${field} must be a non-negative integer or null, got ${String(value)}`,
      );
    }
  }
  return {
    ok: problems.length === 0,
    usage,
    diagnostics: problems.length > 0 ? ['invalid_token_usage'] : [],
    problems,
  };
}

/**
 * The availability implied by a usage record — same rule the contract's
 * validator enforces for `usage_coverage` (`deriveUsageAvailability` is not
 * part of `@hokusai/core`'s public surface; any drift here fails
 * `validateTaskCostEventV1` loudly rather than mispricing quietly).
 */
export function deriveUsageCoverage(
  usage: TaskCostTokenUsage,
): TaskCostFieldAvailability {
  const values = TASK_COST_TOKEN_FIELDS.map((field) => usage[field]);
  if (values.every((value) => value === null)) return 'unavailable';
  if (values.some((value) => value === null)) return 'partial';
  return values.every((value) => value === 0) ? 'known_zero' : 'available';
}

/** Diagnostics in enum-declaration order with duplicates removed. */
export function mergeDiagnostics(
  order: readonly TaskCostDiagnosticCode[],
  ...sources: readonly (readonly TaskCostDiagnosticCode[])[]
): TaskCostDiagnosticCode[] {
  const present = new Set(sources.flat());
  return order.filter((code) => present.has(code));
}

/**
 * Assemble the contract event from a normalized friendly input and its
 * resolved pricing. `observedModel` is stored post-`normalizeModelId` by the
 * engine before this point; this function is purely mechanical.
 */
export function buildTaskCostEvent(
  input: IngestUsageInput,
  observedModel: string,
  usage: TaskCostTokenUsage,
  pricing: ResolvedEventPricing,
  diagnostics: readonly TaskCostDiagnosticCode[],
): TaskCostEventV1 {
  return {
    schema_version: TASK_COST_EVENT_SCHEMA_VERSION,
    event_id: input.eventId,
    task_id: input.taskId,
    session_id: input.sessionId,
    turn_id: input.turnId,
    sequence: input.sequence,
    ...(input.parentEventId !== undefined
      ? { parent_event_id: input.parentEventId }
      : {}),
    ...(input.isSubagent !== undefined
      ? { is_subagent: input.isSubagent }
      : {}),
    ...(input.replayOfEventId !== undefined
      ? { replay_of_event_id: input.replayOfEventId }
      : {}),
    harness: input.harness,
    ...(input.harnessVersion !== undefined
      ? { harness_version: input.harnessVersion }
      : {}),
    provider_contract_version: input.providerContractVersion,
    observed_model: observedModel,
    usage_kind: input.usageKind ?? 'delta',
    usage,
    usage_coverage: deriveUsageCoverage(usage),
    actual_cost_usd: pricing.actualCostUsd,
    estimated_cost_usd: pricing.estimatedCostUsd,
    cost_source: pricing.costSource,
    cost_basis: input.costBasis ?? 'per_token_api',
    pricing_source: pricing.pricingSource,
    ...(pricing.pricingRevision !== undefined
      ? { pricing_revision: pricing.pricingRevision }
      : {}),
    ...(pricing.priceTable !== undefined
      ? { price_table: pricing.priceTable }
      : {}),
    observed_at: input.observedAt,
    ...(diagnostics.length > 0 ? { diagnostics: [...diagnostics] } : {}),
  };
}
