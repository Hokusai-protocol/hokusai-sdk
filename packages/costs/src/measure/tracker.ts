/**
 * `createTaskCostTracker` — the record/summary surface for hosts that are not
 * wrapping a run in `measureTask`.
 *
 * The tracker runs one `TaskCostEngine` per `(harness, providerContractVersion)`
 * pair — the contract's one-summary scope — and combines the resulting
 * summaries into a single `TaskCostReport` (that is where `byHarness` comes
 * from). Event ids dedupe *across* engines, so a retried record counts once no
 * matter which harness re-emitted it.
 *
 * Error policy: bad data is rejected (`{ status: 'rejected' }` plus an
 * `invalid_usage` diagnostic) and never throws; only programmer errors throw
 * `TaskCostMeasureError`. `summary()` never throws — an empty tracker returns
 * a well-formed `unavailable` report, and an engine whose events cannot be
 * summarized (a replay cycle) degrades to an `aggregation_failed` diagnostic.
 *
 * @module measure/tracker
 */

import {
  PROVIDER_CONTRACT_VERSIONS,
  TASK_COST_BASES,
  TASK_COST_EVENT_SCHEMA_VERSION,
  TASK_COST_HARNESSES,
  TaskCostValidationError,
  aggregateTaskCostByModel,
  type TaskCostEventV1,
  type TaskCostHarness,
} from '@hokusai/core';
import { createTaskCostEngine, type IngestUsageInput, type TaskCostEngine } from '../engine.js';
import { toLedgerEntries } from '../ledger/from-events.js';
import { buildOverrideIndex } from '../pricing-resolver.js';
import { countDiagnostic, type TaskCostSourceDiagnostics } from '../sources/types.js';
import { TaskCostMeasureError } from './errors.js';
import { buildTaskCostReport, type EngineSnapshot } from './report.js';
import {
  TASK_COST_CAPTURE_KINDS,
  type LedgerFlushResult,
  type RecordResult,
  type TaskCostCaptureKind,
  type TaskCostReport,
  type TaskCostReportDiagnosticCode,
  type TaskCostTracker,
  type TaskCostTrackerOptions,
  type TaskUsageRecord,
} from './types.js';
import { projectIngestInput, projectPrebuiltEvent, projectUsageRecord, toContractUsage } from './usage.js';

/**
 * Mirrors the contract validators' (unexported) patterns; drift fails loudly
 * at ingest, never silently.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_CONTRACT_PATTERN = /^[a-z][a-z0-9-]{0,31}\/[0-9]{1,4}$/;

let generatedTaskCount = 0;

/** Non-narrowing object check (keeps the declared type of typed params). */
function notAnObject(value: unknown): boolean {
  return typeof value !== 'object' || value === null || Array.isArray(value);
}

/**
 * The contract's registered parsing-contract version for a harness, else a
 * pattern-safe `<harness>/1`. (The contract pattern requires a numeric
 * version segment, so something like `unknown/sdk` would be rejected.)
 */
function defaultProviderContract(harness: TaskCostHarness): string {
  return (
    (PROVIDER_CONTRACT_VERSIONS as Partial<Record<TaskCostHarness, string>>)[harness] ??
    `${harness}/1`
  );
}

/** Internal recording surface used by `measureTask`'s capture plumbing. */
export interface TrackerInternals {
  recordUsageVia(kind: TaskCostCaptureKind, record: TaskUsageRecord): RecordResult;
  recordVia(
    kind: TaskCostCaptureKind,
    input: IngestUsageInput | TaskCostEventV1,
  ): RecordResult;
  addSourceDiagnostics(diagnostics: TaskCostSourceDiagnostics): void;
  addSessionFiles(count: number): void;
  bumpDiagnostic(code: TaskCostReportDiagnosticCode, by?: number): void;
}

