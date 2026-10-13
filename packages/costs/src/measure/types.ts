/**
 * Public types for the drop-in measurement layer (`measureTask` /
 * `createTaskCostTracker`).
 *
 * The measure layer is a thin ergonomic façade over `createTaskCostEngine`:
 * friendly camelCase inputs in, a camelCase `TaskCostReport` presentation DTO
 * out. The snake_case wire contract (`TaskCostEventV1` /
 * `TaskCostSummaryV1`) in `@hokusai/core` is untouched; this layer never
 * re-implements pricing or aggregation semantics.
 *
 * One deliberate semantic difference from the contract summary:
 * `TaskCostReport.totalUsd` is the sum of every event's *resolved* cost
 * (`actual ?? estimated`) and is `null` only when zero events resolved — a
 * lower bound under partial coverage. `TaskCostSummaryV1.total_cost_usd` is
 * instead `null` on *any* pricing gap. Callers who need the strict contract
 * semantics should use `createTaskCostEngine().snapshot()` directly.
 *
 * @module measure/types
 */

import type { TaskCostHarness } from '@hokusai/core';
import type { TaskCostLedger } from '../ledger/ledger.js';
import type { HostPriceOverride } from '../pricing-resolver.js';
import type { TaskCostBoundaryV1 } from '../sources/types.js';

/**
 * Null-preserving token usage in camelCase. `null` means "not reported";
 * a number (including `0`) means "observed". Mirrors the contract's
 * snake_case `TaskCostTokenUsage`.
 */
export interface TokenUsage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
}

export const TOKEN_USAGE_FIELDS = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
] as const satisfies ReadonlyArray<keyof TokenUsage>;

/**
 * Stable measure-layer diagnostic codes. These are presentation-level
 * diagnostics (distinct from the contract's `TaskCostDiagnosticCode` enum and
 * the sources' count-only codes, both of which are mapped onto this
 * registry). Messages carry counts and field/model names only — never
 * prompts, paths, file contents, or account identity.
 */
export const MEASURE_DIAGNOSTIC_CODES = [
  /** Zero usage events were captured for the task. */
  'NO_USAGE_CAPTURED',
  /** A model had no price in the built-in table or host overrides. */
  'UNPRICED_MODEL',
  /** A session file could not be read; measurement continued without it. */
  'SESSION_FILE_UNREADABLE',
  /** Lines/records were malformed, oversized, or truncated and skipped. */
  'MALFORMED_RECORD',
  /** Usage counters were present but invalid; the record was skipped. */
  'INVALID_USAGE',
  /** A record was not a usable record shape or lacked required identity. */
  'INVALID_RECORD',
  /** A record fell outside the task boundary (session, window, or task). */
  'RECORD_OUT_OF_BOUNDARY',
  /** A record repeated an already-seen identity and was deduplicated. */
  'DUPLICATE_RECORD',
  /** A cumulative counter reset was detected and re-baselined. */
  'COUNTER_RESET',
  /** An opt-in ledger write failed; the in-memory report is unaffected. */
  'LEDGER_WRITE_FAILED',
] as const;
export type MeasureDiagnosticCode = (typeof MEASURE_DIAGNOSTIC_CODES)[number];

