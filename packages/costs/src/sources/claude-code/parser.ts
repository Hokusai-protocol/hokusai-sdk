/**
 * Claude Code JSONL parser. Consumes assistant rows only and projects them
 * onto an allow-listed normalized record before anything else in the pipeline
 * gets to see them.
 *
 * The Claude Code transcript format ships one JSON object per line, keyed by
 * `type`. Only `assistant` rows carry model usage; every other row type is
 * ignored. Free-text fields (`content`, prompts, tool arguments, file paths)
 * are never read from and cannot leave this module.
 *
 * @module sources/claude-code/parser
 */

import {
  readNonNegativeInt,
  readNonNegativeNumber,
  readString,
  readTimestamp,
} from '../sanitize.js';

/**
 * Normalized Claude Code assistant row. Every field is either a bounded string
 * identifier, a numeric counter, or a timestamp — no free-text payload.
 */
export interface ClaudeCodeAssistantRecord {
  /** Anthropic message id (`message.id`); dedupe key across files. */
  messageId: string;
  /** Session id (`sessionId`). */
  sessionId: string;
  /** Turn identifier: uuid of the assistant row. */
  turnId: string;
  /** ISO-8601 observation time. */
  observedAt: string;
  /** Normalized model id (raw provider label — the engine normalizes it). */
  model: string;
  /** Optional request id, used only as a secondary dedupe hint. */
  requestId?: string;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    reasoning_tokens: number | null;
  };
  /** Legacy `costUSD` when the source shipped one (provider-reported charge). */
  actualCostUsd: number | null;
}

/** Reason a candidate row was rejected. */
export type ClaudeCodeRejectReason =
  | 'unrecognized_row'
  | 'missing_required_field'
  | 'invalid_usage';

export type ClaudeCodeParseOutcome =
  | { ok: true; record: ClaudeCodeAssistantRecord }
  | { ok: false; reason: ClaudeCodeRejectReason };

function readUsage(
  raw: Record<string, unknown> | undefined,
): ClaudeCodeAssistantRecord['usage'] | null {
  if (raw === undefined) return null;
  const input = readNonNegativeInt(raw['input_tokens']);
  const output = readNonNegativeInt(raw['output_tokens']);
  const cacheRead = readNonNegativeInt(raw['cache_read_input_tokens']);
  const cacheWrite = readNonNegativeInt(raw['cache_creation_input_tokens']);
  // Any counter present but malformed disqualifies the row.
  if (
    (raw['input_tokens'] !== undefined && input === null) ||
    (raw['output_tokens'] !== undefined && output === null) ||
    (raw['cache_read_input_tokens'] !== undefined && cacheRead === null) ||
    (raw['cache_creation_input_tokens'] !== undefined && cacheWrite === null)
  ) {
    return null;
  }
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    // Claude Code folds thinking tokens into `output_tokens` already; the
    // engine's billableOutputTokens rule matches this by leaving reasoning
    // tokens `null` for claude-code events.
    reasoning_tokens: null,
  };
}

/**
 * Parse one JSONL row into a normalized assistant record, or classify why the
 * row was ignored. Only `type: "assistant"` rows are considered.
 */
export function parseClaudeCodeRow(
  row: Record<string, unknown>,
): ClaudeCodeParseOutcome {
  const type = readString(row['type']);
  if (type !== 'assistant') {
    // Non-assistant transcript rows (user, tool_use, summary, …) carry no
    // usage and are silently ignored — not diagnosed.
    return { ok: false, reason: 'unrecognized_row' };
  }
  const message =
    typeof row['message'] === 'object' && row['message'] !== null
      ? (row['message'] as Record<string, unknown>)
      : undefined;
  const messageId = message ? readString(message['id']) : undefined;
  const sessionId = readString(row['sessionId']);
  const turnId = readString(row['uuid']);
  const observedAt = readTimestamp(row['timestamp']);
  const model = message ? readString(message['model']) : undefined;

  if (!messageId || !sessionId || !turnId || !observedAt || !model) {
    return { ok: false, reason: 'missing_required_field' };
  }

  const usageRaw =
    message && typeof message['usage'] === 'object' && message['usage'] !== null
      ? (message['usage'] as Record<string, unknown>)
      : undefined;
  const usage = readUsage(usageRaw);
  if (usage === null) {
    return { ok: false, reason: 'invalid_usage' };
  }

  const actualCostUsd = readNonNegativeNumber(row['costUSD']);
  const requestId = readString(row['requestId']);

  return {
    ok: true,
    record: {
      messageId,
      sessionId,
      turnId,
      observedAt,
      model,
      ...(requestId !== undefined ? { requestId } : {}),
      usage,
      actualCostUsd,
    },
  };
}
