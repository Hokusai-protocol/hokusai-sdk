/**
 * Map contract `TaskCostEventV1` records onto ledger append entries, so a
 * tracker (or any host holding contract events) can persist them to the
 * opt-in local ledger without hand-rolling the 17-field record shape.
 *
 * Mapping rules:
 *
 * - `eventKey` is the contract `event_id` (hashed by the ledger, never
 *   stored raw), so a re-run of the same task dedupes;
 * - `backend` is the event's `price_table` when present, else the provider
 *   prefix of a `provider/model` id, else `'unknown'`;
 * - `pricingBasis` / `amountMicros`: a provider-reported charge is `metered`,
 *   a local estimate is `token_equivalent`, no cost is `unpriced` with a
 *   `null` amount — a missing price is never stored as `$0`;
 * - a `null` token counter is stored as `0` with `coverage: 'partial'`, so
 *   the zero is never read back as a known value.
 *
 * @module ledger/from-events
 */

import type { TaskCostEventV1 } from '@hokusai/core';
import type { LedgerPricingBasis, ToLedgerRecordInput } from './record.js';

export interface LedgerEntry {
  input: ToLedgerRecordInput;
  eventKey: string;
}

function backendOf(event: TaskCostEventV1): string {
  if (event.price_table !== undefined) return event.price_table;
  const slash = event.observed_model.indexOf('/');
  return slash > 0 ? event.observed_model.slice(0, slash) : 'unknown';
}

function toMicros(usd: number): number {
  return Math.round(usd * 1e6);
}

/**
 * Convert events into `appendMany` entries:
 * `ledger.appendMany(toLedgerEntries(tracker.events()))`.
 */
export function toLedgerEntries(
  events: readonly TaskCostEventV1[],
): LedgerEntry[] {
  return events.map((event) => {
    const resolved = event.actual_cost_usd ?? event.estimated_cost_usd;
    const pricingBasis: LedgerPricingBasis =
      event.actual_cost_usd !== null
        ? 'metered'
        : event.estimated_cost_usd !== null
          ? 'token_equivalent'
          : 'unpriced';
    const counters = [
      event.usage.input_tokens,
      event.usage.output_tokens,
      event.usage.cache_read_tokens,
      event.usage.cache_write_tokens,
    ];
    return {
      eventKey: event.event_id,
      input: {
        taskId: event.task_id,
        model: event.observed_model,
        harness: event.harness,
        backend: backendOf(event),
        source: event.cost_source,
        pricingBasis,
        amountMicros: resolved === null ? null : toMicros(resolved),
        ts: Date.parse(event.observed_at),
        inputTokens: event.usage.input_tokens ?? 0,
        outputTokens: event.usage.output_tokens ?? 0,
        cacheReadTokens: event.usage.cache_read_tokens ?? 0,
        cacheWriteTokens: event.usage.cache_write_tokens ?? 0,
        coverage: counters.every((counter) => counter !== null)
          ? 'complete'
          : 'partial',
      },
    };
  });
}
