/**
 * Claude Code session adapter. Consumes one or more JSONL blobs, applies the
 * caller-supplied task boundary, deduplicates streamed and resumed message
 * identities across every input, and feeds normalized deltas to the shared
 * task cost engine.
 *
 * The adapter is pure JavaScript — no `node:fs`, no path resolution, no
 * network. Callers hand it raw text; a Node-only helper (`sources/node-fs.ts`)
 * is the only file-reader that ships with `@hokusai/costs`.
 *
 * @module sources/claude-code/adapter
 */

import type { HostPriceOverride } from '../../pricing-resolver.js';
import type { TaskCostEventV1, TaskCostSummaryV1 } from '@hokusai/core';
import { createTaskCostEngine } from '../../engine.js';
import {
  DiagnosticTally,
  buildBoundaryContext,
  matchesBoundary,
} from '../correlation.js';
import { parseJsonl, type JsonlParseOptions } from '../jsonl.js';
import type {
  SourceDiagnostic,
  TaskBoundary,
  TaskCostSourceResult,
} from '../types.js';
import { parseClaudeCodeRow } from './parser.js';

export const CLAUDE_CODE_PROVIDER_CONTRACT_VERSION = 'claude-code/1';

export interface ClaudeCodeAdapterInput {
  /** Raw JSONL blobs, one per source file. */
  blobs: readonly string[];
  /** The exact task boundary to correlate against. */
  boundary: TaskBoundary;
  /** Optional harness version stamped on emitted events. */
  harnessVersion?: string;
  /** Explicit host pricing overrides, forwarded to the engine. */
  priceOverrides?: readonly HostPriceOverride[];
  /** Pricing revision override, forwarded to the engine. */
  pricingRevision?: string;
  /** Bounded JSONL parsing knobs. */
  jsonl?: JsonlParseOptions;
}

export type ClaudeCodeAdapterResult = TaskCostSourceResult<
  TaskCostEventV1,
  TaskCostSummaryV1
>;

/**
 * Consume one or more Claude Code JSONL blobs and return the resulting cost
 * events, ledger summary, and per-code source diagnostics.
 */
export function runClaudeCodeAdapter(
  input: ClaudeCodeAdapterInput,
): ClaudeCodeAdapterResult {
  const boundary = buildBoundaryContext(input.boundary);
  const tally = new DiagnosticTally();
  const seenMessages = new Set<string>();

  interface StagedRecord {
    messageId: string;
    sessionId: string;
    turnId: string;
    observedAt: string;
    observedAtMs: number;
    model: string;
    usage: {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      reasoning_tokens: number | null;
    };
    actualCostUsd: number | null;
  }
  const staged: StagedRecord[] = [];

  for (const blob of input.blobs) {
    const parsed = parseJsonl(blob, input.jsonl ?? {});
    for (const diag of parsed.diagnostics) tally.bump(diag.code, diag.count);
    for (const row of parsed.rows) {
      const outcome = parseClaudeCodeRow(row);
      if (!outcome.ok) {
        if (outcome.reason !== 'unrecognized_row') {
          tally.bump(outcome.reason);
        }
        continue;
      }
      const record = outcome.record;
      if (!matchesBoundary(boundary, record.sessionId, record.observedAt)) {
        tally.bump('record_out_of_boundary');
        continue;
      }
      if (seenMessages.has(record.messageId)) {
        tally.bump('duplicate_record');
        continue;
      }
      seenMessages.add(record.messageId);
      staged.push({
        messageId: record.messageId,
        sessionId: record.sessionId,
        turnId: record.turnId,
        observedAt: record.observedAt,
        observedAtMs: Date.parse(record.observedAt),
        model: record.model,
        usage: record.usage,
        actualCostUsd: record.actualCostUsd,
      });
    }
  }

  // Assign a deterministic monotonic sequence per session, ordered by
  // observation time and then message id as a tie-breaker.
  staged.sort((a, b) => {
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    if (a.observedAtMs !== b.observedAtMs)
      return a.observedAtMs - b.observedAtMs;
    return a.messageId < b.messageId ? -1 : 1;
  });
  const sequences = new Map<string, number>();

  const engine = createTaskCostEngine({
    taskId: boundary.taskId,
    ...(input.priceOverrides !== undefined
      ? { priceOverrides: input.priceOverrides }
      : {}),
    ...(input.pricingRevision !== undefined
      ? { pricingRevision: input.pricingRevision }
      : {}),
  });

  for (const record of staged) {
    const nextSeq = (sequences.get(record.sessionId) ?? 0) + 1;
    sequences.set(record.sessionId, nextSeq);
    const result = engine.ingest({
      eventId: `claude-code:${record.messageId}`,
      taskId: boundary.taskId,
      sessionId: record.sessionId,
      turnId: record.turnId,
      sequence: nextSeq,
      harness: 'claude-code',
      ...(input.harnessVersion !== undefined
        ? { harnessVersion: input.harnessVersion }
        : {}),
      providerContractVersion: CLAUDE_CODE_PROVIDER_CONTRACT_VERSION,
      observedModel: record.model,
      usage: record.usage,
      usageKind: 'delta',
      ...(record.actualCostUsd !== null
        ? { actualCostUsd: record.actualCostUsd }
        : {}),
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
