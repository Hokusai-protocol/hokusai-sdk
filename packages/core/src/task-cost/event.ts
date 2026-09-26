/**
 * The immutable, append-only unit an adapter emits: one observation of usage
 * and cost for one turn of one session of one task.
 *
 * Invariants (enforced by `validateTaskCostEventV1`):
 *
 * - `usage_coverage` equals the availability derived from `usage`.
 * - `cost_source` is `provider_reported` iff `actual_cost_usd !== null`;
 *   otherwise `local_estimate` iff `estimated_cost_usd !== null`; otherwise
 *   `none`. `mixed` is never legal on an event.
 * - `cost_basis: 'subscription'` requires `actual_cost_usd === null`.
 * - `pricing_source === 'none'` iff `estimated_cost_usd === null`.
 * - No free-text fields exist: identifiers are constrained slugs and
 *   diagnostics are enum codes, so prompts, paths, and account identifiers
 *   have nowhere to hide.
 *
 * @module task-cost/event
 */

import type {
  TaskCostBasis,
  TaskCostDiagnosticCode,
  TaskCostEventSource,
  TaskCostFieldAvailability,
  TaskCostHarness,
  TaskCostPriceTable,
  TaskCostPricingSource,
  TaskCostUsageKind,
} from './enums.js';
import type { TaskCostTokenUsage } from './token-usage.js';
import type { TASK_COST_EVENT_SCHEMA_VERSION } from './schema-version.js';

export interface TaskCostEventV1 {
  schema_version: typeof TASK_COST_EVENT_SCHEMA_VERSION;
  /**
   * Idempotency key. Client-generated, stable across adapter restarts
   * (ULID/UUIDv7 recommended). A second event with the same id is a replay.
   */
  event_id: string;
  /** The routed Hokusai task this usage belongs to. */
  task_id: string;
  session_id: string;
  turn_id: string;
  /** Monotonic within `(task_id, session_id)`; orders cumulative snapshots. */
  sequence: number;
  /** Event this one nests under (subagent / sidechain turns). */
  parent_event_id?: string;
  is_subagent?: boolean;
  /**
   * Explicit supersede: this event replaces the referenced prior event (for
   * example a retried turn). Both stay in the ledger; only this one counts.
   */
  replay_of_event_id?: string;
  harness: TaskCostHarness;
  harness_version?: string;
  /** Parsing contract implemented by the emitter, e.g. `claude-code/1`. */
  provider_contract_version: string;
  /** Model observed in telemetry, post-`normalizeModelId`. */
  observed_model: string;
  usage_kind: TaskCostUsageKind;
  usage: TaskCostTokenUsage;
  usage_coverage: TaskCostFieldAvailability;
  /** Provider-reported charge. `0` is a known-zero charge; `null` is missing. */
  actual_cost_usd: number | null;
  /** Token-equivalent estimate from a local price table. Not a charge. */
  estimated_cost_usd: number | null;
  cost_source: TaskCostEventSource;
  cost_basis: TaskCostBasis;
  pricing_source: TaskCostPricingSource;
  /** Price-table revision (`as_of` date) applied; set with an estimate. */
  pricing_revision?: string;
  price_table?: TaskCostPriceTable;
  /** ISO-8601 UTC timestamp of the observation. */
  observed_at: string;
  diagnostics?: TaskCostDiagnosticCode[];
}