export function createTrackerWithInternals(options: TaskCostTrackerOptions = {}): {
  tracker: TaskCostTracker;
  internals: TrackerInternals;
} {
  if (notAnObject(options)) {
    throw new TaskCostMeasureError('tracker options must be an object');
  }
  const taskId = options.taskId ?? `task-${++generatedTaskCount}`;
  if (typeof taskId !== 'string' || !ID_PATTERN.test(taskId)) {
    throw new TaskCostMeasureError(
      `taskId must match the contract id pattern ${ID_PATTERN}`,
    );
  }
  const defaultHarness = options.harness ?? 'unknown';
  if (!(TASK_COST_HARNESSES as readonly string[]).includes(defaultHarness)) {
    throw new TaskCostMeasureError(
      `harness must be one of: ${TASK_COST_HARNESSES.join(', ')}`,
    );
  }
  const defaultContract =
    options.providerContractVersion ?? defaultProviderContract(defaultHarness);
  if (
    typeof defaultContract !== 'string' ||
    !PROVIDER_CONTRACT_PATTERN.test(defaultContract)
  ) {
    throw new TaskCostMeasureError(
      `providerContractVersion must match ${PROVIDER_CONTRACT_PATTERN}`,
    );
  }
  const defaultBasis = options.costBasis ?? 'per_token_api';
  if (!(TASK_COST_BASES as readonly string[]).includes(defaultBasis)) {
    throw new TaskCostMeasureError(
      `costBasis must be one of: ${TASK_COST_BASES.join(', ')}`,
    );
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TaskCostMeasureError('now must be a function returning a Date');
  }
  const now = options.now ?? ((): Date => new Date());
  const overrides = options.priceOverrides ?? [];
  try {
    // Fail at construction, not mid-accounting (same rule as the engine).
    buildOverrideIndex(overrides);
  } catch (error) {
    throw new TaskCostMeasureError(
      error instanceof Error ? error.message : 'invalid price overrides',
    );
  }

  // ── Mutable tracker state (dropped wholesale by reset()) ────────────
  let engines = new Map<string, { engine: TaskCostEngine; harness: TaskCostHarness }>();
  let acceptedEvents: TaskCostEventV1[] = [];
  let seenEventIds = new Set<string>();
  let sequences = new Map<string, number>();
  let trackerDiagnostics = new Map<TaskCostReportDiagnosticCode, number>();
  let sourceDiagnostics: TaskCostSourceDiagnostics = {};
  let captureKinds = new Set<TaskCostCaptureKind>();
  let sessionFileCount = 0;
  let eventCounter = 0;
  let persistedCount = 0;

  function bumpDiagnostic(code: TaskCostReportDiagnosticCode, by = 1): void {
    trackerDiagnostics.set(code, (trackerDiagnostics.get(code) ?? 0) + by);
  }

  function engineFor(harness: TaskCostHarness, providerContract: string): TaskCostEngine {
    const key = `${harness}\u0000${providerContract}`;
    const existing = engines.get(key);
    if (existing !== undefined) return existing.engine;
    const engine = createTaskCostEngine({
      taskId,
      priceOverrides: overrides,
      ...(options.pricingRevision !== undefined
        ? { pricingRevision: options.pricingRevision }
        : {}),
    });
    engines.set(key, { engine, harness });
    return engine;
  }

  function nextSequence(harness: string, providerContract: string, sessionId: string): number {
    const key = `${harness}\u0000${providerContract}\u0000${sessionId}`;
    const next = (sequences.get(key) ?? 0) + 1;
    sequences.set(key, next);
    return next;
  }

  function ingestInto(
    kind: TaskCostCaptureKind,
    harness: TaskCostHarness,
    providerContract: string,
    input: IngestUsageInput | TaskCostEventV1,
    eventId: string,
  ): RecordResult {
    if (seenEventIds.has(eventId)) {
      bumpDiagnostic('duplicate_event');
      return { status: 'duplicate', eventId };
    }
    const result = engineFor(harness, providerContract).ingest(input);
    if (result.status === 'accepted') {
      acceptedEvents.push(result.event);
      seenEventIds.add(result.event.event_id);
      captureKinds.add(kind);
      return { status: 'accepted', eventId: result.event.event_id };
    }
    if (result.status === 'duplicate') {
      bumpDiagnostic('duplicate_event');
      return { status: 'duplicate', eventId: result.eventId };
    }
    bumpDiagnostic('invalid_usage');
    return { status: 'rejected', reason: result.reason };
  }

  function recordUsageVia(kind: TaskCostCaptureKind, record: TaskUsageRecord): RecordResult {
    if (notAnObject(record)) {
      throw new TaskCostMeasureError('recordUsage requires a usage record object');
    }
    const projected = projectUsageRecord(record as unknown as Record<string, unknown>);
    const harness = projected.harness ?? defaultHarness;
    if (!(TASK_COST_HARNESSES as readonly string[]).includes(harness)) {
      throw new TaskCostMeasureError(
        `harness must be one of: ${TASK_COST_HARNESSES.join(', ')}`,
      );
    }
    const providerContract =
      projected.harness !== undefined && projected.harness !== defaultHarness
        ? defaultProviderContract(harness)
        : defaultContract;
    let eventId = projected.eventId;
    if (eventId === undefined) {
      // Deterministic per-tracker ids; skip over any explicit id a caller
      // already used so a default can never collide into a false duplicate.
      do {
        eventCounter += 1;
        eventId = `${taskId}.e${eventCounter}`;
      } while (seenEventIds.has(eventId));
    } else if (typeof eventId !== 'string' || eventId.length === 0) {
      bumpDiagnostic('invalid_usage');
      return { status: 'rejected', reason: 'eventId must be a non-empty string' };
    }
    const sessionId = projected.sessionId ?? taskId;
    const occurredAt =
      projected.occurredAt instanceof Date
        ? projected.occurredAt.toISOString()
        : (projected.occurredAt ?? now().toISOString());

    const input: IngestUsageInput = {
      eventId,
      taskId,
      sessionId: typeof sessionId === 'string' ? sessionId : '',
      turnId: projected.turnId ?? eventId,
      sequence: nextSequence(harness, providerContract, String(sessionId)),
      harness,
      providerContractVersion: providerContract,
      observedModel: projected.model,
      usage: toContractUsage(projected.usage),
      ...(projected.usageKind !== undefined ? { usageKind: projected.usageKind } : {}),
      ...(projected.providerCostUsd !== undefined
        ? { actualCostUsd: projected.providerCostUsd }
        : {}),
      observedAt: typeof occurredAt === 'string' ? occurredAt : '',
      costBasis: projected.costBasis ?? defaultBasis,
      ...(projected.replayOfEventId !== undefined
        ? { replayOfEventId: projected.replayOfEventId }
        : {}),
      ...(projected.isSubagent !== undefined ? { isSubagent: projected.isSubagent } : {}),
    };
    return ingestInto(kind, harness, providerContract, input, eventId);
  }

  function recordVia(
    kind: TaskCostCaptureKind,
    input: IngestUsageInput | TaskCostEventV1,
  ): RecordResult {
    if (notAnObject(input)) {
      throw new TaskCostMeasureError(
        'record requires an IngestUsageInput or TaskCostEventV1 object',
      );
    }
    const raw = input as unknown as Record<string, unknown>;
    const prebuilt = raw.schema_version === TASK_COST_EVENT_SCHEMA_VERSION;
    const projected = prebuilt ? projectPrebuiltEvent(raw) : projectIngestInput(raw);
    const harness = prebuilt
      ? (projected as TaskCostEventV1).harness
      : (projected as IngestUsageInput).harness;
    if (!(TASK_COST_HARNESSES as readonly string[]).includes(harness)) {
      bumpDiagnostic('invalid_usage');
      return {
        status: 'rejected',
        reason: `harness must be one of: ${TASK_COST_HARNESSES.join(', ')}`,
      };
    }
    const providerContract = prebuilt
      ? (projected as TaskCostEventV1).provider_contract_version
      : (projected as IngestUsageInput).providerContractVersion;
    if (typeof providerContract !== 'string' || providerContract.length === 0) {
      bumpDiagnostic('invalid_usage');
      return { status: 'rejected', reason: 'providerContractVersion is required' };
    }
    const eventId = prebuilt
      ? (projected as TaskCostEventV1).event_id
      : (projected as IngestUsageInput).eventId;
    if (typeof eventId !== 'string' || eventId.length === 0) {
      bumpDiagnostic('invalid_usage');
      return { status: 'rejected', reason: 'eventId must be a non-empty string' };
    }
    return ingestInto(kind, harness, providerContract, projected, eventId);
  }

  function summary(): TaskCostReport {
    const snapshots: EngineSnapshot[] = [];
    let aggregationFailures = 0;
    for (const { engine } of engines.values()) {
      const events = engine.events();
      if (events.length === 0) continue;
      try {
        snapshots.push({
          summary: engine.snapshot(),
          modelTotals: aggregateTaskCostByModel(events, { taskId }),
          events,
        });
      } catch (error) {
        // summary() never throws for recorded data; a replay cycle (the one
        // inconsistency ingest cannot see) degrades to a diagnostic.
        if (!(error instanceof TaskCostValidationError)) throw error;
        aggregationFailures += 1;
      }
    }
    const diagnostics: Partial<Record<TaskCostReportDiagnosticCode, number>> = {};
    for (const [code, count] of trackerDiagnostics) diagnostics[code] = count;
    if (aggregationFailures > 0) {
      diagnostics.aggregation_failed =
        (diagnostics.aggregation_failed ?? 0) + aggregationFailures;
    }
    return buildTaskCostReport({
      taskId,
      engines: snapshots,
      trackerDiagnostics: diagnostics,
      sourceDiagnostics: { ...sourceDiagnostics },
      capture: TASK_COST_CAPTURE_KINDS.filter((kind) => captureKinds.has(kind)),
      sessionFileCount,
      overrideCount: overrides.length,
    });
  }

  async function flush(): Promise<LedgerFlushResult> {
    const ledger = options.ledger;
    if (ledger === undefined) return { appended: 0, duplicates: 0 };
    const pending = acceptedEvents.slice(persistedCount);
    if (pending.length === 0) return { appended: 0, duplicates: 0 };
    const results = await ledger.appendMany(toLedgerEntries(pending));
    persistedCount += pending.length;
    let appended = 0;
    for (const result of results) {
      if (result.status === 'appended') appended += 1;
    }
    return { appended, duplicates: results.length - appended };
  }

  function reset(): void {
    engines = new Map();
    acceptedEvents = [];
    seenEventIds = new Set();
    sequences = new Map();
    trackerDiagnostics = new Map();
    sourceDiagnostics = {};
    captureKinds = new Set();
    sessionFileCount = 0;
    eventCounter = 0;
    persistedCount = 0;
  }

  const tracker: TaskCostTracker = {
    taskId,
    recordUsage: (record) => recordUsageVia('manual', record),
    record: (input) => recordVia('manual', input),
    summary,
    events: () => Object.freeze([...acceptedEvents]),
    flush,
    reset,
  };

  const internals: TrackerInternals = {
    recordUsageVia,
    recordVia,
    addSourceDiagnostics(diagnostics) {
      for (const [code, count] of Object.entries(diagnostics) as [
        keyof TaskCostSourceDiagnostics,
        number,
      ][]) {
        if (count !== undefined && count > 0) {
          countDiagnostic(sourceDiagnostics, code, count);
        }
      }
    },
    addSessionFiles(count) {
      sessionFileCount += count;
    },
    bumpDiagnostic,
  };

  return { tracker, internals };
}

/**
 * Create a standalone tracker: `recordUsage`/`record` in, `summary()` out.
 * Measurement is local-only — no network, no credentials, no default writes.
 */
export function createTaskCostTracker(
  options: TaskCostTrackerOptions = {},
): TaskCostTracker {
  return createTrackerWithInternals(options).tracker;
}
