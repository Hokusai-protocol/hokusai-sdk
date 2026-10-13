/**
 * Pure, deterministic `TaskCostReport` assembly: validated contract
 * summaries + per-model totals in, camelCase report out. No I/O, no clock.
 *
 * Combination rules mirror the reducer's:
 *
 * - resolved totals are null-propagating ("never an undercount"): a `null`
 *   component nulls the combined total;
 * - `actual`/`estimated` are lower-bound sums (a `null` operand contributes
 *   nothing), rounded at nano-USD like the reducer;
 * - coverage / cost-source / basis / pricing-source promotion reimplements
 *   the reducer's promotion rules (they are internal to `@hokusai/core`);
 *   any drift fails the parity tests loudly.
 *
 * @module measure/report
 */

import {
  MODEL_PRICING_AS_OF,
  TASK_COST_DIAGNOSTIC_CODES,
  TASK_COST_PRICE_TABLES,
  type TaskCostBasis,
  type TaskCostCoverage,
  type TaskCostEventV1,
  type TaskCostHarness,
  type TaskCostModelTotal,
  type TaskCostPriceTable,
  type TaskCostPricingSource,
  type TaskCostSource,
  type TaskCostSummaryV1,
} from '@hokusai/core';
import type { TaskCostSourceDiagnostics } from '../sources/types.js';
import { emptyUsage, toCamelUsage } from './usage.js';
import type {
  TaskCostBreakdown,
  TaskCostCaptureKind,
  TaskCostReport,
  TaskCostReportDiagnostic,
  TaskCostReportDiagnosticCode,
  TaskCostReportDiagnosticLevel,
  TaskCostUsage,
} from './types.js';

/** One engine's snapshot plus the events its summary covers. */
export interface EngineSnapshot {
  summary: TaskCostSummaryV1;
  modelTotals: readonly TaskCostModelTotal[];
  /** All accepted events of the engine (contributing ones are selected via `summary.event_ids`). */
  events: readonly TaskCostEventV1[];
}

export interface BuildTaskCostReportInput {
  taskId: string;
  engines: readonly EngineSnapshot[];
  /** Tracker-level diagnostic counts (`invalid_usage`, `duplicate_event`, …). */
  trackerDiagnostics: Partial<Record<TaskCostReportDiagnosticCode, number>>;
  /** Count-only diagnostics accumulated from session-file collection. */
  sourceDiagnostics: TaskCostSourceDiagnostics;
  capture: readonly TaskCostCaptureKind[];
  sessionFileCount: number;
  overrideCount: number;
}

// ────────────────────────────────────────────────────────────────
// Nullable money/usage arithmetic (nano-USD deterministic)
// ────────────────────────────────────────────────────────────────

function roundNanoUsd(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** Lower-bound sum: `null` operands contribute nothing; all-null stays null. */
function sumLowerUsd(values: readonly (number | null)[]): number | null {
  let sum: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    sum = roundNanoUsd((sum ?? 0) + value);
  }
  return sum;
}

/** Strict sum: `null` unless the list is non-empty and fully resolved. */
function sumStrictUsd(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null))
    return null;
  return roundNanoUsd(
    values.reduce<number>((sum, value) => sum + (value as number), 0),
  );
}

