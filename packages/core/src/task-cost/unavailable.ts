/**
 * The summary of a stage that ran but produced no usage events (HOK-3412).
 *
 * `aggregateTaskCost` requires at least one event, and an empty
 * `@hokusai/costs` tracker reports `summaries: []`. A v4 contribution row
 * still needs a `task_cost` for every stage, so an unmeasured stage carries
 * this explicit "we don't know" summary instead of nothing: null usage and
 * cost, `coverage: 'unavailable'`, zero events.
 *
 * @module task-cost/unavailable
 */

import type { TaskCostBasis, TaskCostHarness } from './enums.js';
import { PROVIDER_CONTRACT_VERSIONS, TASK_COST_SUMMARY_SCHEMA_VERSION } from './schema-version.js';
import type { TaskCostSummaryV1 } from './summary.js';
import { emptyTokenUsage } from './token-usage.js';
import { validateTaskCostSummaryV1 } from './validators.js';

export interface UnavailableTaskCostSummaryInput {
  taskId: string;
  harness: TaskCostHarness;
  /** Defaults to the harness's registered contract, else `<harness>/1`. */
  providerContractVersion?: string;
  harnessVersion?: string;
  /** Sessions the stage is known to have used, if any. */
  sessionIds?: readonly string[];
  /** Defaults to `unknown`. */
  costBasis?: TaskCostBasis;
  collectedAt: string;
}

/** Default provider contract for a harness: the registered one, else `<harness>/1`. */
export function defaultProviderContractVersion(harness: TaskCostHarness): string {
  return (PROVIDER_CONTRACT_VERSIONS as Readonly<Record<string, string>>)[harness] ?? `${harness}/1`;
}

/** Build (and validate) the summary of an unmeasured stage. Throws on invalid ids. */
export function unavailableTaskCostSummary(input: UnavailableTaskCostSummaryInput): TaskCostSummaryV1 {
  const summary: TaskCostSummaryV1 = {
    schema_version: TASK_COST_SUMMARY_SCHEMA_VERSION,
    task_id: input.taskId,
    session_ids: [...new Set(input.sessionIds ?? [])].sort(),
    harness: input.harness,
    ...(input.harnessVersion !== undefined ? { harness_version: input.harnessVersion } : {}),
    provider_contract_version:
      input.providerContractVersion ?? defaultProviderContractVersion(input.harness),
    models: [],
    model_segments: [],
    turn_count: 0,
    turns_truncated: false,
    usage: emptyTokenUsage(),
    actual_cost_usd: null,
    estimated_cost_usd: null,
    total_cost_usd: null,
    cost_source: 'none',
    cost_basis: input.costBasis ?? 'unknown',
    coverage: 'unavailable',
    field_availability: {
      usage: 'unavailable',
      actual_cost: 'unavailable',
      estimated_cost: 'unavailable',
      pricing: 'unavailable',
    },
    pricing_source: 'none',
    join_confidence: 'unattributed',
    collected_at: input.collectedAt,
    event_count: 0,
    event_ids: [],
    diagnostics: [],
  };
  validateTaskCostSummaryV1(summary);
  return summary;
}
