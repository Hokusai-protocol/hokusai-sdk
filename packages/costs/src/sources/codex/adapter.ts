/**
 * Codex rollout adapter. Reads one or more Codex JSONL blobs, correlates each
 * blob's session id against the caller boundary, tracks per-session model
 * transitions from `turn_context`, and emits per-turn deltas — preferring
 * `last_token_usage` and falling back to cumulative baselines otherwise.
 *
 * @module sources/codex/adapter
 */

import type { HostPriceOverride } from '../../pricing-resolver.js';
import type { TaskCostEventV1, TaskCostSummaryV1 } from '@hokusai/core';
import { createTaskCostEngine } from '../../engine.js';
import {
  DiagnosticTally,
  buildBoundaryContext,
  cumulativeDelta,
  matchesBoundary,
  type CumulativeCounters,
} from '../correlation.js';
import { parseJsonl, type JsonlParseOptions } from '../jsonl.js';
import type {
  SourceDiagnostic,
  TaskBoundary,
  TaskCostSourceResult,
} from '../types.js';
import { parseCodexRow, type CodexRecord } from './parser.js';

export const CODEX_PROVIDER_CONTRACT_VERSION = 'codex/1';

export interface CodexAdapterInput {
  /** Raw Codex rollout JSONL blobs. */
  blobs: readonly string[];
  boundary: TaskBoundary;
  harnessVersion?: string;
  priceOverrides?: readonly HostPriceOverride[];
  pricingRevision?: string;
  jsonl?: JsonlParseOptions;
}

export type CodexAdapterResult = TaskCostSourceResult<
  TaskCostEventV1,
  TaskCostSummaryV1
>;

interface CodexFileParse {
  sessionId?: string;
  records: CodexRecord[];
}

function parseCodexBlob(
  blob: string,
  tally: DiagnosticTally,
  jsonl: JsonlParseOptions,
): CodexFileParse {
  const parsed = parseJsonl(blob, jsonl);
  for (const diag of parsed.diagnostics) tally.bump(diag.code, diag.count);
  const records: CodexRecord[] = [];
  let sessionId: string | undefined;
  for (const row of parsed.rows) {
    const outcome = parseCodexRow(row);
    if (!outcome.ok) {
      if (outcome.reason !== 'unrecognized_row') {
        tally.bump(outcome.reason);
      }
      continue;
    }
    if (outcome.record.kind === 'session_meta' && sessionId === undefined) {
      sessionId = outcome.record.sessionId;
    }
    records.push(outcome.record);
  }
  return { records, ...(sessionId !== undefined ? { sessionId } : {}) };
}

function emptyCounters(): CumulativeCounters {
  return {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
  };
}

