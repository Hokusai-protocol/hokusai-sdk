/**
 * `@hokusai/costs` — provider-neutral task cost engine.
 *
 * Accepts usage events for a task and returns cost/token totals with
 * attribution and coverage. Measurement works without Hokusai credentials or
 * network access. The wire contract (event/ledger/summary schemas, validators,
 * and the reference reducer) lives in `@hokusai/core`; this package adds the
 * stateful ingest + pricing engine on top.
 *
 * @module @hokusai/costs
 */

export {
  createTaskCostEngine,
  type CreateTaskCostEngineOptions,
  type IngestResult,
  type IngestUsageInput,
  type TaskCostEngine,
} from './engine.js';

export {
  resolveEventPrice,
  type EventPricingContext,
  type EventPricingRequest,
  type HostPriceOverride,
  type ResolvedEventPricing,
} from './pricing-resolver.js';
