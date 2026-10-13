/**
 * Manual usage tracker: `record`/`recordUsage` friendly camelCase events in,
 * a `TaskCostReport` out at any time.
 *
 * The tracker is a façade over `createTaskCostEngine`: it generates
 * contract-safe identities (`eventId`/`sessionId`/`turnId`/`sequence`/
 * `observedAt`) for records that do not carry them, maps arbitrary harness
 * labels onto the closed contract enum (retaining the original label for
 * `byHarness` grouping), and converts camelCase usage to the contract's
 * snake_case counters. No pricing or aggregation is re-implemented.
 *
 * Error discipline (D6): non-object/shape-less input is a programmer error
 * and throws `MeasureError('INVALID_ARGUMENT')`; data problems (negative
 * counters, engine rejections) never throw — they add a diagnostic and leave
 * totals unchanged.
 *
 * @module measure/tracker
 */

import {
  TASK_COST_HARNESSES,
  type TaskCostHarness,
  type TaskCostTokenUsage,
} from '@hokusai/core';
import {
  createTaskCostEngine,
  type IngestResult,
  type TaskCostEngine,
} from '../engine.js';
import { buildTaskCostReport } from './report.js';
import {
  MeasureError,
  TOKEN_USAGE_FIELDS,
  type CostDiagnostic,
  type RecordUsageInput,
  type TaskCostReport,
  type TaskCostTracker,
  type TaskCostTrackerOptions,
  type TokenUsage,
  type TrackerRecordInput,
} from './types.js';

/** Contract version stamped on tracker-generated events. */
export const MEASURE_PROVIDER_CONTRACT_VERSION = 'measure/1';

/** Same identifier rule the contract validator enforces. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Whether a value is a contract-safe identifier. */
export function isContractSafeId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

let generatedTaskCounter = 0;

/** Generate a contract-safe task id unique enough for in-process use. */
export function generateTaskId(now: () => Date): string {
  generatedTaskCounter += 1;
  return `task-${now().getTime().toString(36)}-${generatedTaskCounter.toString(36)}`;
}

/** Map an arbitrary caller label onto the closed contract harness enum. */
export function toContractHarness(label: string): TaskCostHarness {
  return (TASK_COST_HARNESSES as readonly string[]).includes(label)
    ? (label as TaskCostHarness)
    : 'unknown';
}

/** Convert partial camelCase usage to the contract's snake_case counters. */
function toContractUsage(usage: Partial<TokenUsage>): Partial<TaskCostTokenUsage> {
  return {
    input_tokens: usage.input ?? null,
    output_tokens: usage.output ?? null,
    cache_read_tokens: usage.cacheRead ?? null,
    cache_write_tokens: usage.cacheWrite ?? null,
    reasoning_tokens: usage.reasoning ?? null,
  };
}

/**
 * Internal tracker state shared with `measureTask`, which ingests
 * adapter-collected events into the same engine and reads the same
 * diagnostics/label map when it builds the final report.
 */
export interface TrackerCore {
  tracker: TaskCostTracker;
  engine(): TaskCostEngine;
  /** `event_id` → original caller harness label (non-enum labels only). */
  harnessLabels(): Map<string, string>;
  diagnostics(): CostDiagnostic[];
  addDiagnostic(diagnostic: CostDiagnostic): void;
  /** Record an engine ingest result produced outside the tracker. */
  noteIngestResult(result: IngestResult, originalLabel?: string): void;
}

