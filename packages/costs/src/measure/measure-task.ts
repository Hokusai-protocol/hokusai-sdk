/**
 * `measureTask` — the drop-in entry point: run a task function, collect its
 * usage (from session files, normalized event records, or manual tracker
 * calls), and return the task result together with a `TaskCostReport`.
 *
 * Collection composes the existing opt-in source adapters
 * (`extractClaudeCodeUsage` / `extractCodexUsage` /
 * `extractEventSourceUsage`) over a `createTaskCostEngine`; nothing here
 * prices or aggregates on its own.
 *
 * Boundary derivation (D2): the caller explicitly naming a session file
 * attributes all of its sessions to this task, so the boundary is derived
 * from the file's own parsed records (distinct session ids, min/max observed
 * timestamps). An explicit `options.boundary` overrides the derivation.
 *
 * Error discipline (D6): malformed options throw
 * `MeasureError('INVALID_ARGUMENT')` before `fn` runs; data problems
 * (unreadable files, malformed lines, unpriced models) never throw — they
 * become report diagnostics. When `fn` itself throws, the same instance is
 * rethrown with the partial report attached as `error.taskCost` (objects
 * only; primitive throws are rethrown unchanged).
 *
 * @module measure/measure-task
 */

import type { TaskCostEventV1 } from '@hokusai/core';
import type { TaskCostLedger } from '../ledger/ledger.js';
import type { ToLedgerRecordInput } from '../ledger/record.js';
import { extractClaudeCodeUsage } from '../sources/claude-code/adapter.js';
import { parseClaudeCodeTranscript } from '../sources/claude-code/parser.js';
import { extractCodexUsage } from '../sources/codex/adapter.js';
import { parseCodexRollout } from '../sources/codex/parser.js';
import { extractEventSourceUsage } from '../sources/event-source.js';
import { asRecord, timestampOrNull } from '../sources/sanitize.js';
import type {
  TaskCostBoundaryV1,
  TaskCostSourceDiagnosticCode,
  TaskCostSourceDiagnostics,
  TaskCostSourceResult,
} from '../sources/types.js';
import { buildTaskCostReport } from './report.js';
import {
  createTrackerCore,
  isContractSafeId,
  toContractHarness,
  type TrackerCore,
} from './tracker.js';
import {
  MeasureError,
  type CostDiagnostic,
  type MeasureDiagnosticCode,
  type MeasureTaskOptions,
  type MeasureTaskResult,
  type TaskCostReport,
  type TaskCostTracker,
} from './types.js';

/** Session-file collection understands exactly these harness transcript formats. */
const SESSION_FILE_HARNESSES = ['claude-code', 'codex'] as const;
type SessionFileHarness = (typeof SESSION_FILE_HARNESSES)[number];

/** Measure-layer rendering of each count-only source diagnostic code. */
const SOURCE_DIAGNOSTIC_MAP: Record<
  TaskCostSourceDiagnosticCode,
  { code: MeasureDiagnosticCode; level: CostDiagnostic['level'] }
> = {
  malformed_line: { code: 'MALFORMED_RECORD', level: 'warn' },
  oversized_line: { code: 'MALFORMED_RECORD', level: 'warn' },
  truncated_input: { code: 'MALFORMED_RECORD', level: 'warn' },
  missing_session_id: { code: 'INVALID_RECORD', level: 'warn' },
  session_not_in_boundary: { code: 'RECORD_OUT_OF_BOUNDARY', level: 'info' },
  foreign_task: { code: 'RECORD_OUT_OF_BOUNDARY', level: 'info' },
  missing_timestamp: { code: 'INVALID_RECORD', level: 'warn' },
  outside_time_window: { code: 'RECORD_OUT_OF_BOUNDARY', level: 'info' },
  missing_usage: { code: 'INVALID_USAGE', level: 'warn' },
  invalid_usage_value: { code: 'INVALID_USAGE', level: 'warn' },
  duplicate_row: { code: 'DUPLICATE_RECORD', level: 'info' },
  cumulative_counter_reset: { code: 'COUNTER_RESET', level: 'info' },
  invalid_record: { code: 'INVALID_RECORD', level: 'warn' },
  unreadable_file: { code: 'SESSION_FILE_UNREADABLE', level: 'warn' },
  oversized_file: { code: 'SESSION_FILE_UNREADABLE', level: 'warn' },
};

function invalidArgument(message: string): never {
  throw new MeasureError('INVALID_ARGUMENT', message);
}

function isIterable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    typeof candidate[Symbol.iterator] === 'function' ||
    typeof candidate[Symbol.asyncIterator] === 'function'
  );
}

