/**
 * Shared types for the opt-in task-cost source adapters (HOK-3070).
 *
 * Adapters turn raw harness telemetry (Claude Code transcripts, Codex
 * rollouts, or already-normalized harness records) into friendly
 * `IngestUsageInput` rows for `createTaskCostEngine`. Correlation is always
 * driven by an explicit, caller-supplied {@link TaskCostBoundaryV1} — never
 * by newest-file heuristics or Wavemill branch/stage/eval joins.
 *
 * Source diagnostics are count-only by construction: no code path can carry a
 * path, prompt, transcript excerpt, or account identifier into a diagnostic.
 *
 * @module sources/types
 */

import type { TaskCostEventV1 } from '@hokusai/core';
import type { IngestUsageInput } from '../engine.js';

/**
 * The explicit task boundary an adapter correlates against. All three parts
 * are required: the task, the sessions the caller attributes to it, and an
 * inclusive UTC time window. Rows outside the boundary are counted and
 * dropped, never guessed back in — this is what keeps concurrent tasks and
 * resumed sessions from cross-charging.
 */
export interface TaskCostBoundaryV1 {
  /** Boundary contract version; always `1` for this shape. */
  boundaryVersion: 1;
  /** Task every accepted event is attributed to. */
  taskId: string;
  /** Session ids the caller attributes to the task. Non-empty. */
  sessionIds: readonly string[];
  /** Inclusive ISO-8601 UTC start of the attribution window. */
  startedAt: string;
  /** Inclusive ISO-8601 UTC end of the attribution window. */
  endedAt: string;
}

/**
 * Closed set of count-only source diagnostic codes. These describe why source
 * rows were skipped or degraded; they intentionally live *outside* the ledger
 * contract (`TaskCostDiagnosticCode`) — only compatible codes such as
 * `invalid_token_usage` are mapped onto emitted events.
 */
export const TASK_COST_SOURCE_DIAGNOSTIC_CODES = [
  /** A line was not valid JSON or not a JSON object. */
  'malformed_line',
  /** A line exceeded the parser's length bound. */
  'oversized_line',
  /** Input had more lines than the parser's bound; the rest were skipped. */
  'truncated_input',
  /** A usage row carried no resolvable session id. */
  'missing_session_id',
  /** A row's session is not in the boundary's session set. */
  'session_not_in_boundary',
  /** An event-source record names a different task than the boundary. */
  'foreign_task',
  /** A usage row carried no parseable timestamp, so it cannot be correlated. */
  'missing_timestamp',
  /** A row's timestamp falls outside the boundary window. */
  'outside_time_window',
  /** A row that should carry usage carried none. */
  'missing_usage',
  /** A present usage or cost field was malformed and treated as missing. */
  'invalid_usage_value',
  /** A row repeated an already-seen identity (streamed/resumed duplicate). */
  'duplicate_row',
  /** A cumulative counter regressed; the observation was skipped. */
  'cumulative_counter_reset',
  /** An event-source record was not a usable record shape. */
  'invalid_record',
  /** A file or directory could not be read. */
  'unreadable_file',
  /** A file exceeded the discovery size bound and was skipped. */
  'oversized_file',
] as const;
export type TaskCostSourceDiagnosticCode =
  (typeof TASK_COST_SOURCE_DIAGNOSTIC_CODES)[number];

/** Count per diagnostic code. Absent code means zero occurrences. */
export type TaskCostSourceDiagnostics = Partial<
  Record<TaskCostSourceDiagnosticCode, number>
>;

/** Increment one diagnostic counter in place. */
export function countDiagnostic(
  diagnostics: TaskCostSourceDiagnostics,
  code: TaskCostSourceDiagnosticCode,
  by = 1,
): void {
  diagnostics[code] = (diagnostics[code] ?? 0) + by;
}

/**
 * What one adapter run produced. File/session adapters emit friendly
 * `IngestUsageInput` rows; the event-source adapter may also pass through
 * pre-built `TaskCostEventV1` records.
 */
export interface TaskCostSourceResult<
  TInput = IngestUsageInput | TaskCostEventV1,
> {
  /** Normalized records ready for `TaskCostEngine.ingestMany`. */
  inputs: readonly TInput[];
  /** Count-only availability diagnostics. Never enter ledger output. */
  diagnostics: TaskCostSourceDiagnostics;
  /** Distinct harness versions observed on accepted rows, in first-seen order. */
  sourceVersions: readonly string[];
}
