/**
 * `measureTask` — wrap one run of a task and get its cost report back:
 *
 * ```ts
 * import { measureTask } from '@hokusai/costs';
 * const { result, cost } = await measureTask({ events: harness }, () => harness.run(task));
 * ```
 *
 * Capture sources (all optional, all local):
 *
 * - a live emitter (`on`/`off`, `addListener`/`removeListener`, or an
 *   `EventTarget`), subscribed for the duration of `fn`;
 * - an `Iterable`/`AsyncIterable` of usage records, consumed after `fn`;
 * - Claude Code / Codex session files behind an explicit boundary;
 * - the tracker handed to `fn`, for inline `tracker.recordUsage(...)`.
 *
 * Error policy: if `fn` throws, the same error instance is rethrown; when it
 * is an extensible object the partial report is attached as a non-enumerable
 * `error.taskCost`. Collection failures degrade to diagnostics and never mask
 * `fn`'s result (or its error).
 *
 * @module measure/measure-task
 */

import { TASK_COST_EVENT_SCHEMA_VERSION, type TaskCostEventV1 } from '@hokusai/core';
import type { IngestUsageInput } from '../engine.js';
import { TaskCostMeasureError } from './errors.js';
import { collectSessionFiles, validateSessionFilesOptions } from './session-files.js';
import { createTrackerWithInternals, type TrackerInternals } from './tracker.js';
import type {
  MeasureTaskOptions,
  MeasureTaskResult,
  TaskCostReport,
  TaskCostTracker,
  TaskUsageRecord,
  UsageEventSource,
} from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Subscription {
  add(eventName: string, listener: (payload: unknown) => void): void;
  remove(eventName: string, listener: (payload: unknown) => void): void;
}

/** Duck-typed emitter support, so a Node `EventEmitter` or a DOM/undici
 * `EventTarget` works without this package importing `node:events`. */
function subscriptionFor(source: UsageEventSource): Subscription | null {
  const candidate = source as Record<string, unknown>;
  for (const [add, remove] of [
    ['on', 'off'],
    ['addListener', 'removeListener'],
    ['addEventListener', 'removeEventListener'],
  ] as const) {
    if (typeof candidate[add] === 'function' && typeof candidate[remove] === 'function') {
      return {
        add: (eventName, listener) =>
          (candidate[add] as (n: string, l: unknown) => void)(eventName, listener),
        remove: (eventName, listener) =>
          (candidate[remove] as (n: string, l: unknown) => void)(eventName, listener),
      };
    }
  }
  return null;
}

