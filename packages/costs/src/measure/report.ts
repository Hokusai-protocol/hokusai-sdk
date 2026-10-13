/**
 * Pure presentation-report builder: priced contract events in, camelCase
 * `TaskCostReport` out. Deterministic, no I/O, no price math — every figure
 * is a sum of what `createTaskCostEngine` already resolved per event.
 *
 * `totalUsd` semantics (deliberate, see `measure/types.ts`): each event
 * resolves to `actual_cost_usd ?? estimated_cost_usd`; the total sums the
 * resolved events and is `null` only when zero events resolved. Under
 * partial coverage this is a lower bound — unlike the contract summary's
 * `total_cost_usd`, which is `null` on any gap.
 *
 * @module measure/report
 */

import {
  MODEL_PRICING_AS_OF,
  TASK_COST_TOKEN_FIELDS,
  type TaskCostEventV1,
  type TaskCostTokenUsage,
} from '@hokusai/core';
import {
  emptyUsage,
  type CostAttributionEntry,
  type CostDiagnostic,
  type TaskCostReport,
  type TokenUsage,
} from './types.js';

/** camelCase field for each contract usage counter. */
const USAGE_FIELD_MAP = {
  input_tokens: 'input',
  output_tokens: 'output',
  cache_read_tokens: 'cacheRead',
  cache_write_tokens: 'cacheWrite',
  reasoning_tokens: 'reasoning',
} as const satisfies Record<keyof TaskCostTokenUsage, keyof TokenUsage>;

/**
 * Null-preserving sum (the contract's `addNullable` rule, which `@hokusai/core`
 * keeps internal): `null` only when both operands are `null`.
 */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/** Accumulate one event's usage into a camelCase total, in place. */
function addUsage(total: TokenUsage, usage: TaskCostTokenUsage): void {
  for (const field of TASK_COST_TOKEN_FIELDS) {
    const camel = USAGE_FIELD_MAP[field];
    total[camel] = addNullable(total[camel], usage[field]);
  }
}

/** The cost an event resolves to: provider-reported charge, else estimate. */
function resolvedCostUsd(event: TaskCostEventV1): number | null {
  return event.actual_cost_usd !== null
    ? event.actual_cost_usd
    : event.estimated_cost_usd;
}

export interface BuildReportMeta {
  taskId: string;
  sourceKind: TaskCostReport['source']['kind'];
  /**
   * Caller-facing harness label for `source.harness`. When absent it is
   * derived from the events' labels (one distinct label, else `'mixed'`,
   * else `'unknown'`).
   */
  sourceHarness?: string;
  /** Caller-supplied session file paths, verbatim. */
  files?: readonly string[];
  /** Original caller labels by `event_id` (non-enum labels map to `'unknown'` on the event). */
  harnessLabels?: ReadonlyMap<string, string>;
  /** Pre-mapped measure diagnostics (source/engine/file problems). */
  diagnostics?: readonly CostDiagnostic[];
}

/**
 * Build the camelCase report from priced contract events. Appends
 * `NO_USAGE_CAPTURED` / `UNPRICED_MODEL` diagnostics of its own; everything
 * else arrives pre-mapped via `meta.diagnostics`.
 */
export function buildTaskCostReport(
  events: readonly TaskCostEventV1[],
  meta: BuildReportMeta,
): TaskCostReport {
  const diagnostics: CostDiagnostic[] = [...(meta.diagnostics ?? [])];
  const usage = emptyUsage();
  const byModel: Record<string, CostAttributionEntry> = {};
  const byHarness: Record<string, CostAttributionEntry> = {};
  const harnessLabelsSeen: string[] = [];
  const unknownModels: string[] = [];
  const priceTables: string[] = [];
  const pricingRevisions: string[] = [];

  let totalUsd: number | null = null;
  let pricedRecords = 0;
  let unpricedRecords = 0;
  let usageGap = false;

  for (const event of events) {
    const resolved = resolvedCostUsd(event);
    if (resolved !== null) {
      pricedRecords += 1;
      totalUsd = (totalUsd ?? 0) + resolved;
    } else {
      unpricedRecords += 1;
      if (!unknownModels.includes(event.observed_model)) {
        unknownModels.push(event.observed_model);
      }
    }
    if (
      event.usage_coverage === 'partial' ||
      event.usage_coverage === 'unavailable'
    ) {
      usageGap = true;
    }

    addUsage(usage, event.usage);

    const model = event.observed_model;
    const modelEntry = (byModel[model] ??= { usd: null, usage: emptyUsage() });
    modelEntry.usd = addNullable(modelEntry.usd, resolved);
    addUsage(modelEntry.usage, event.usage);

    const label = meta.harnessLabels?.get(event.event_id) ?? event.harness;
    if (!harnessLabelsSeen.includes(label)) harnessLabelsSeen.push(label);
    const harnessEntry = (byHarness[label] ??= {
      usd: null,
      usage: emptyUsage(),
    });
    harnessEntry.usd = addNullable(harnessEntry.usd, resolved);
    addUsage(harnessEntry.usage, event.usage);

    if (event.estimated_cost_usd !== null) {
      if (
        event.price_table !== undefined &&
        !priceTables.includes(event.price_table)
      ) {
        priceTables.push(event.price_table);
      }
      if (
        event.pricing_revision !== undefined &&
        !pricingRevisions.includes(event.pricing_revision)
      ) {
        pricingRevisions.push(event.pricing_revision);
      }
    }
  }

  if (events.length === 0) {
    diagnostics.push({
      code: 'NO_USAGE_CAPTURED',
      level: 'warn',
      message:
        'no usage was captured for this task; supply usage events or session files, or record usage manually via the tracker',
    });
  }
  for (const model of unknownModels) {
    diagnostics.push({
      code: 'UNPRICED_MODEL',
      level: 'warn',
      message: `model "${model}" has no price in the built-in table or host overrides; its records are counted but unpriced`,
    });
  }

  const status: TaskCostReport['coverage']['status'] =
    pricedRecords === 0
      ? 'none'
      : unpricedRecords > 0 || usageGap
        ? 'partial'
        : 'complete';

  const effectiveDate = pricingRevisions[0] ?? MODEL_PRICING_AS_OF;
  const snapshotId = `${priceTables.join('+') || 'none'}@${
    pricingRevisions.join('+') || effectiveDate
  }`;

  const sourceHarness =
    meta.sourceHarness ??
    (harnessLabelsSeen.length > 1 ? 'mixed' : (harnessLabelsSeen[0] ?? 'unknown'));

  return {
    taskId: meta.taskId,
    totalUsd,
    byModel,
    byHarness,
    usage,
    source: {
      kind: meta.sourceKind,
      harness: sourceHarness,
      ...(meta.files !== undefined ? { files: [...meta.files] } : {}),
    },
    pricing: { snapshotId, effectiveDate, currency: 'USD' },
    coverage: {
      status,
      pricedRecords,
      unpricedRecords,
      unknownModels,
    },
    diagnostics,
  };
}
