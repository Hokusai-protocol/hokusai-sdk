/**
 * Durable, append-only envelope grouping the events of one session. A ledger
 * may span several `task_id`s (concurrent tasks in one session); summaries are
 * derived per task by filtering events.
 *
 * Ledgers keep superseded and duplicate events for audit. Only the reducer
 * decides which events contribute (see `aggregateTaskCost`).
 *
 * @module task-cost/ledger
 */

import type { TaskCostHarness } from './enums.js';
import type { TaskCostEventV1 } from './event.js';
import type { TASK_COST_LEDGER_SCHEMA_VERSION } from './schema-version.js';

export interface TaskCostLedgerV1 {
  schema_version: typeof TASK_COST_LEDGER_SCHEMA_VERSION;
  harness: TaskCostHarness;
  harness_version?: string;
  provider_contract_version: string;
  session_id: string;
  /** Sorted, de-duplicated set of `task_id`s present in `events`. */
  task_ids: string[];
  opened_at: string;
  closed_at?: string;
  /** True when the source bounded the history and older events are absent. */
  truncated: boolean;
  /** Must equal `events.length`. */
  event_count: number;
  events: TaskCostEventV1[];
}
