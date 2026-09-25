/**
 * The interface a harness integration implements to feed the task-cost
 * contract. Types only: no adapter runtime ships with this contract version.
 *
 * Synchronous by design — existing harness readers (transcript and sidecar
 * files) are synchronous and already-local. A network-backed adapter can add an
 * async companion under a new adapter contract version.
 *
 * @module task-cost/adapter
 */

import type { TaskCostHarness } from './enums.js';
import type { TaskCostEventV1 } from './event.js';
import type { TaskCostLedgerV1 } from './ledger.js';
import type { TaskCostSummaryV1 } from './summary.js';
import type { TASK_COST_ADAPTER_CONTRACT_VERSION } from './schema-version.js';

export interface TaskCostAdapterCapabilities {
  supportsActualCost: boolean;
  supportsDelta: boolean;
  supportsCumulative: boolean;
  supportsSubscriptionBasis: boolean;
  providerContractVersion: string;
}

export interface TaskCostPollInput {
  sessionId: string;
  taskId?: string;
  /** Return only events with a `sequence` greater than this. */
  afterSequence?: number;
}

export interface TaskCostSummarizeInput {
  taskId: string;
  events: readonly TaskCostEventV1[];
}

export interface TaskCostAdapterV1 {
  contractVersion: typeof TASK_COST_ADAPTER_CONTRACT_VERSION;
  harness: TaskCostHarness;
  describeCapabilities(): TaskCostAdapterCapabilities;
  /** Read the session's current ledger. Must be idempotent and never throw on missing telemetry. */
  pollLedger(input: TaskCostPollInput): TaskCostLedgerV1;
  /** Summarize one task. Implementations should delegate to `aggregateTaskCost`. */
  summarizeTask(input: TaskCostSummarizeInput): TaskCostSummaryV1;
}