function isIterableSource(
  source: UsageEventSource,
): source is Iterable<unknown> | AsyncIterable<unknown> {
  const candidate = source as {
    [Symbol.iterator]?: unknown;
    [Symbol.asyncIterator]?: unknown;
  };
  return (
    typeof candidate[Symbol.iterator] === 'function' ||
    typeof candidate[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Route one payload: a contract event or engine-shaped input goes to
 * `record`; anything else is treated as a friendly `TaskUsageRecord`. An
 * `EventTarget`'s `Event` wrapper is unwrapped via `.detail` (CustomEvent).
 */
function dispatchPayload(
  internals: TrackerInternals,
  payload: unknown,
  mapEvent: ((payload: unknown) => unknown) | undefined,
): void {
  let record: unknown = payload;
  if (mapEvent !== undefined) {
    try {
      record = mapEvent(payload);
    } catch {
      internals.bumpDiagnostic('collection_failed');
      return;
    }
  } else if (
    isPlainObject(record) &&
    !('model' in record) &&
    !('observedModel' in record) &&
    isPlainObject(record.detail)
  ) {
    record = record.detail;
  }
  if (!isPlainObject(record)) {
    internals.bumpDiagnostic('invalid_usage');
    return;
  }
  try {
    if (
      record.schema_version === TASK_COST_EVENT_SCHEMA_VERSION ||
      typeof record.observedModel === 'string'
    ) {
      internals.recordVia('events', record as unknown as IngestUsageInput | TaskCostEventV1);
    } else {
      internals.recordUsageVia('events', record as unknown as TaskUsageRecord);
    }
  } catch (error) {
    // A listener must never throw back into the emitter; a payload the
    // tracker would reject loudly (e.g. an unknown harness) degrades to a
    // rejected-record diagnostic instead.
    if (!(error instanceof TaskCostMeasureError)) throw error;
    internals.bumpDiagnostic('invalid_usage');
  }
}

async function consumeIterable(
  internals: TrackerInternals,
  source: Iterable<unknown> | AsyncIterable<unknown>,
  mapEvent: ((payload: unknown) => unknown) | undefined,
): Promise<void> {
  for await (const payload of source as AsyncIterable<unknown>) {
    dispatchPayload(internals, payload, mapEvent);
  }
}

function attachTaskCost(error: unknown, cost: TaskCostReport): void {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return; // primitives rethrow unchanged; the cost is unavailable then
  }
  if (!Object.isExtensible(error)) return; // frozen/sealed errors stay untouched
  try {
    Object.defineProperty(error, 'taskCost', {
      value: cost,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch {
    // An existing non-configurable `taskCost` wins; never mask the error.
  }
}

/**
 * Run `fn` and measure its cost. Resolves to `{ result, cost }`; rejects with
 * `fn`'s own error (with `error.taskCost` attached when possible). Entirely
 * local: no network call, no credential read, no default disk write.
 */
export async function measureTask<T>(
  options: MeasureTaskOptions,
  fn: (tracker: TaskCostTracker) => T | Promise<T>,
): Promise<MeasureTaskResult<T>> {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TaskCostMeasureError('measureTask requires an options object');
  }
  if (typeof fn !== 'function') {
    throw new TaskCostMeasureError('measureTask requires a function to run');
  }
  if (options.eventName !== undefined && typeof options.eventName !== 'string') {
    throw new TaskCostMeasureError('eventName must be a string');
  }
  if (options.mapEvent !== undefined && typeof options.mapEvent !== 'function') {
    throw new TaskCostMeasureError('mapEvent must be a function');
  }
  if (options.sessionFiles !== undefined) {
    validateSessionFilesOptions(options.sessionFiles);
  }
  let subscription: Subscription | null = null;
  let iterable: Iterable<unknown> | AsyncIterable<unknown> | null = null;
  if (options.events !== undefined) {
    if (options.events === null || typeof options.events !== 'object') {
      throw new TaskCostMeasureError(
        'events must be an emitter, an Iterable, or an AsyncIterable',
      );
    }
    subscription = subscriptionFor(options.events);
    if (subscription === null) {
      if (!isIterableSource(options.events)) {
        throw new TaskCostMeasureError(
          'events must be an emitter (on/off, addListener/removeListener, add/removeEventListener) or an (async) iterable',
        );
      }
      iterable = options.events;
    }
  }

  // Tracker construction validates taskId/harness/overrides (and throws for
  // programmer errors) before anything runs.
  const { tracker, internals } = createTrackerWithInternals(options);
  const now = options.now ?? ((): Date => new Date());

  const signal = options.signal;
  if (signal !== undefined) {
    if (typeof signal.aborted !== 'boolean') {
      throw new TaskCostMeasureError('signal must be an AbortSignal');
    }
    if (signal.aborted) {
      const reason: unknown = (signal as { reason?: unknown }).reason;
      if (reason instanceof Error || reason instanceof DOMException) throw reason;
      throw new DOMException('measureTask was aborted before the task ran', 'AbortError');
    }
  }

  const startedAt = now().toISOString();
  const eventName = options.eventName ?? 'usage';
  const listener = (payload: unknown): void =>
    dispatchPayload(internals, payload, options.mapEvent);

  let fnError: unknown;
  let fnThrew = false;
  let result: T | undefined;
  if (subscription !== null) subscription.add(eventName, listener);
  try {
    result = await fn(tracker);
  } catch (error) {
    fnThrew = true;
    fnError = error;
  } finally {
    if (subscription !== null) subscription.remove(eventName, listener);
  }
  const endedAt = now().toISOString();

  // Post-run collection. Failures degrade to diagnostics; they never mask the
  // run's result, and when fn already threw, the original error still wins.
  if (iterable !== null) {
    try {
      await consumeIterable(internals, iterable, options.mapEvent);
    } catch {
      internals.bumpDiagnostic('collection_failed');
    }
  }
  if (options.sessionFiles !== undefined) {
    try {
      const collected = await collectSessionFiles(tracker.taskId, options.sessionFiles, {
        startedAt,
        endedAt,
      });
      internals.addSessionFiles(collected.fileCount);
      internals.addSourceDiagnostics(collected.diagnostics);
      for (const input of collected.inputs) {
        internals.recordVia('session-files', input);
      }
    } catch (error) {
      // A misconfigured boundary is a programmer error and must fail the
      // success path loudly; after fn already threw, fn's error wins.
      if (error instanceof TaskCostMeasureError && !fnThrew) throw error;
      internals.bumpDiagnostic('collection_failed');
    }
  }
  try {
    await tracker.flush();
  } catch {
    internals.bumpDiagnostic('ledger_flush_failed');
  }

  const cost = tracker.summary();
  if (fnThrew) {
    attachTaskCost(fnError, cost);
    throw fnError;
  }
  return { result: result as T, cost };
}