function normalizeSessionFiles(sessionFile: string | string[]): string[] {
  const paths = Array.isArray(sessionFile) ? sessionFile : [sessionFile];
  if (
    paths.length === 0 ||
    paths.some((path) => typeof path !== 'string' || path.length === 0)
  ) {
    invalidArgument(
      'options.sessionFile must be a non-empty path or array of paths',
    );
  }
  return paths;
}

function validateOptions(
  options: MeasureTaskOptions,
  fn: unknown,
): { paths: string[] | null; sessionHarness: SessionFileHarness | null } {
  if (typeof options !== 'object' || options === null) {
    invalidArgument('measureTask options must be an object');
  }
  if (typeof fn !== 'function') {
    invalidArgument('measureTask requires a task function');
  }
  if (options.taskId !== undefined && !isContractSafeId(options.taskId)) {
    invalidArgument(
      'options.taskId must be a contract-safe identifier (letters, digits, ".", "_", ":", "-")',
    );
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    invalidArgument('options.now must be a function');
  }
  if (options.events !== undefined && options.sessionFile !== undefined) {
    invalidArgument(
      'options.events and options.sessionFile are mutually exclusive; pass one usage source',
    );
  }
  if (options.events !== undefined && !isIterable(options.events)) {
    invalidArgument('options.events must be an iterable or async iterable');
  }
  if (
    options.boundary !== undefined &&
    options.taskId !== undefined &&
    options.boundary.taskId !== options.taskId
  ) {
    invalidArgument('options.boundary.taskId must equal options.taskId');
  }

  let paths: string[] | null = null;
  let sessionHarness: SessionFileHarness | null = null;
  if (options.sessionFile !== undefined) {
    paths = normalizeSessionFiles(options.sessionFile);
    if (
      !(SESSION_FILE_HARNESSES as readonly unknown[]).includes(options.harness)
    ) {
      invalidArgument(
        `options.sessionFile requires options.harness to be one of: ${SESSION_FILE_HARNESSES.join(', ')}`,
      );
    }
    sessionHarness = options.harness as SessionFileHarness;
  }
  return { paths, sessionHarness };
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('measureTask aborted before the task function ran');
  error.name = 'AbortError';
  return error;
}

/** Render count-only source diagnostics as measure diagnostics. */
function mapSourceDiagnostics(
  diagnostics: TaskCostSourceDiagnostics,
  core: TrackerCore,
): void {
  for (const [source, count] of Object.entries(diagnostics)) {
    if (count === undefined || count === 0) continue;
    const mapped =
      SOURCE_DIAGNOSTIC_MAP[source as TaskCostSourceDiagnosticCode];
    core.addDiagnostic({
      code: mapped.code,
      level: mapped.level,
      message: `${String(count)} record(s) skipped or noted while collecting usage (${source})`,
    });
  }
}

interface DerivedBoundary {
  sessionIds: string[];
  minMs: number;
  maxMs: number;
}

function toBoundary(
  taskId: string,
  derived: DerivedBoundary,
): TaskCostBoundaryV1 | null {
  if (derived.sessionIds.length === 0 || !Number.isFinite(derived.minMs)) {
    return null;
  }
  return {
    boundaryVersion: 1,
    taskId,
    sessionIds: derived.sessionIds,
    startedAt: new Date(derived.minMs).toISOString(),
    endedAt: new Date(derived.maxMs).toISOString(),
  };
}

function noteObservation(
  derived: DerivedBoundary,
  sessionId: string | null,
  observedMs: number | null,
): void {
  if (sessionId === null) return;
  if (!derived.sessionIds.includes(sessionId)) {
    derived.sessionIds.push(sessionId);
  }
  if (observedMs !== null) {
    derived.minMs = Math.min(derived.minMs, observedMs);
    derived.maxMs = Math.max(derived.maxMs, observedMs);
  }
}

/**
 * Derive the task boundary from the session files' own records: every
 * session found is in-scope, and the window spans the observed timestamps.
 * The pre-parse is cheap (bounded JSONL, two passes over ≤500-record files
 * stays well inside the latency budget) and uses a throwaway diagnostics
 * accumulator — the adapter's own parse is the one that reports.
 */
function deriveSessionFileBoundary(
  harness: SessionFileHarness,
  contents: readonly string[],
  taskId: string,
): TaskCostBoundaryV1 | null {
  const throwaway: TaskCostSourceDiagnostics = {};
  const derived: DerivedBoundary = {
    sessionIds: [],
    minMs: Infinity,
    maxMs: -Infinity,
  };
  for (const content of contents) {
    if (harness === 'codex') {
      const session = parseCodexRollout(content, throwaway);
      for (const observation of session.observations) {
        noteObservation(derived, session.sessionId, observation.observedMs);
      }
    } else {
      for (const row of parseClaudeCodeTranscript(content, throwaway)) {
        noteObservation(derived, row.sessionId, row.observedMs);
      }
    }
  }
  return toBoundary(taskId, derived);
}