function addNullableCount(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function addUsage(a: TaskCostUsage, b: TaskCostUsage): TaskCostUsage {
  return {
    inputTokens: addNullableCount(a.inputTokens, b.inputTokens),
    outputTokens: addNullableCount(a.outputTokens, b.outputTokens),
    cacheReadTokens: addNullableCount(a.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: addNullableCount(a.cacheWriteTokens, b.cacheWriteTokens),
    reasoningTokens: addNullableCount(a.reasoningTokens, b.reasoningTokens),
  };
}

// ────────────────────────────────────────────────────────────────
// Promotion rules (mirror the reducer's internal helpers)
// ────────────────────────────────────────────────────────────────

function promoteCostSource(sources: readonly TaskCostSource[]): TaskCostSource {
  const hasProvider = sources.some(
    (s) => s === 'provider_reported' || s === 'mixed',
  );
  const hasEstimate = sources.some(
    (s) => s === 'local_estimate' || s === 'mixed',
  );
  if (hasProvider && hasEstimate) return 'mixed';
  if (hasProvider) return 'provider_reported';
  if (hasEstimate) return 'local_estimate';
  return 'none';
}

function promoteCoverage(
  coverages: readonly TaskCostCoverage[],
): TaskCostCoverage {
  if (coverages.length === 0) return 'unavailable';
  if (coverages.every((c) => c === 'unavailable')) return 'unavailable';
  if (coverages.every((c) => c === 'known_zero')) return 'known_zero';
  if (coverages.every((c) => c === 'complete' || c === 'known_zero'))
    return 'complete';
  return 'partial';
}

function promoteBasis(bases: readonly TaskCostBasis[]): TaskCostBasis {
  const [first, ...rest] = bases;
  return first !== undefined && rest.every((basis) => basis === first)
    ? first
    : 'unknown';
}

function promotePricingSource(
  sources: readonly TaskCostPricingSource[],
): TaskCostPricingSource {
  const [first, ...rest] = [...new Set(sources.filter((s) => s !== 'none'))];
  if (first === undefined) return 'none';
  return rest.length === 0 ? first : 'mixed';
}

// ────────────────────────────────────────────────────────────────
// Breakdowns
// ────────────────────────────────────────────────────────────────

function mergeBreakdown(
  a: TaskCostBreakdown,
  b: TaskCostBreakdown,
): TaskCostBreakdown {
  return {
    totalUsd: sumStrictUsd([a.totalUsd, b.totalUsd]),
    actualUsd: sumLowerUsd([a.actualUsd, b.actualUsd]),
    estimatedUsd: sumLowerUsd([a.estimatedUsd, b.estimatedUsd]),
    usage: addUsage(a.usage, b.usage),
    eventCount: a.eventCount + b.eventCount,
    turnCount: a.turnCount + b.turnCount,
    costSource: promoteCostSource([a.costSource, b.costSource]),
    coverage: promoteCoverage([a.coverage, b.coverage]),
  };
}

function breakdownFromModelTotal(total: TaskCostModelTotal): TaskCostBreakdown {
  return {
    totalUsd: total.total_cost_usd,
    actualUsd: total.actual_cost_usd,
    estimatedUsd: total.estimated_cost_usd,
    usage: toCamelUsage(total.usage),
    eventCount: total.event_count,
    turnCount: total.turn_count,
    costSource: total.cost_source,
    coverage: total.coverage,
  };
}

function breakdownFromSummary(summary: TaskCostSummaryV1): TaskCostBreakdown {
  return {
    totalUsd: summary.total_cost_usd,
    actualUsd: summary.actual_cost_usd,
    estimatedUsd: summary.estimated_cost_usd,
    usage: toCamelUsage(summary.usage),
    eventCount: summary.event_count,
    turnCount: summary.turn_count,
    costSource: summary.cost_source,
    coverage: summary.coverage,
  };
}

// ────────────────────────────────────────────────────────────────
// Diagnostics
// ────────────────────────────────────────────────────────────────

/**
 * Source codes that are renamed for the report; everything else passes
 * through under its own name.
 */
const SOURCE_CODE_RENAMES: Partial<
  Record<keyof TaskCostSourceDiagnostics, TaskCostReportDiagnosticCode>
> = {
  unreadable_file: 'session_file_unreadable',
  malformed_line: 'malformed_record',
  invalid_record: 'malformed_record',
};

const DIAGNOSTIC_LEVELS: Partial<
  Record<TaskCostReportDiagnosticCode, TaskCostReportDiagnosticLevel>
> = {
  provider_reported_cost: 'info',
  replay_dropped: 'info',
  subscription_basis_no_charge: 'info',
  duplicate_event: 'info',
  duplicate_row: 'info',
  outside_time_window: 'info',
  session_not_in_boundary: 'info',
  foreign_task: 'info',
  collection_failed: 'error',
  aggregation_failed: 'error',
  ledger_flush_failed: 'error',
};

const DIAGNOSTIC_MESSAGES: Record<TaskCostReportDiagnosticCode, string> = {
  // Contract (summary) codes, passed through.
  missing_token_usage: 'an event lacks input/output token counts',
  invalid_token_usage: 'source usage was unparseable, negative, or non-finite',
  unpriced_model:
    'usage was complete enough to price but no price was available',
  mixed_coverage: 'coverage is partial: some events are missing cost or usage',
  provider_reported_cost:
    'at least one event carries a provider-reported charge',
  no_pricing_data: 'no price was available for the reported usage shape',
  no_priced_sessions: 'events exist but none produced a cost',
  stale_pricing_revision:
    'events were priced against more than one pricing revision',
  replay_dropped: 'an event repeating a prior event_id was ignored',
  cumulative_backward_jump:
    'a cumulative snapshot regressed and its delta was clamped',
  subscription_basis_no_charge:
    'subscription-basis usage carries no actual charge',
  // Source (count-only) codes, passed through.
  oversized_line: 'a session-file line exceeded the parser length bound',
  truncated_input: 'a session file had more lines than the parser bound',
  missing_session_id: 'a usage row carried no resolvable session id',
  session_not_in_boundary:
    'rows from sessions outside the task boundary were dropped',
  foreign_task: 'records naming a different task were dropped',
  missing_timestamp: 'a usage row carried no parseable timestamp',
  outside_time_window: 'rows outside the task time window were dropped',
  missing_usage: 'a row that should carry usage carried none',
  invalid_usage_value:
    'a present usage or cost field was malformed and treated as missing',
  duplicate_row: 'a source row repeated an already-seen identity',
  cumulative_counter_reset:
    'a cumulative counter regressed; the baseline was reset',
  // Mapped / tracker-level codes.
  malformed_line: 'a session-file line was malformed and skipped',
  invalid_record: 'a record was not a usable record shape',
  unreadable_file: 'a file or directory could not be read',
  oversized_file: 'a session file exceeded the size bound and was skipped',
  invalid_usage: 'a usage record was rejected; totals are unchanged',
  no_usage_captured:
    'automatic capture requires supported usage events or session files; call tracker.recordUsage() otherwise',
  session_file_unreadable:
    'a session file could not be read or exceeded the size bound',
  malformed_record: 'a session-file line or record was malformed and skipped',
  duplicate_event:
    'an event id was recorded more than once; later copies were ignored',
  collection_failed: 'a usage source failed while collecting events',
  aggregation_failed: 'an engine could not summarize its events',
  ledger_flush_failed: 'persisting to the opt-in ledger failed',
};

/** Canonical report order: contract codes, source passthrough, tracker codes. */
const DIAGNOSTIC_ORDER: readonly TaskCostReportDiagnosticCode[] = [
  ...TASK_COST_DIAGNOSTIC_CODES,
  'oversized_line',
  'truncated_input',
  'missing_session_id',
  'session_not_in_boundary',
  'foreign_task',
  'missing_timestamp',
  'outside_time_window',
  'missing_usage',
  'invalid_usage_value',
  'duplicate_row',
  'cumulative_counter_reset',
  'oversized_file',
  'invalid_usage',
  'duplicate_event',
  'session_file_unreadable',
  'malformed_record',
  'no_usage_captured',
  'collection_failed',
  'aggregation_failed',
  'ledger_flush_failed',
];

// ────────────────────────────────────────────────────────────────
// The builder
// ────────────────────────────────────────────────────────────────

/** Build the camelCase report. Pure and deterministic; no I/O, no clock. */
export function buildTaskCostReport(
  input: BuildTaskCostReportInput,
): TaskCostReport {
  const summaries = input.engines.map((engine) => engine.summary);

  // Contributing events only (superseded/duplicate events are excluded by
  // each summary's event_ids).
  const contributing: TaskCostEventV1[] = [];
  for (const engine of input.engines) {
    const ids = new Set(engine.summary.event_ids);
    for (const event of engine.events) {
      if (ids.has(event.event_id)) contributing.push(event);
    }
  }

  // byModel: merge per-engine model totals by model id, first-seen order.
  const byModel: Record<string, TaskCostBreakdown> = {};
  for (const engine of input.engines) {
    for (const total of engine.modelTotals) {
      const next = breakdownFromModelTotal(total);
      const existing = byModel[total.model];
      byModel[total.model] =
        existing === undefined ? next : mergeBreakdown(existing, next);
    }
  }

  // byHarness: merge summaries sharing a harness (e.g. two provider contracts).
  const byHarness: Partial<Record<TaskCostHarness, TaskCostBreakdown>> = {};
  for (const summary of summaries) {
    const next = breakdownFromSummary(summary);
    const existing = byHarness[summary.harness];
    byHarness[summary.harness] =
      existing === undefined ? next : mergeBreakdown(existing, next);
  }

  const usage = summaries
    .map((summary) => toCamelUsage(summary.usage))
    .reduce(addUsage, emptyUsage());

  // Pricing provenance, from contributing events.
  const revisions = [
    ...new Set(
      contributing.flatMap((event) =>
        event.pricing_revision !== undefined ? [event.pricing_revision] : [],
      ),
    ),
  ].sort();
  const usedTables = new Set(
    contributing.flatMap((event) =>
      event.price_table !== undefined ? [event.price_table] : [],
    ),
  );
  const priceTables: TaskCostPriceTable[] = TASK_COST_PRICE_TABLES.filter(
    (table) => usedTables.has(table),
  );

  // Coverage accounting. "Priced" = the event resolved a cost; "unknown
  // model" = usage was observed but no cost evidence of any kind exists.
  const pricedEvents = contributing.filter(
    (event) => event.cost_source !== 'none',
  ).length;
  const unpricedWithUsage = contributing.filter(
    (event) =>
      event.cost_source === 'none' && event.usage_coverage !== 'unavailable',
  );
  const unknownModels = [
    ...new Set(unpricedWithUsage.map((event) => event.observed_model)),
  ];

  // Diagnostics: merge counts from the summaries, the tracker, and the
  // session-file sources, then emit in canonical order.
  const counts = new Map<TaskCostReportDiagnosticCode, number>();
  const bump = (code: TaskCostReportDiagnosticCode, by: number): void => {
    if (by > 0) counts.set(code, (counts.get(code) ?? 0) + by);
  };
  for (const summary of summaries) {
    for (const code of summary.diagnostics) {
      // unpriced_model counts unpriced events, not summaries carrying the code.
      if (code === 'unpriced_model') continue;
      bump(code, 1);
    }
  }
  // Count unpriced-with-usage events; fall back to 1 if only the reducer
  // (which sees post-reconciliation observations) flagged it.
  const summariesFlagUnpriced = summaries.some((summary) =>
    summary.diagnostics.includes('unpriced_model'),
  );
  bump(
    'unpriced_model',
    unpricedWithUsage.length > 0
      ? unpricedWithUsage.length
      : summariesFlagUnpriced
        ? 1
        : 0,
  );
  for (const [code, count] of Object.entries(input.trackerDiagnostics) as [
    TaskCostReportDiagnosticCode,
    number,
  ][]) {
    bump(code, count ?? 0);
  }
  for (const [rawCode, count] of Object.entries(input.sourceDiagnostics) as [
    keyof TaskCostSourceDiagnostics,
    number,
  ][]) {
    bump(SOURCE_CODE_RENAMES[rawCode] ?? rawCode, count ?? 0);
  }

  const eventCount = summaries.reduce(
    (sum, summary) => sum + summary.event_count,
    0,
  );
  if (eventCount === 0) bump('no_usage_captured', 1);

  const diagnostics: TaskCostReportDiagnostic[] = DIAGNOSTIC_ORDER.flatMap(
    (code) => {
      const count = counts.get(code);
      if (count === undefined) return [];
      return [
        {
          code,
          level: DIAGNOSTIC_LEVELS[code] ?? 'warn',
          message: DIAGNOSTIC_MESSAGES[code],
          count,
        },
      ];
    },
  );

  const revision = revisions.at(-1) ?? null;

  return {
    taskId: input.taskId,
    totalUsd: sumStrictUsd(summaries.map((summary) => summary.total_cost_usd)),
    actualUsd: sumLowerUsd(summaries.map((summary) => summary.actual_cost_usd)),
    estimatedUsd: sumLowerUsd(
      summaries.map((summary) => summary.estimated_cost_usd),
    ),
    byModel,
    byHarness,
    usage,
    eventCount,
    turnCount: summaries.reduce((sum, summary) => sum + summary.turn_count, 0),
    source: {
      cost: promoteCostSource(summaries.map((summary) => summary.cost_source)),
      basis: promoteBasis(summaries.map((summary) => summary.cost_basis)),
      capture: [...input.capture],
      sessionFileCount: input.sessionFileCount,
    },
    pricing: {
      source: promotePricingSource(
        summaries.map((summary) => summary.pricing_source),
      ),
      revision,
      effectiveDate: revision ?? MODEL_PRICING_AS_OF,
      revisions,
      priceTables,
      builtInTableAsOf: MODEL_PRICING_AS_OF,
      overrideCount: input.overrideCount,
      currency: 'USD',
    },
    coverage: {
      status: promoteCoverage(summaries.map((summary) => summary.coverage)),
      pricedEvents,
      unpricedEvents: contributing.length - pricedEvents,
      unknownModels,
    },
    diagnostics,
    summaries,
  };
}

/** Exposed for the contract-vocabulary docs/tests. */
export { DIAGNOSTIC_ORDER as TASK_COST_REPORT_DIAGNOSTIC_ORDER };
