/**
 * Explicit task-boundary correlation and cumulative-baseline handling.
 *
 * Correlation is deliberately dumb: a row belongs to the task iff its session
 * id is in the boundary's session set AND its timestamp is inside the
 * inclusive window. There is no newest-file fallback and no branch/stage
 * inference — ambiguity becomes a count-only diagnostic, not a guess.
 *
 * @module sources/correlation
 */

import type { TaskCostTokenUsage } from '@hokusai/core';
import { TASK_COST_TOKEN_FIELDS } from '@hokusai/core';
import { idOrNull, timestampOrNull } from './sanitize.js';
import type { TaskCostBoundaryV1 } from './types.js';

export interface ResolvedTaskBoundary {
  taskId: string;
  sessionIds: ReadonlySet<string>;
  startMs: number;
  endMs: number;
}

/**
 * Validate and resolve a boundary. Misconfiguration throws `TypeError` so a
 * bad caller setup fails fast instead of silently attributing nothing.
 */
export function resolveTaskBoundary(
  boundary: TaskCostBoundaryV1,
): ResolvedTaskBoundary {
  if (boundary.boundaryVersion !== 1) {
    throw new TypeError('task boundary must have boundaryVersion 1');
  }
  const taskId = idOrNull(boundary.taskId);
  if (taskId === null) {
    throw new TypeError('task boundary requires a contract-safe taskId');
  }
  if (!Array.isArray(boundary.sessionIds) || boundary.sessionIds.length === 0) {
    throw new TypeError('task boundary requires at least one session id');
  }
  const sessionIds = new Set<string>();
  for (const sessionId of boundary.sessionIds) {
    const id = idOrNull(sessionId);
    if (id === null) {
      throw new TypeError('task boundary session ids must be contract-safe identifiers');
    }
    sessionIds.add(id);
  }
  const started = timestampOrNull(boundary.startedAt);
  const ended = timestampOrNull(boundary.endedAt);
  if (started === null || ended === null || started.ms > ended.ms) {
    throw new TypeError('task boundary requires an ordered startedAt/endedAt window');
  }
  return { taskId, sessionIds, startMs: started.ms, endMs: ended.ms };
}

/** Whether an epoch-ms timestamp falls inside the inclusive window. */
export function inBoundaryWindow(
  boundary: ResolvedTaskBoundary,
  timestampMs: number,
): boolean {
  return timestampMs >= boundary.startMs && timestampMs <= boundary.endMs;
}

export interface CumulativeDeltaResult {
  /** Per-turn delta; `null` fields were never reported cumulatively. */
  usage: Partial<TaskCostTokenUsage>;
  /** A present counter regressed: the tracker re-baselined and no delta is usable. */
  reset: boolean;
}

/**
 * Derives per-observation deltas from cumulative counters for one session.
 * A missing cumulative field stays missing in the delta (never inferred as
 * zero). A regressing counter marks a reset: the observation yields no delta
 * and later observations measure from the new baseline.
 */
export class CumulativeUsageTracker {
  private readonly baseline = new Map<keyof TaskCostTokenUsage, number>();

  next(cumulative: Partial<TaskCostTokenUsage>): CumulativeDeltaResult {
    let reset = false;
    for (const field of TASK_COST_TOKEN_FIELDS) {
      const current = cumulative[field];
      const prior = this.baseline.get(field);
      if (
        typeof current === 'number' &&
        prior !== undefined &&
        current < prior
      ) {
        reset = true;
        break;
      }
    }

    const usage: Partial<TaskCostTokenUsage> = {};
    for (const field of TASK_COST_TOKEN_FIELDS) {
      const current = cumulative[field];
      if (typeof current !== 'number') {
        usage[field] = null;
        continue;
      }
      const prior = this.baseline.get(field);
      usage[field] = reset ? null : current - (prior ?? 0);
      this.baseline.set(field, current);
    }
    return { usage, reset };
  }
}