/** Derive the boundary from already-normalized records (friendly or prebuilt). */
function deriveEventBoundary(
  records: readonly unknown[],
  taskId: string,
): TaskCostBoundaryV1 | null {
  const derived: DerivedBoundary = {
    sessionIds: [],
    minMs: Infinity,
    maxMs: -Infinity,
  };
  for (const candidate of records) {
    const record = asRecord(candidate);
    if (record === null) continue;
    const sessionId = record.session_id ?? record.sessionId;
    const observedAt = record.observed_at ?? record.observedAt;
    const timestamp = timestampOrNull(observedAt);
    noteObservation(
      derived,
      typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null,
      timestamp === null ? null : timestamp.ms,
    );
  }
  return toBoundary(taskId, derived);
}

/** Pull a usable task id out of an events array, for callers who omit one. */
function taskIdFromEventsArray(events: unknown): string | undefined {
  if (!Array.isArray(events)) return undefined;
  for (const candidate of events) {
    const record = asRecord(candidate);
    if (record === null) continue;
    const taskId = record.task_id ?? record.taskId;
    if (typeof taskId === 'string' && isContractSafeId(taskId)) return taskId;
  }
  return undefined;
}

function ingestSourceResult(
  core: TrackerCore,
  result: TaskCostSourceResult,
): void {
  mapSourceDiagnostics(result.diagnostics, core);
  for (const input of result.inputs) {
    const originalLabel = (input as any).harness;
    const normalized = {
      ...input,
      harness: toContractHarness(originalLabel ?? 'unknown'),
    };
    core.noteIngestResult(core.engine().ingest(normalized), originalLabel);
  }
}

async function collectFromSessionFiles(
  core: TrackerCore,
  harness: SessionFileHarness,
  paths: readonly string[],
  boundaryOverride: TaskCostBoundaryV1 | undefined,
): Promise<void> {
  let read: { path: string; content: string | null }[];
  try {
    // Dynamic import keeps `node:fs` out of the package root's static module
    // graph (D5): only this branch, on a Node runtime, ever loads it.
    const nodeRead = await import('./node-read.js');
    read = await nodeRead.readSessionFiles(paths);
  } catch {
    core.addDiagnostic({
      code: 'SESSION_FILE_UNREADABLE',
      level: 'warn',
      message: `${String(paths.length)} session file(s) could not be read (no filesystem access in this runtime)`,
    });
    return;
  }

  const contents: string[] = [];
  let unreadable = 0;
  for (const file of read) {
    if (file.content === null) unreadable += 1;
    else contents.push(file.content);
  }
  if (unreadable > 0) {
    core.addDiagnostic({
      code: 'SESSION_FILE_UNREADABLE',
      level: 'warn',
      message: `${String(unreadable)} of ${String(paths.length)} session file(s) could not be read; measurement continued without them`,
    });
  }
  if (contents.length === 0) return;

  const boundary =
    boundaryOverride ??
    deriveSessionFileBoundary(harness, contents, core.tracker.taskId);
  if (boundary === null) {
    core.addDiagnostic({
      code: 'INVALID_RECORD',
      level: 'warn',
      message:
        'no sessions or timestamps could be derived from the session file(s); no usage captured from them',
    });
    return;
  }
  const extract =
    harness === 'codex' ? extractCodexUsage : extractClaudeCodeUsage;
  ingestSourceResult(core, extract({ boundary, files: contents }));
}

async function collectFromEvents(
  core: TrackerCore,
  events: Iterable<unknown> | AsyncIterable<unknown>,
  boundaryOverride: TaskCostBoundaryV1 | undefined,
): Promise<void> {
  const records: unknown[] = [];
  if (Symbol.asyncIterator in events) {
    for await (const record of events) records.push(record);
  } else {
    for (const record of events) records.push(record);
  }
  if (records.length === 0) return;

  const boundary =
    boundaryOverride ?? deriveEventBoundary(records, core.tracker.taskId);
  if (boundary === null) {
    core.addDiagnostic({
      code: 'INVALID_RECORD',
      level: 'warn',
      message: `${String(records.length)} record(s) carried no usable session id or timestamp; no usage captured from them`,
    });
    return;
  }
  ingestSourceResult(core, extractEventSourceUsage({ boundary, records }));
}

