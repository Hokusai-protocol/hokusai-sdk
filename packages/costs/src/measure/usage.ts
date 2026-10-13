/**
 * Usage shape conversion and allow-list projection for the drop-in API.
 *
 * - camelCase `TaskCostUsage` <-> the contract's snake_case token usage;
 * - `fromAnthropicUsage` / `fromOpenAIUsage` map the two provider payload
 *   shapes most harnesses emit;
 * - every caller-supplied object is rebuilt from an explicit key allow-list
 *   before it can reach an engine, so extra keys (`prompt`, `cwd`, `apiKey`,
 *   …) have no code path into any output. Mirrors `sources/event-source.ts`.
 *
 * @module measure/usage
 */

import type { TaskCostEventV1, TaskCostTokenUsage } from '@hokusai/core';
import type { IngestUsageInput } from '../engine.js';
import type { TaskCostUsage, TaskUsageRecord } from './types.js';

/** Camel field -> contract field, in contract declaration order. */
const USAGE_FIELD_MAP = [
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['cacheReadTokens', 'cache_read_tokens'],
  ['cacheWriteTokens', 'cache_write_tokens'],
  ['reasoningTokens', 'reasoning_tokens'],
] as const satisfies ReadonlyArray<readonly [keyof TaskCostUsage, keyof TaskCostTokenUsage]>;

export function emptyUsage(): TaskCostUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
  };
}

/**
 * Project a caller's camelCase usage onto the contract shape. Values pass
 * through verbatim (including malformed ones) — the engine's normalizer is
 * the single place that decides valid-vs-rejected, so its diagnostics stay
 * authoritative.
 */
export function toContractUsage(
  usage: Partial<TaskCostUsage> | undefined,
): Partial<TaskCostTokenUsage> {
  const projected: Partial<TaskCostTokenUsage> = {};
  if (typeof usage !== 'object' || usage === null) return projected;
  for (const [camel, snake] of USAGE_FIELD_MAP) {
    if (Object.prototype.hasOwnProperty.call(usage, camel)) {
      const value = usage[camel];
      projected[snake] = value === undefined ? null : value;
    }
  }
  return projected;
}

/** The camelCase view of a contract usage record. */
export function toCamelUsage(usage: TaskCostTokenUsage): TaskCostUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_tokens,
    cacheWriteTokens: usage.cache_write_tokens,
    reasoningTokens: usage.reasoning_tokens,
  };
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Map an Anthropic Messages API `usage` payload (`input_tokens`,
 * `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
 * to {@link TaskCostUsage}. Anthropic's `input_tokens` excludes cache
 * reads/writes (they are billed separately), so the counters map one-to-one.
 * Thinking tokens are already inside `output_tokens`, so `reasoningTokens`
 * stays `null`. Malformed counters become `null`, never `0`.
 */
export function fromAnthropicUsage(usage: unknown): TaskCostUsage {
  const record = asRecord(usage);
  return {
    inputTokens: countOrNull(record.input_tokens),
    outputTokens: countOrNull(record.output_tokens),
    cacheReadTokens: countOrNull(record.cache_read_input_tokens),
    cacheWriteTokens: countOrNull(record.cache_creation_input_tokens),
    reasoningTokens: null,
  };
}

/**
 * Map an OpenAI Chat/Responses API `usage` payload (`prompt_tokens`,
 * `completion_tokens`, `prompt_tokens_details.cached_tokens`,
 * `completion_tokens_details.reasoning_tokens`) to {@link TaskCostUsage}.
 *
 * OpenAI's `prompt_tokens` *includes* cached tokens, so the cached subset is
 * subtracted out of `inputTokens` (and clamped at zero) — pricing bills the
 * two tiers separately and must not double count. `completion_tokens` already
 * includes reasoning tokens, so `reasoningTokens` is informational here: do
 * not combine this mapper with `harness: 'codex'`, whose pricing adds
 * reasoning tokens on top of output (Codex rollouts report them disjointly).
 */
export function fromOpenAIUsage(usage: unknown): TaskCostUsage {
  const record = asRecord(usage);
  const prompt = countOrNull(record.prompt_tokens);
  const cached = countOrNull(asRecord(record.prompt_tokens_details).cached_tokens);
  return {
    inputTokens:
      prompt === null ? null : cached === null ? prompt : Math.max(0, prompt - cached),
    outputTokens: countOrNull(record.completion_tokens),
    cacheReadTokens: cached,
    cacheWriteTokens: null,
    reasoningTokens: countOrNull(
      asRecord(record.completion_tokens_details).reasoning_tokens,
    ),
  };
}

/**
 * Allow-lists mirror `sources/event-source.ts`: anything not named here is
 * dropped when a record is rebuilt, so no extra key on a caller-supplied
 * object survives into tracker output.
 */
export const USAGE_RECORD_ALLOWED_KEYS = [
  'model',
  'usage',
  'harness',
  'providerCostUsd',
  'costBasis',
  'eventId',
  'sessionId',
  'turnId',
  'occurredAt',
  'usageKind',
  'isSubagent',
  'replayOfEventId',
] as const satisfies ReadonlyArray<keyof TaskUsageRecord>;

const FRIENDLY_ALLOWED_KEYS = [
  'eventId',
  'taskId',
  'sessionId',
  'turnId',
  'sequence',
  'harness',
  'harnessVersion',
  'providerContractVersion',
  'observedModel',
  'usage',
  'usageKind',
  'actualCostUsd',
  'observedAt',
  'costBasis',
  'replayOfEventId',
  'parentEventId',
  'isSubagent',
  'diagnostics',
  'estimatedCostUsd',
  'pricingSource',
  'priceTable',
] as const;

const PREBUILT_ALLOWED_KEYS = [
  'schema_version',
  'event_id',
  'task_id',
  'session_id',
  'turn_id',
  'sequence',
  'parent_event_id',
  'is_subagent',
  'replay_of_event_id',
  'harness',
  'harness_version',
  'provider_contract_version',
  'observed_model',
  'usage_kind',
  'usage',
  'usage_coverage',
  'actual_cost_usd',
  'estimated_cost_usd',
  'cost_source',
  'cost_basis',
  'pricing_source',
  'pricing_revision',
  'price_table',
  'observed_at',
  'diagnostics',
] as const;

function projectAllowed<T>(
  source: Record<string, unknown>,
  allowed: readonly string[],
): T {
  const projected: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      projected[key] = source[key];
    }
  }
  return projected as T;
}

export function projectUsageRecord(record: Record<string, unknown>): TaskUsageRecord {
  const projected = projectAllowed<TaskUsageRecord>(record, USAGE_RECORD_ALLOWED_KEYS);
  if (projected.usage !== undefined) {
    // Rebuild the nested usage from its own allow-list too.
    const usage = asRecord(projected.usage);
    const clean: Partial<TaskCostUsage> = {};
    for (const [camel] of USAGE_FIELD_MAP) {
      if (Object.prototype.hasOwnProperty.call(usage, camel)) {
        clean[camel] = usage[camel] as number | null;
      }
    }
    projected.usage = clean;
  }
  return projected;
}

export function projectIngestInput(record: Record<string, unknown>): IngestUsageInput {
  return projectAllowed<IngestUsageInput>(record, FRIENDLY_ALLOWED_KEYS);
}

export function projectPrebuiltEvent(record: Record<string, unknown>): TaskCostEventV1 {
  return projectAllowed<TaskCostEventV1>(record, PREBUILT_ALLOWED_KEYS);
}
