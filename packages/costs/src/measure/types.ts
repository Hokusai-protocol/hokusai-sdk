/**
 * Public types for the drop-in task-cost API (`measureTask` /
 * `createTaskCostTracker`).
 *
 * The `TaskCostReport` is a camelCase SDK *view* over the snake_case wire
 * contract: every enum value is the contract's vocabulary, and the raw
 * validated `TaskCostSummaryV1[]` ride along in `summaries` for hosts that
 * persist or bridge the contract. Nothing here is a new wire schema.
 *
 * @module measure/types
 */

import type {
  TaskCostBasis,
  TaskCostCoverage,
  TaskCostDiagnosticCode,
  TaskCostEventV1,
  TaskCostHarness,
  TaskCostPriceTable,
  TaskCostPricingSource,
  TaskCostSource,
  TaskCostSummaryV1,
  TaskCostUsageKind,
} from '@hokusai/core';
import type { IngestUsageInput } from '../engine.js';
import type { TaskCostLedger } from '../ledger/index.js';
import type { HostPriceOverride } from '../pricing-resolver.js';
import type { TaskCostSourceDiagnosticCode } from '../sources/types.js';

/**
 * CamelCase token usage. `null` means "not reported" — missing counters are
 * never coerced to `0` anywhere in this package.
 */
export interface TaskCostUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Thinking tokens (Claude Code) / reasoning output tokens (Codex/OpenAI). */
  reasoningTokens: number | null;
}

/** How usage reached the tracker. Fixed report order. */
export const TASK_COST_CAPTURE_KINDS = [
  'events',
  'session-files',
  'manual',
] as const;
export type TaskCostCaptureKind = (typeof TASK_COST_CAPTURE_KINDS)[number];

/** One friendly usage observation for {@link TaskCostTracker.recordUsage}. */
export interface TaskUsageRecord {
  /** Model id as observed; matched against pricing via `normalizeModelId`. */
  model: string;
  /** Missing counters stay `null`, never `0`. */
  usage?: Partial<TaskCostUsage>;
  /** Overrides the tracker's default harness for this record. */
  harness?: TaskCostHarness;
  /**
   * Provider-reported charge in USD. `0` is a known-zero charge; absent/null
   * means "no charge reported". Wins over the local estimate when present.
   */
  providerCostUsd?: number | null;
  costBasis?: TaskCostBasis;
  /**
   * Stable event identity. Defaults to a per-tracker counter id; supply a
   * stable id when retries may re-emit the same observation, so replay
   * dedupe can collapse them.
   */
  eventId?: string;
  /** Defaults to the tracker's task id. */
  sessionId?: string;
  /** Defaults to the event id (one observation = one turn). */
  turnId?: string;
  /** ISO-8601 UTC string or `Date`. Defaults to the tracker clock's now. */
  occurredAt?: string | Date;
  /** `'delta'` (default) or `'cumulative'` running totals. */
  usageKind?: TaskCostUsageKind;
  isSubagent?: boolean;
  /** Marks this record as superseding a prior event (retry semantics). */
  replayOfEventId?: string;
}

export type RecordResult =
  | { status: 'accepted'; eventId: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'rejected'; reason: string };

/** Per-model / per-harness slice of the report. */
export interface TaskCostBreakdown {
  /** `null` unless every event in this slice resolved — never an undercount. */
  totalUsd: number | null;
  /** Provider-reported charges; a lower bound when partial. */
  actualUsd: number | null;
  /** Token-equivalent estimates; a lower bound when partial. */
  estimatedUsd: number | null;
  usage: TaskCostUsage;
  eventCount: number;
  turnCount: number;
  costSource: TaskCostSource;
  coverage: TaskCostCoverage;
}

export type TaskCostReportDiagnosticLevel = 'info' | 'warn' | 'error';

/**
 * Report-level diagnostic codes: every contract code and count-only source
 * code passes through under its own (snake_case) name, plus the tracker's
 * own codes below.
 */