export function createTrackerCore(
  options: TaskCostTrackerOptions = {},
): TrackerCore {
  if (typeof options !== 'object' || options === null) {
    throw new MeasureError(
      'INVALID_ARGUMENT',
      'tracker options must be an object',
    );
  }
  const now = options.now ?? ((): Date => new Date());
  if (typeof now !== 'function') {
    throw new MeasureError('INVALID_ARGUMENT', 'options.now must be a function');
  }
  if (options.taskId !== undefined && !isContractSafeId(options.taskId)) {
    throw new MeasureError(
      'INVALID_ARGUMENT',
      'options.taskId must be a contract-safe identifier (letters, digits, ".", "_", ":", "-")',
    );
  }
  const taskId = options.taskId ?? generateTaskId(now);
  const defaultLabel =
    typeof options.harness === 'string' && options.harness.length > 0
      ? options.harness
      : 'unknown';

  const makeEngine = (): TaskCostEngine =>
    createTaskCostEngine({
      taskId,
      ...(options.priceOverrides !== undefined
        ? { priceOverrides: options.priceOverrides }
        : {}),
      ...(options.pricingRevision !== undefined
        ? { pricingRevision: options.pricingRevision }
        : {}),
    });

  let engine = makeEngine();
  let labels = new Map<string, string>();
  let diagnostics: CostDiagnostic[] = [];
  let eventCounter = 0;
  let rejectedCounter = 0;

  function addDiagnostic(diagnostic: CostDiagnostic): void {
    diagnostics.push(diagnostic);
  }

  function noteIngestResult(result: IngestResult, originalLabel?: string): void {
    if (result.status === 'accepted') {
      if (
        originalLabel !== undefined &&
        toContractHarness(originalLabel) !== originalLabel
      ) {
        labels.set(result.event.event_id, originalLabel);
      }
      return;
    }
    if (result.status === 'duplicate') return;
    rejectedCounter += 1;
    addDiagnostic({
      code: 'INVALID_USAGE',
      level: 'warn',
      message: `record ${String(rejectedCounter)} was rejected at ingest (usage counters must be non-negative integers and identities contract-safe); totals are unchanged`,
    });
  }

  function record(event: TrackerRecordInput): void {
    if (typeof event !== 'object' || event === null) {
      throw new MeasureError(
        'INVALID_ARGUMENT',
        'record() requires a usage event object',
      );
    }
    if (typeof event.model !== 'string' || event.model.length === 0) {
      throw new MeasureError(
        'INVALID_ARGUMENT',
        'record() requires a non-empty string "model"',
      );
    }
    const usageInput = event.usage ?? {};
    if (typeof usageInput !== 'object' || usageInput === null) {
      throw new MeasureError(
        'INVALID_ARGUMENT',
        'record() "usage" must be an object when present',
      );
    }
    // Unknown usage keys are a caller bug worth failing fast on — a typo'd
    // counter would otherwise be silently dropped as "not reported".
    for (const key of Object.keys(usageInput)) {
      if (!(TOKEN_USAGE_FIELDS as readonly string[]).includes(key)) {
        throw new MeasureError(
          'INVALID_ARGUMENT',
          `record() "usage.${key}" is not a usage counter (expected ${TOKEN_USAGE_FIELDS.join(', ')})`,
        );
      }
    }

    eventCounter += 1;
    const label =
      typeof event.harness === 'string' && event.harness.length > 0
        ? event.harness
        : defaultLabel;
    const observedAt =
      event.observedAt instanceof Date
        ? event.observedAt.toISOString()
        : typeof event.observedAt === 'string'
          ? event.observedAt
          : now().toISOString();

    const result = engine.ingest({
      eventId: event.eventId ?? `evt-${String(eventCounter)}`,
      taskId,
      sessionId: event.sessionId ?? 'manual',
      turnId: event.turnId ?? `turn-${String(eventCounter)}`,
      sequence: eventCounter,
      harness: toContractHarness(label),
      providerContractVersion: MEASURE_PROVIDER_CONTRACT_VERSION,
      observedModel: event.model,
      usage: toContractUsage(usageInput),
      ...(event.actualCostUsd !== undefined
        ? { actualCostUsd: event.actualCostUsd }
        : {}),
      ...(event.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: event.estimatedCostUsd }
        : {}),
      observedAt,
    });
    noteIngestResult(result, label);
  }

  const tracker: TaskCostTracker = {
    taskId,
    record,
    recordUsage(input: RecordUsageInput): void {
      record(input);
    },
    summary(): TaskCostReport {
      return buildTaskCostReport(engine.events(), {
        taskId,
        sourceKind: 'manual',
        ...(options.harness !== undefined
          ? { sourceHarness: options.harness }
          : {}),
        harnessLabels: labels,
        diagnostics,
      });
    },
    reset(): void {
      engine = makeEngine();
      labels = new Map();
      diagnostics = [];
      eventCounter = 0;
      rejectedCounter = 0;
    },
  };

  return {
    tracker,
    engine: () => engine,
    harnessLabels: () => labels,
    diagnostics: () => diagnostics,
    addDiagnostic,
    noteIngestResult,
  };
}

/**
 * Create a standalone manual tracker. See {@link TaskCostTracker}.
 *
 * Harness labels outside the contract enum (for example `'custom'`) are
 * retained for `byHarness`/`source.harness` display and mapped to
 * `'unknown'` on the underlying contract events.
 */
export function createTaskCostTracker(
  options: TaskCostTrackerOptions = {},
): TaskCostTracker {
  return createTrackerCore(options).tracker;
}
