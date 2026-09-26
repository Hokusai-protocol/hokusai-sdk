/**
 * Shared types for the opt-in cost source adapters.
 *
 * Adapters translate provider-specific session telemetry (Claude Code JSONL,
 * Codex rollouts, harness-emitted events) into `TaskCostEventV1` records via
 * `@hokusai/costs`. Every adapter enforces:
 *
 * - **Boundary-only correlation.** Callers supply the exact task id, the
 *   allowed session ids, and an inclusive UTC time window. Adapters never
 *   guess by newest-file selection, path heuristics, or Wavemill metadata.
 * - **Allow-list projection.** Parsers keep only the numeric usage counters,
 *   session/turn identifiers, model strings, and observation timestamps. Raw
 *   transcript payloads, prompts, tool text, filesystem paths, and account
 *   identifiers never leave parsing.
 * - **Count-only diagnostics.** Adapters return diagnostics as
 *   `{ code, count }` records. Nothing free-text and nothing derived from raw
 *   input crosses the boundary.
 *
 * @module sources/types
 */

import type { TaskCostEventV1, TaskCostSummaryV1 } from '@hokusai/core';

/**
 * Explicit task boundary supplied by the caller. Any record not matching every
 * field is filtered out with a `record_out_of_boundary` diagnostic; no
 * heuristic fallback is ever consulted.
 */
export interface TaskBoundary {
  /** Hokusai task id every emitted event must carry. */
  taskId: string;
  /** Session identifiers the caller pre-attributed to `taskId`. Non-empty. */
  allowedSessionIds: readonly string[];
  /** Inclusive UTC start of the window (ISO-8601). */
  startAt: string;
  /** Inclusive UTC end of the window (ISO-8601). */
  endAt: string;
}

/**
 * Source-diagnostic codes. Kept intentionally coarse: adapters report how many
 * rows fell into each bucket without revealing which rows, which files, or
 * what they contained.
 */
export const SOURCE_DIAGNOSTIC_CODES = [
  /** A line was not valid JSON or exceeded the line length cap. */
  'malformed_json',
  /** A row was well-formed JSON but did not match a recognized schema. */
  'unrecognized_row',
  /** A row carried a schema/format version this adapter does not support. */
  'unsupported_version',
  /** A row lacked the identifiers or timestamps needed to route it. */
  'missing_required_field',
  /** A row's usage counters were unparseable or non-finite. */
  'invalid_usage',
  /** A row's session id or timestamp fell outside the caller boundary. */
  'record_out_of_boundary',
  /** A row was a duplicate of an already-observed identity. */
  'duplicate_record',
  /** A cumulative counter regressed or reset; the baseline was rearmed. */
  'cumulative_counter_reset',
  /** A file could not be opened or read. */
  'unreadable_file',
  /** The line length or file size cap was reached; input was truncated. */
  'input_truncated',
  /** A model id lacked a built-in or override price; usage was still counted. */
  'unpriced_model',
] as const;
export type SourceDiagnosticCode = (typeof SOURCE_DIAGNOSTIC_CODES)[number];

/** Aggregated count of rows that hit a given code. */
export interface SourceDiagnostic {
  code: SourceDiagnosticCode;
  count: number;
}

/**
 * Common result shape returned by every source adapter. The caller decides
 * whether to consume events, ledger snapshots, or the summary; diagnostics are
 * always available for observability.
 */
export interface TaskCostSourceResult<
  Event = TaskCostEventV1,
  Summary = TaskCostSummaryV1,
> {
  events: readonly Event[];
  diagnostics: readonly SourceDiagnostic[];
  /** `null` when no event survived the boundary filter. */
  summary: Summary | null;
}