export function runCodexAdapter(input: CodexAdapterInput): CodexAdapterResult {
  const boundary = buildBoundaryContext(input.boundary);
  const tally = new DiagnosticTally();
  const jsonl = input.jsonl ?? {};

  interface StagedTokenCount {
    sessionId: string;
    observedAt: string;
    observedAtMs: number;
    model: string;
    usageKind: 'delta';
    usage: CumulativeCounters;
    dedupeKey: string;
  }
  const staged: StagedTokenCount[] = [];
  const seenIdentities = new Set<string>();

  for (const blob of input.blobs) {
    const parsed = parseCodexBlob(blob, tally, jsonl);
    const sessionId = parsed.sessionId;
    if (sessionId === undefined) {
      tally.bump('missing_required_field');
      continue;
    }
    if (!boundary.allowedSessionIds.has(sessionId)) {
      // We know the entire file's session and it is outside the caller
      // boundary — every downstream row would be dropped, so count once.
      tally.bump('record_out_of_boundary');
      continue;
    }

    let currentModel: string | undefined;
    // The cumulative baseline tracks the source's own running totals and MUST
    // advance for every token_count row in this session, even ones outside
    // the caller's window. Otherwise, the first in-window
    // `total_token_usage`-only row after a skipped range is differenced
    // against a null baseline and attributes an earlier task's usage to this
    // one.
    const baseline = emptyCounters();

    const advanceBaseline = (total: CodexRecord & { kind: 'token_count' }) => {
      if (total.total === null) return;
      baseline.input_tokens = total.total.input_tokens;
      baseline.output_tokens = total.total.output_tokens;
      baseline.cache_read_tokens = total.total.cache_read_tokens;
      baseline.reasoning_tokens = total.total.reasoning_tokens;
    };

    for (const record of parsed.records) {
      if (record.kind === 'turn_context') {
        currentModel = record.model;
        continue;
      }
      if (record.kind !== 'token_count') continue;

      // Compute the delta and emission BEFORE advancing the baseline, so the
      // delta is against the prior state. Filtered rows advance the baseline
      // via `advanceBaseline` at the end of the branch.
      if (currentModel === undefined) {
        advanceBaseline(record);
        tally.bump('missing_required_field');
        continue;
      }
      if (!matchesBoundary(boundary, sessionId, record.observedAt)) {
        advanceBaseline(record);
        tally.bump('record_out_of_boundary');
        continue;
      }

      const dedupeKey = `${sessionId}:${record.observedAt}`;
      if (seenIdentities.has(dedupeKey)) {
        // Do NOT re-advance the baseline; the first observation already did.
        tally.bump('duplicate_record');
        continue;
      }
      seenIdentities.add(dedupeKey);

      let usage: CumulativeCounters;
      if (record.last !== null) {
        usage = {
          input_tokens: record.last.input_tokens,
          output_tokens: record.last.output_tokens,
          cache_read_tokens: record.last.cache_read_tokens,
          cache_write_tokens: null,
          reasoning_tokens: record.last.reasoning_tokens,
        };
        advanceBaseline(record);
      } else if (record.total !== null) {
        const cumulative: CumulativeCounters = {
          input_tokens: record.total.input_tokens,
          output_tokens: record.total.output_tokens,
          cache_read_tokens: record.total.cache_read_tokens,
          cache_write_tokens: null,
          reasoning_tokens: record.total.reasoning_tokens,
        };
        const step = cumulativeDelta(baseline, cumulative);
        usage = step.delta;
        if (step.reset) tally.bump('cumulative_counter_reset');
        advanceBaseline(record);
      } else {
        tally.bump('invalid_usage');
        continue;
      }

      staged.push({
        sessionId,
        observedAt: record.observedAt,
        observedAtMs: Date.parse(record.observedAt),
        model: currentModel,
        usageKind: 'delta',
        usage,
        dedupeKey,
      });
    }
  }

  staged.sort((a, b) => {
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    if (a.observedAtMs !== b.observedAtMs)
      return a.observedAtMs - b.observedAtMs;
    return a.dedupeKey < b.dedupeKey ? -1 : 1;
  });

  const engine = createTaskCostEngine({
    taskId: boundary.taskId,
    ...(input.priceOverrides !== undefined
      ? { priceOverrides: input.priceOverrides }
      : {}),
    ...(input.pricingRevision !== undefined
      ? { pricingRevision: input.pricingRevision }
      : {}),
  });

  const sequences = new Map<string, number>();
  for (const record of staged) {
    const nextSeq = (sequences.get(record.sessionId) ?? 0) + 1;
    sequences.set(record.sessionId, nextSeq);
    const eventId = `codex:${record.sessionId}:${record.observedAt}:${String(nextSeq).padStart(6, '0')}`;
    const result = engine.ingest({
      eventId,
      taskId: boundary.taskId,
      sessionId: record.sessionId,
      turnId: `${record.sessionId}-${String(nextSeq).padStart(6, '0')}`,
      sequence: nextSeq,
      harness: 'codex',
      ...(input.harnessVersion !== undefined
        ? { harnessVersion: input.harnessVersion }
        : {}),
      providerContractVersion: CODEX_PROVIDER_CONTRACT_VERSION,
      observedModel: record.model,
      usage: {
        input_tokens: record.usage.input_tokens,
        output_tokens: record.usage.output_tokens,
        cache_read_tokens: record.usage.cache_read_tokens,
        cache_write_tokens: null,
        reasoning_tokens: record.usage.reasoning_tokens,
      },
      usageKind: 'delta',
      observedAt: record.observedAt,
    });
    if (result.status === 'rejected') {
      tally.bump('invalid_usage');
    }
  }

  const events = engine.events();
  const diagnostics: SourceDiagnostic[] = tally.toArray();
  const summary = events.length > 0 ? engine.snapshot() : null;
  return { events, diagnostics, summary };
}