/** Map one contract event to the ledger's input row. */
function toLedgerInput(event: TaskCostEventV1): ToLedgerRecordInput {
  const resolved =
    event.actual_cost_usd !== null
      ? event.actual_cost_usd
      : event.estimated_cost_usd;
  const table = event.price_table;
  const isKnownBackend = (t: string): t is 'anthropic' | 'openai' | 'google' | 'openrouter' | 'override' | 'external' => {
    return ['anthropic', 'openai', 'google', 'openrouter', 'override', 'external'].includes(t);
  };
  return {
    taskId: event.task_id,
    model: event.observed_model,
    harness: event.harness,
    backend: isKnownBackend(table) ? table : 'unknown',
    source: event.cost_source,
    pricingBasis:
      event.actual_cost_usd !== null
        ? 'metered'
        : event.estimated_cost_usd !== null
          ? 'token_equivalent'
          : 'unpriced',
    amountMicros: resolved === null ? null : Math.round(resolved * 1_000_000),
    ts: Date.parse(event.observed_at),
    inputTokens: event.usage.input_tokens ?? 0,
    outputTokens: event.usage.output_tokens ?? 0,
    cacheReadTokens: event.usage.cache_read_tokens ?? 0,
    cacheWriteTokens: event.usage.cache_write_tokens ?? 0,
    coverage:
      event.usage_coverage === 'available' ||
      event.usage_coverage === 'known_zero'
        ? 'complete'
        : 'partial',
  };
}

/** Opt-in persistence (D7): append every captured event; never throws out. */
async function persistToLedger(
  core: TrackerCore,
  ledger: TaskCostLedger,
): Promise<void> {
  let failures = 0;
  for (const event of core.engine().events()) {
    try {
      await ledger.append(toLedgerInput(event), { eventKey: event.event_id });
    } catch {
      failures += 1;
    }
  }
  if (failures > 0) {
    core.addDiagnostic({
      code: 'LEDGER_WRITE_FAILED',
      level: 'warn',
      message: `${String(failures)} record(s) could not be written to the opt-in ledger; the in-memory report is unaffected`,
    });
  }
}

async function collectAndFinalize(
  core: TrackerCore,
  options: MeasureTaskOptions,
  paths: string[] | null,
  sessionHarness: SessionFileHarness | null,
): Promise<TaskCostReport> {
  if (paths !== null && sessionHarness !== null) {
    await collectFromSessionFiles(
      core,
      sessionHarness,
      paths,
      options.boundary,
    );
  } else if (options.events !== undefined) {
    await collectFromEvents(core, options.events, options.boundary);
  }
  if (options.ledger !== undefined) {
    await persistToLedger(core, options.ledger);
  }
  return buildTaskCostReport(core.engine().events(), {
    taskId: core.tracker.taskId,
    sourceKind:
      paths !== null
        ? 'session-file'
        : options.events !== undefined
          ? 'events'
          : 'manual',
    ...(typeof options.harness === 'string' && options.harness.length > 0
      ? { sourceHarness: options.harness }
      : {}),
    ...(paths !== null ? { files: paths } : {}),
    harnessLabels: core.harnessLabels(),
    diagnostics: core.diagnostics(),
  });
}

/**
 * Run `fn` and measure its task cost. See the module docs for boundary,
 * error, and coverage semantics; see `measure/types.ts` for `totalUsd`
 * semantics.
 */
export async function measureTask<T>(
  options: MeasureTaskOptions,
  fn: (tracker: TaskCostTracker) => T | Promise<T>,
): Promise<MeasureTaskResult<T>> {
  const { paths, sessionHarness } = validateOptions(options, fn);
  if (options.signal?.aborted === true) {
    throw abortError(options.signal);
  }

  const taskId =
    options.taskId ??
    options.boundary?.taskId ??
    taskIdFromEventsArray(options.events);
  const core = createTrackerCore({
    ...(taskId !== undefined ? { taskId } : {}),
    ...(options.harness !== undefined ? { harness: options.harness } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.pricing?.priceOverrides !== undefined
      ? { priceOverrides: options.pricing.priceOverrides }
      : {}),
    ...(options.pricing?.pricingRevision !== undefined
      ? { pricingRevision: options.pricing.pricingRevision }
      : {}),
  });

  let result: T;
  try {
    result = await fn(core.tracker);
  } catch (error) {
    // Best effort: collect what we can, attach the partial report to object
    // throws, and rethrow the exact same instance (REQ-F6). Collection
    // failures must never mask the task's own error.
    if (typeof error === 'object' && error !== null) {
      try {
        const cost = await collectAndFinalize(
          core,
          options,
          paths,
          sessionHarness,
        );
        (error as { taskCost?: TaskCostReport }).taskCost = cost;
      } catch {
        // Leave the original error untouched.
      }
    }
    throw error;
  }

  const cost = await collectAndFinalize(core, options, paths, sessionHarness);
  return { result, cost };
}
