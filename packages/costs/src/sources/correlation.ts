/**
 * Boundary correlation, cross-file dedupe, and cumulative baseline handling.
 *
 * Shared across the source adapters so the rule stays identical: a record
 * enters the ledger only when its session id is in `allowedSessionIds` and
 * its observation timestamp falls inside `[startAt, endAt]`. Everything else
 * increments a source diagnostic and is dropped.
 *
 * @module sources/correlation
 */

import type { SourceDiagnosticCode, TaskBoundary } from './types.js';

export interface BoundaryContext {
  taskId: string;
  allowedSessionIds: ReadonlySet<string>;
  startMs: number;
  endMs: number;
}

/** Validate a boundary and pre-compute an efficient matcher for it. */
export function buildBoundaryContext(boundary: TaskBoundary): BoundaryContext {
  if (typeof boundary.taskId !== 'string' || boundary.taskId.length === 0) {
    throw new TypeError('TaskBoundary.taskId must be a non-empty string');
  }
  if (
    !Array.isArray(boundary.allowedSessionIds) ||
    boundary.allowedSessionIds.length === 0
  ) {
    throw new TypeError(
      'TaskBoundary.allowedSessionIds must be a non-empty array of session ids',
    );
  }
  for (const id of boundary.allowedSessionIds) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(
        'TaskBoundary.allowedSessionIds entries must be non-empty strings',
      );
    }
  }
  const startMs = Date.parse(boundary.startAt);
  const endMs = Date.parse(boundary.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new TypeError(
      'TaskBoundary.startAt/endAt must be valid ISO-8601 timestamps',
    );
  }
  if (endMs < startMs) {
    throw new TypeError('TaskBoundary.endAt must be >= startAt');
  }
  return {
    taskId: boundary.taskId,
    allowedSessionIds: new Set(boundary.allowedSessionIds),
    startMs,
    endMs,
  };
}

/** Check whether a candidate matches the boundary window. */
export function matchesBoundary(
  boundary: BoundaryContext,
  sessionId: string,
  observedAt: string,
): boolean {
  if (!boundary.allowedSessionIds.has(sessionId)) return false;
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return false;
  return ms >= boundary.startMs && ms <= boundary.endMs;
}

/** Growing count map keyed by diagnostic code. */
export class DiagnosticTally {
  private readonly counts = new Map<SourceDiagnosticCode, number>();

  bump(code: SourceDiagnosticCode, count = 1): void {
    if (count <= 0) return;
    this.counts.set(code, (this.counts.get(code) ?? 0) + count);
  }

  toArray(): { code: SourceDiagnosticCode; count: number }[] {
    return [...this.counts].map(([code, count]) => ({ code, count }));
  }
}

export interface CumulativeCounters {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
}

/**
 * Compute the per-turn delta between a prior cumulative baseline and a fresh
 * cumulative reading, rearming the baseline on any negative jump (a counter
 * reset). A `null` counter on either side contributes nothing to that field.
 */
export function cumulativeDelta(
  prev: CumulativeCounters,
  next: CumulativeCounters,
): { delta: CumulativeCounters; reset: boolean } {
  let reset = false;
  const delta: CumulativeCounters = {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
  };
  const fields: (keyof CumulativeCounters)[] = [
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'reasoning_tokens',
  ];
  for (const field of fields) {
    const before = prev[field];
    const after = next[field];
    if (after === null) continue;
    if (before === null) {
      delta[field] = after;
      continue;
    }
    const diff = after - before;
    if (diff < 0) {
      // A backward jump means the source reset its cumulative counter (e.g. a
      // new turn's `last_token_usage`). Treat the fresh reading as its own
      // delta and rearm the baseline.
      reset = true;
      delta[field] = after;
    } else {
      delta[field] = diff;
    }
  }
  return { delta, reset };
}