export type TaskCostReportDiagnosticCode =
  | TaskCostDiagnosticCode
  | TaskCostSourceDiagnosticCode
  /** A `recordUsage`/`record` input was rejected; totals unchanged. */
  | 'invalid_usage'
  /** Nothing was captured; see the message for what automatic capture needs. */
  | 'no_usage_captured'
  /** A session file could not be read or was oversized (count only, no path). */
  | 'session_file_unreadable'
  /** A session-file line or event-source record was malformed and skipped. */
  | 'malformed_record'
  /** An event id was recorded more than once; later copies counted once. */
  | 'duplicate_event'
  /** An event/iterable source failed while collecting; the run's result wins. */
  | 'collection_failed'
  /** One engine's events could not be summarized (e.g. a replay cycle). */
  | 'aggregation_failed'
  /** The opt-in ledger flush failed; measurement output is unaffected. */
  | 'ledger_flush_failed';

export interface TaskCostReportDiagnostic {
  code: TaskCostReportDiagnosticCode;
  level: TaskCostReportDiagnosticLevel;
  message: string;
  /** Occurrences (events, lines, files — whatever the code counts). */
  count: number;
}

/**
 * The drop-in result: totals, attribution, provenance, coverage, and
 * diagnostics for one task. All enum values are the wire contract's; the raw
 * contract summaries ride along in {@link TaskCostReport.summaries}.
 */
export interface TaskCostReport {
  taskId: string;
  /** `null` unless EVERY captured event resolved a cost — never an undercount. */
  totalUsd: number | null;
  /** Provider-reported charges (lower bound if partial). */
  actualUsd: number | null;
  /** Token-equivalent local estimates (lower bound if partial). */
  estimatedUsd: number | null;
  byModel: Record<string, TaskCostBreakdown>;
  byHarness: Partial<Record<TaskCostHarness, TaskCostBreakdown>>;
  usage: TaskCostUsage;
  eventCount: number;
  turnCount: number;
  source: {
    /** provider_reported | local_estimate | mixed | none */
    cost: TaskCostSource;
    /** per_token_api | subscription | unknown */
    basis: TaskCostBasis;
    /** How usage reached the tracker, in fixed order. */
    capture: TaskCostCaptureKind[];
    /** Count only — file paths never enter the report. */
    sessionFileCount: number;
  };
  pricing: {
    source: TaskCostPricingSource;
    /** Latest price revision used, else `null` when nothing was table-priced. */
    revision: string | null;
    /** The revision date, else the built-in table's as-of date. */
    effectiveDate: string;
    /** All revisions used; >1 implies a `stale_pricing_revision` diagnostic. */
    revisions: string[];
    priceTables: TaskCostPriceTable[];
    /** As-of date of the built-in price table (`MODEL_PRICING_AS_OF`). */
    builtInTableAsOf: string;
    overrideCount: number;
    currency: 'USD';
  };
  coverage: {
    status: TaskCostCoverage;
    /** Contributing events that resolved a cost. */
    pricedEvents: number;
    unpricedEvents: number;
    /** Models with usage but no price, de-duplicated, first-seen order. */
    unknownModels: string[];
  };
  diagnostics: TaskCostReportDiagnostic[];
  /** Validated contract summaries, one per (harness, provider contract). */
  summaries: TaskCostSummaryV1[];
}

export interface LedgerFlushResult {
  appended: number;
  duplicates: number;
}