/** One measure-layer diagnostic entry on a {@link TaskCostReport}. */
export interface CostDiagnostic {
  code: MeasureDiagnosticCode;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Coverage of the records that contributed to a {@link TaskCostReport}. */
export interface CostCoverage {
  /**
   * `none` when zero records priced (including zero records captured),
   * `partial` when some records are unpriced or any usage counter is
   * missing, `complete` otherwise.
   */
  status: 'complete' | 'partial' | 'none';
  /** Records whose cost resolved (provider-reported or locally estimated). */
  pricedRecords: number;
  /** Records with no resolvable cost. */
  unpricedRecords: number;
  /** Distinct models among unpriced records, in first-seen order. */
  unknownModels: string[];
}

/** Per-model / per-harness cost + usage attribution. */
export interface CostAttributionEntry {
  /** Sum of resolved costs for this group; `null` when none resolved. */
  usd: number | null;
  /** Null-preserving usage sum for this group. */
  usage: TokenUsage;
}

/**
 * The camelCase presentation report produced by the measure layer.
 *
 * `totalUsd` sums each record's resolved cost (`actual ?? estimated`); it is
 * a lower bound when `coverage.status` is `'partial'` and `null` only when
 * nothing resolved. See the module docs for how this deliberately differs
 * from `TaskCostSummaryV1.total_cost_usd`.
 */
export interface TaskCostReport {
  taskId: string;
  totalUsd: number | null;
  byModel: Record<string, CostAttributionEntry>;
  /** Grouped by the caller-facing harness label (see tracker docs). */
  byHarness: Record<string, CostAttributionEntry>;
  /** Null-preserving usage total across all records. */
  usage: TokenUsage;
  source: {
    kind: 'session-file' | 'events' | 'manual';
    /** Caller-facing harness label (`'mixed'` when several contributed). */
    harness: string;
    /** Caller-supplied session file paths, verbatim. Never file contents. */
    files?: string[];
  };
  pricing: {
    /** Price table(s) + revision(s) that priced this report. */
    snapshotId: string;
    /** `as_of` date of the price data (`MODEL_PRICING_AS_OF` by default). */
    effectiveDate: string;
    currency: 'USD';
  };
  coverage: CostCoverage;
  diagnostics: CostDiagnostic[];
}

/** Result of {@link import('./measure-task.js').measureTask}. */
export interface MeasureTaskResult<T> {
  result: T;
  cost: TaskCostReport;
}

/** Minimal manual usage record for `tracker.recordUsage`. */
export interface RecordUsageInput {
  /** Model id as observed (provider prefixes are normalized away). */
  model: string;
  /**
   * Harness label. Any label is accepted: non-contract labels (for example
   * `'custom'`) are retained for `byHarness` grouping and mapped to
   * `'unknown'` on the underlying contract event.
   */
  harness?: TaskCostHarness | (string & {});
  /** Partial camelCase usage; missing counters stay `null`, never `0`. */
  usage?: Partial<TokenUsage>;
  /** Provider-reported charge. `0` is known-zero; absent/null is missing. */
  actualCostUsd?: number | null;
  /** Caller-supplied estimate; when present the engine skips its own pricing. */
  estimatedCostUsd?: number | null;
  /** Observation time; defaults to the tracker's `now()`. */
  observedAt?: string | Date;
}

/** Full manual record for `tracker.record`; identity fields are generated when absent. */
export interface TrackerRecordInput extends RecordUsageInput {
  /** Idempotency key; a repeated id is deduplicated, not double-counted. */
  eventId?: string;
  sessionId?: string;
  turnId?: string;
}

export interface TaskCostTrackerOptions {
  /** Contract-safe task id; generated when absent. */
  taskId?: string;
  /** Default harness label for records that do not name one. */
  harness?: TaskCostHarness | (string & {});
  /** Clock used for generated `observedAt` timestamps. */
  now?: () => Date;
  /** Host price overrides that beat the built-in table. */
  priceOverrides?: readonly HostPriceOverride[];
  /** Revision stamped on rows priced from the built-in table. */
  pricingRevision?: string;
}

/**
 * Manual usage tracker: record usage as it happens, read a
 * {@link TaskCostReport} at any time. Composes `createTaskCostEngine`
 * internally; no pricing or aggregation is re-implemented here.
 */
export interface TaskCostTracker {
  readonly taskId: string;
  /** Record one usage event. Throws `MeasureError` only for non-object input. */
  record(event: TrackerRecordInput): void;
  /** Ergonomic alias of {@link record} for the minimal shape. */
  recordUsage(input: RecordUsageInput): void;
  /** Build the report for everything recorded so far. Never throws. */
  summary(): TaskCostReport;
  /** Drop all recorded usage and diagnostics. */
  reset(): void;
}

export interface MeasureTaskOptions {
  /** Contract-safe task id; generated when absent. */
  taskId?: string;
  /**
   * Harness that produced the usage. Required (as `'claude-code'` or
   * `'codex'`) when `sessionFile` is set; otherwise a free-form label.
   */
  harness?: TaskCostHarness | (string & {});
  /** Session transcript/rollout path(s) to collect usage from (Node only). */
  sessionFile?: string | string[];
  /** Already-normalized usage records (friendly or prebuilt contract events). */
  events?: Iterable<unknown> | AsyncIterable<unknown>;
  /**
   * Advanced escape hatch: explicit task boundary. When absent, the boundary
   * is derived from the supplied files/records themselves (the caller naming
   * a file attributes all of its sessions to this task).
   */
  boundary?: TaskCostBoundaryV1;
  /** Opt-in persistence: also write priced records through this ledger. */
  ledger?: TaskCostLedger;
  pricing?: {
    priceOverrides?: readonly HostPriceOverride[];
    pricingRevision?: string;
  };
  /** Clock used for generated timestamps. */
  now?: () => Date;
  /** Already-aborted signals reject with an `AbortError` before `fn` runs. */
  signal?: AbortSignal;
}

export type MeasureErrorCode = 'INVALID_ARGUMENT';

/** Programmer-error class for the measure layer (stable `code`, like `TaskCostLedgerError`). */
export class MeasureError extends Error {
  readonly code: MeasureErrorCode;

  constructor(code: MeasureErrorCode, message: string) {
    super(message);
    this.name = 'MeasureError';
    this.code = code;
  }
}

/** Empty camelCase usage (every counter "not reported"). */
export function emptyUsage(): TokenUsage {
  return {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  };
}
