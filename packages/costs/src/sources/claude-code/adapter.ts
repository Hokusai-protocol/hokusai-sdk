/**
 * Claude Code task-cost source adapter.
 *
 * Consumes raw session transcript contents (the caller reads the files — see
 * `@hokusai/costs/sources/node-fs` for an explicit-roots reader), correlates
 * assistant turns against an explicit task boundary, deduplicates streamed
 * and resumed message identities across all supplied files, and emits
 * friendly `IngestUsageInput` rows for `createTaskCostEngine`.
 *
 * @module sources/claude-code/adapter
 */

import type { IngestUsageInput } from '../../engine.js';
import { assembleInputs, type AcceptedUsageRow } from '../assemble.js';
import { inBoundaryWindow, resolveTaskBoundary } from '../correlation.js';
import type { ParseJsonlOptions } from '../jsonl.js';
import {
  countDiagnostic,
  type TaskCostBoundaryV1,
  type TaskCostSourceDiagnostics,
  type TaskCostSourceResult,
} from '../types.js';
import {
  CLAUDE_CODE_PROVIDER_CONTRACT_VERSION,
  parseClaudeCodeTranscript,
  type ClaudeCodeUsageRow,
} from './parser.js';

export interface ExtractClaudeCodeUsageOptions {
  /** Explicit task boundary; the only correlation signal used. */
  boundary: TaskCostBoundaryV1;
  /** Raw transcript JSONL contents, one per session file. Order-insensitive. */
  files: readonly string[];
  parseOptions?: ParseJsonlOptions;
}

/**
 * Extract normalized per-turn usage for one task from Claude Code
 * transcripts. Never throws on malformed input; a misconfigured boundary
 * throws `TypeError` (caller bug, not source noise).
 */
export function extractClaudeCodeUsage(
  options: ExtractClaudeCodeUsageOptions,
): TaskCostSourceResult<IngestUsageInput> {
  const boundary = resolveTaskBoundary(options.boundary);
  const diagnostics: TaskCostSourceDiagnostics = {};

  // Cross-file dedupe by message identity, last occurrence wins: streamed
  // rows repeat a message id with the final row carrying final usage, and a
  // resumed session copies its history into the new file verbatim.
  const byIdentity = new Map<string, ClaudeCodeUsageRow>();
  let synthetic = 0;
  for (const content of options.files) {
    for (const row of parseClaudeCodeTranscript(
      content,
      diagnostics,
      options.parseOptions,
    )) {
      if (row.sessionId === null) {
        countDiagnostic(diagnostics, 'missing_session_id');
        continue;
      }
      let key = row.eventKey;
      if (key === null) {
        synthetic += 1;
        key = `${row.sessionId}.row.${synthetic}`;
        row.eventKey = key;
      } else if (byIdentity.has(key)) {
        countDiagnostic(diagnostics, 'duplicate_row');
      }
      byIdentity.set(key, row);
    }
  }

  const accepted: AcceptedUsageRow[] = [];
  for (const [key, row] of byIdentity) {
    const sessionId = row.sessionId as string;
    if (!boundary.sessionIds.has(sessionId)) {
      countDiagnostic(diagnostics, 'session_not_in_boundary');
      continue;
    }
    if (row.observedMs === null || row.observedAt === null) {
      countDiagnostic(diagnostics, 'missing_timestamp');
      continue;
    }
    if (!inBoundaryWindow(boundary, row.observedMs)) {
      countDiagnostic(diagnostics, 'outside_time_window');
      continue;
    }
    accepted.push({
      eventId: key,
      sessionId,
      turnId: row.turnId ?? key,
      observedAt: row.observedAt,
      observedMs: row.observedMs,
      observedModel: row.observedModel,
      usage: row.usage,
      actualCostUsd: row.actualCostUsd,
      harnessVersion: row.harnessVersion,
      ...(row.isSubagent !== undefined ? { isSubagent: row.isSubagent } : {}),
      usageInvalid: row.usageInvalid,
    });
  }

  const { inputs, sourceVersions } = assembleInputs(
    boundary.taskId,
    'claude-code',
    CLAUDE_CODE_PROVIDER_CONTRACT_VERSION,
    accepted,
  );
  return { inputs, diagnostics, sourceVersions };
}