export interface TaskCostTrackerOptions {
  /**
   * Task id every event is attributed to. Defaults to a generated
   * `task-<n>` id. Validated against the contract id pattern at construction.
   */
  taskId?: string;
  /** Default harness stamped on `recordUsage` records. Default `'unknown'`. */
  harness?: TaskCostHarness;
  /**
   * Provider parsing-contract version for `recordUsage` records. Defaults to
   * the contract's registered version for the harness (`claude-code/1`, …),
   * else `<harness>/1`.
   */
  providerContractVersion?: string;
  /** Default cost basis for `recordUsage` records. Default `'per_token_api'`. */
  costBasis?: TaskCostBasis;
  /** Host price overrides; beat the built-in table. Validated eagerly. */
  priceOverrides?: readonly HostPriceOverride[];
  /** Revision stamped on rows priced from the built-in table. */
  pricingRevision?: string;
  /**
   * Opt-in persistence. Accepted events stay in memory until `flush()` (or
   * until `measureTask` finishes). Nothing is ever written by default.
   */
  ledger?: TaskCostLedger;
  /** Injectable clock for deterministic output. Defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface TaskCostTracker {
  readonly taskId: string;
  /** Record one friendly usage observation. Bad data rejects, never throws. */
  recordUsage(record: TaskUsageRecord): RecordResult;
  /**
   * Record an engine-shaped `IngestUsageInput` or a pre-built contract
   * `TaskCostEventV1` (adapter / event-source output). Bad data rejects.
   */
  record(input: IngestUsageInput | TaskCostEventV1): RecordResult;
  /** Build the report. Never throws; an empty tracker reports `unavailable`. */
  summary(): TaskCostReport;
  /** All accepted contract events, in ingest order. Frozen. */
  events(): readonly TaskCostEventV1[];
  /** Persist accepted-but-unpersisted events to the opt-in ledger. */
  flush(): Promise<LedgerFlushResult>;
  /** Drop all recorded state; equivalent to a brand-new tracker. */
  reset(): void;
}

/** A live usage emitter `measureTask` can subscribe to for the run. */
export type UsageEventEmitterLike =
  | {
      on(eventName: string, listener: (payload: unknown) => void): unknown;
      off(eventName: string, listener: (payload: unknown) => void): unknown;
    }
  | {
      addListener(
        eventName: string,
        listener: (payload: unknown) => void,
      ): unknown;
      removeListener(
        eventName: string,
        listener: (payload: unknown) => void,
      ): unknown;
    }
  | {
      addEventListener(
        eventName: string,
        listener: (payload: unknown) => void,
      ): unknown;
      removeEventListener(
        eventName: string,
        listener: (payload: unknown) => void,
      ): unknown;
    };

export type UsageEventSource =
  | UsageEventEmitterLike
  | Iterable<unknown>
  | AsyncIterable<unknown>;

/**
 * Session-file capture (Node only; loaded via dynamic `import()` so the
 * package root stays runtime-neutral). The explicit boundary is required:
 * task id + non-empty session ids + an inclusive time window — files are
 * never picked because they are "the newest".
 */
export interface SessionFilesOptions {
  harness: 'claude-code' | 'codex';
  /** Session ids attributed to the task; resolved after the run if a function. */
  sessionIds: readonly string[] | (() => readonly string[]);
  /** Explicit session file paths to read. */
  paths?: readonly string[];
  /** Directories to search (recursively) for `<sessionId>*.jsonl` files. */
  roots?: readonly string[];
  /**
   * Inclusive attribution window. Defaults to the run's `[start, end]`;
   * override it for files recorded earlier.
   */
  window?: { startedAt: string; endedAt: string };
  /** Skip files larger than this many bytes (default 64 MiB). */
  maxFileBytes?: number;
}

export interface MeasureTaskOptions extends TaskCostTrackerOptions {
  /**
   * Usage source: a live emitter (subscribed for the duration of `fn`) or an
   * (async) iterable consumed after `fn` settles.
   */
  events?: UsageEventSource;
  /** Emitter event name to subscribe to. Default `'usage'`. */
  eventName?: string;
  /**
   * Adapts a foreign payload into a {@link TaskUsageRecord} (or an
   * `IngestUsageInput` / `TaskCostEventV1`, which are routed to `record`).
   */
  mapEvent?: (payload: unknown) => unknown;
  sessionFiles?: SessionFilesOptions;
  /** Rejects with the abort reason before `fn` runs when already aborted. */
  signal?: AbortSignal;
}

export interface MeasureTaskResult<T> {
  result: T;
  cost: TaskCostReport;
}
