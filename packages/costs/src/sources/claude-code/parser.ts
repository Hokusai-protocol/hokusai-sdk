/**
 * Defensive, versioned parser for Claude Code session transcript JSONL.
 *
 * Only `type: 'assistant'` rows are considered; every other row (user
 * prompts, tool results, summaries) is skipped without ever reading its
 * content. From assistant rows, only the allow-listed usage/identity fields
 * below are projected out — `cwd`, `gitBranch`, message content, and any
 * account attribute have no code path into the output.
 *
 * The transcript format is officially internal/unstable, so every field is
 * optional: a missing or malformed field degrades to `null` plus a count-only
 * diagnostic, never a throw.
 *
 * @module sources/claude-code/parser
 */

import type { TaskCostTokenUsage } from '@hokusai/core';
import { parseJsonlObjects, type ParseJsonlOptions } from '../jsonl.js';
import {
  asRecord,
  countOrNull,
  idOrNull,
  isPresent,
  modelOrNull,
  timestampOrNull,
  usdOrNull,
  versionOrNull,
} from '../sanitize.js';
import { countDiagnostic, type TaskCostSourceDiagnostics } from './../types.js';

/** Parsing contract implemented by this parser (`provider_contract_version`). */
export const CLAUDE_CODE_PROVIDER_CONTRACT_VERSION = 'claude-code/1';

/** One normalized assistant turn projected from a transcript row. */
export interface ClaudeCodeUsageRow {
  sessionId: string | null;
  /**
   * Stable identity for dedupe and `event_id`: the API message id when
   * present (streamed rows repeat it), else the entry uuid.
   */
  eventKey: string | null;
  turnId: string | null;
  observedAt: string | null;
  observedMs: number | null;
  observedModel: string;
  usage: Partial<TaskCostTokenUsage>;
  /** A present usage/cost field was malformed and nulled. */
  usageInvalid: boolean;
  isSubagent: boolean | undefined;
  /** Legacy per-turn `costUSD` (provider-reported), when present. */
  actualCostUsd: number | null;
  harnessVersion: string | null;
}

function projectCount(
  raw: unknown,
  row: { usageInvalid: boolean },
): number | null {
  const value = countOrNull(raw);
  if (value === null && isPresent(raw)) row.usageInvalid = true;
  return value;
}

/**
 * Parse one transcript's JSONL content into normalized usage rows.
 * Diagnostics accumulate counts only.
 */
export function parseClaudeCodeTranscript(
  content: string,
  diagnostics: TaskCostSourceDiagnostics,
  parseOptions?: ParseJsonlOptions,
): ClaudeCodeUsageRow[] {
  const rows: ClaudeCodeUsageRow[] = [];
  for (const entry of parseJsonlObjects(content, diagnostics, parseOptions)) {
    if (entry.type !== 'assistant') continue;

    const message = asRecord(entry.message);
    const usage = message === null ? null : asRecord(message.usage);
    if (message === null || usage === null) {
      countDiagnostic(diagnostics, 'missing_usage');
      continue;
    }

    const row: ClaudeCodeUsageRow = {
      sessionId: idOrNull(entry.sessionId),
      eventKey: idOrNull(message.id) ?? idOrNull(entry.uuid),
      turnId: idOrNull(entry.uuid),
      observedAt: null,
      observedMs: null,
      observedModel: modelOrNull(message.model) ?? 'unknown',
      usage: {},
      usageInvalid: false,
      isSubagent:
        typeof entry.isSidechain === 'boolean' ? entry.isSidechain : undefined,
      actualCostUsd: null,
      harnessVersion: versionOrNull(entry.version),
    };

    const timestamp = timestampOrNull(entry.timestamp);
    if (timestamp !== null) {
      row.observedAt = timestamp.iso;
      row.observedMs = timestamp.ms;
    }

    const outputDetails = asRecord(usage.output_tokens_details);
    row.usage = {
      input_tokens: projectCount(usage.input_tokens, row),
      output_tokens: projectCount(usage.output_tokens, row),
      cache_read_tokens: projectCount(usage.cache_read_input_tokens, row),
      cache_write_tokens: projectCount(usage.cache_creation_input_tokens, row),
      reasoning_tokens:
        outputDetails === null
          ? null
          : projectCount(outputDetails.thinking_tokens, row),
    };

    const actual = usdOrNull(entry.costUSD);
    if (actual === null && isPresent(entry.costUSD)) row.usageInvalid = true;
    row.actualCostUsd = actual;

    if (row.usageInvalid) countDiagnostic(diagnostics, 'invalid_usage_value');
    rows.push(row);
  }
  return rows;
}
