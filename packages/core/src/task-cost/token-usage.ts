/**
 * Null-preserving token usage.
 *
 * `null` means "missing / not reported"; a number (including `0`) means
 * "observed". Nothing in the contract ever fills a missing counter with `0`.
 *
 * @module task-cost/token-usage
 */

import type { TaskCostFieldAvailability } from './enums.js';

export interface TaskCostTokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  /** Thinking tokens (Claude Code) / reasoning output tokens (Codex). */
  reasoning_tokens: number | null;
}

export const TASK_COST_TOKEN_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
] as const satisfies ReadonlyArray<keyof TaskCostTokenUsage>;
export type TaskCostTokenField = (typeof TASK_COST_TOKEN_FIELDS)[number];

export function emptyTokenUsage(): TaskCostTokenUsage {
  return {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
  };
}

/**
 * Null-preserving sum: `null` only when both operands are `null`; otherwise a
 * `null` operand contributes nothing. Whether the total is *complete* is a
 * separate question answered by {@link promoteAvailability}.
 */
export function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/**
 * The availability implied by a single usage record. This is the exact rule
 * validators enforce for an event's `usage_coverage`:
 *
 * - every counter `null`            -> `unavailable`
 * - any counter `null`              -> `partial`
 * - every counter `0`               -> `known_zero`
 * - otherwise (all present)         -> `available`
 */
export function deriveUsageAvailability(usage: TaskCostTokenUsage): TaskCostFieldAvailability {
  const values = TASK_COST_TOKEN_FIELDS.map((field) => usage[field]);
  if (values.every((value) => value === null)) return 'unavailable';
  if (values.some((value) => value === null)) return 'partial';
  return values.every((value) => value === 0) ? 'known_zero' : 'available';
}

/**
 * Promote many availabilities to one: all `unavailable` -> `unavailable`; all
 * `known_zero` -> `known_zero`; all known (`available`/`known_zero`) ->
 * `available`; anything else -> `partial`. An empty list is `unavailable`.
 */
export function promoteAvailability(
  values: readonly TaskCostFieldAvailability[],
): TaskCostFieldAvailability {
  if (values.length === 0) return 'unavailable';
  if (values.every((value) => value === 'unavailable')) return 'unavailable';
  if (values.every((value) => value === 'known_zero')) return 'known_zero';
  if (values.every((value) => value === 'available' || value === 'known_zero')) return 'available';
  return 'partial';
}
