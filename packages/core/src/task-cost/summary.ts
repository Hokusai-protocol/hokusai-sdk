/**
 * Per-task aggregate derived from events by `aggregateTaskCost`. This is the
 * shape Wavemill's workflow-cost / execution-economics output migrates to.
 *
 * Cost semantics:
 *
 * - `actual_cost_usd` / `estimated_cost_usd` are the sums of the events that
 *   carry each figure. When the matching `field_availability` entry is
 *   `partial` the sum is a **lower bound**, not a total.
 * - `total_cost_usd` resolves each event to `actual ?? estimated` and sums
 *   them, but is `null` unless *every* contributing event resolved — the
 *   contract never presents an undercount as a total.
 *
 * @module task-cost/summary
 */

import type {
  TaskCostBasis,
  TaskCostCoverage,
  TaskCostDiagnosticCode,
  TaskCostFieldAvailability,
  TaskCostHarness,
  TaskCostJoinConfidence,
  TaskCostPricingSource,
  TaskCostSource,
} from './enums.js';
import type { TaskCostTokenUsage } from './token-usage.js';
import type { TASK_COST_SUMMARY_SCHEMA_VERSION } from './schema-version.js';

/** A consecutive same-model run of turns; survives model switches. */
export interface TaskCostModelSegment {
  model: string;
  turn_count: number;
  usage: TaskCostTokenUsage;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  cost_source: TaskCostSource;
}

export interface TaskCostSummaryFieldAvailability {
  usage: TaskCostFieldAvailability;
  actual_cost: TaskCostFieldAvailability;
  estimated_cost: TaskCostFieldAvailability;
  pricing: TaskCostFieldAvailability;
}

export interface TaskCostSummaryV1 {
  schema_version: typeof TASK_COST_SUMMARY_SCHEMA_VERSION;
  task_id: string;
  /** Sorted, de-duplicated. */
  session_ids: string[];
  root_session_id?: string;
  harness: TaskCostHarness;
  harness_version?: string;
  provider_contract_version: string;
  /** Distinct models in order of first appearance. */
  models: string[];
  model_segments: TaskCostModelSegment[];
  /** Distinct `(session_id, turn_id)` pairs among contributing events. */
  turn_count: number;
  turns_truncated: boolean;
  usage: TaskCostTokenUsage;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  total_cost_usd: number | null;
  cost_source: TaskCostSource;
  cost_basis: TaskCostBasis;
  coverage: TaskCostCoverage;
  field_availability: TaskCostSummaryFieldAvailability;
  pricing_revision?: string;
  /** Set (to `collected_at`) whenever `pricing_revision` is. */
  pricing_timestamp?: string;
  pricing_source: TaskCostPricingSource;
  join_confidence: TaskCostJoinConfidence;
  collected_at: string;
  /** Contributing events only (superseded and duplicate events excluded). */
  event_count: number;
  event_ids: string[];
  diagnostics: TaskCostDiagnosticCode[];
}
