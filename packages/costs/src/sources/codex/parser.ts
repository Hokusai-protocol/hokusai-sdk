/**
 * Codex rollout JSONL parser. Understands the row kinds that carry the
 * information the cost pipeline needs — `session_meta`, `turn_context`, and
 * `token_count` — and rejects everything else without diagnosing it.
 *
 * Codex nests details under `payload`/`info` in different releases; recent
 * rollouts additionally wrap runtime events as `{type: 'event_msg', payload:
 * {type, ...}}`. The parser accepts every shape but never exports free-text
 * fields.
 *
 * @module sources/codex/parser
 */

import { readNonNegativeInt, readString, readTimestamp } from '../sanitize.js';

/** One of the three row kinds the adapter cares about. */
export type CodexRowKind = 'session_meta' | 'turn_context' | 'token_count';

export interface CodexSessionMetaRecord {
  kind: 'session_meta';
  sessionId: string;
  observedAt: string;
}

export interface CodexTurnContextRecord {
  kind: 'turn_context';
  observedAt: string;
  model: string;
}

export interface CodexTokenCountRecord {
  kind: 'token_count';
  observedAt: string;
  /** Per-turn delta when the source shipped `last_token_usage`. */
  last: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    reasoning_tokens: number | null;
  } | null;
  /** Cumulative counters (`total_token_usage`), when present. */
  total: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    reasoning_tokens: number | null;
  } | null;
}

export type CodexRecord =
  | CodexSessionMetaRecord
  | CodexTurnContextRecord
  | CodexTokenCountRecord;

export type CodexRejectReason =
  | 'unrecognized_row'
  | 'missing_required_field'
  | 'invalid_usage';

export type CodexParseOutcome =
  | { ok: true; record: CodexRecord }
  | { ok: false; reason: CodexRejectReason };

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readTokenUsage(
  raw: Record<string, unknown> | undefined,
): CodexTokenCountRecord['total'] {
  if (raw === undefined) return null;
  return {
    input_tokens: readNonNegativeInt(raw['input_tokens']),
    output_tokens: readNonNegativeInt(raw['output_tokens']),
    // Codex reports the cached-input subset separately.
    cache_read_tokens: readNonNegativeInt(raw['cached_input_tokens']),
    reasoning_tokens: readNonNegativeInt(raw['reasoning_output_tokens']),
  };
}

function isEmptyUsage(
  usage: CodexTokenCountRecord['total'] | CodexTokenCountRecord['last'],
): boolean {
  if (usage === null) return true;
  return (
    usage.input_tokens === null &&
    usage.output_tokens === null &&
    usage.cache_read_tokens === null &&
    usage.reasoning_tokens === null
  );
}

/**
 * Parse one Codex rollout row into a normalized record, or classify why the
 * row was ignored. The parser is version-tolerant: fields it does not
 * recognize are ignored.
 */
export function parseCodexRow(row: Record<string, unknown>): CodexParseOutcome {
  const outerType = readString(row['type']);
  const outerPayload = readObject(row['payload']);
  // Codex rollouts wrap runtime events as `{type: 'event_msg', payload: {type: '...', ...}}`.
  // Unwrap so the row shape matches the older bare-row form used by tests.
  const type =
    outerType === 'event_msg' && outerPayload !== undefined
      ? (readString(outerPayload['type']) ?? outerType)
      : outerType;
  if (
    type !== 'session_meta' &&
    type !== 'turn_context' &&
    type !== 'token_count'
  ) {
    // Other Codex rows (agent_message, tool_call, …) are silently ignored;
    // they carry payloads the adapter must not read.
    return { ok: false, reason: 'unrecognized_row' };
  }

  const observedAt = readTimestamp(row['timestamp']);
  if (observedAt === undefined) {
    return { ok: false, reason: 'missing_required_field' };
  }

  const payload = outerPayload;

  if (type === 'session_meta') {
    // `session_meta` may nest the session id under `payload` (newer rollouts)
    // or place it at the top level (older internal captures). Read from
    // whichever is present.
    const sessionId = readString(payload?.['id']) ?? readString(row['id']);
    if (sessionId === undefined) {
      return { ok: false, reason: 'missing_required_field' };
    }
    return {
      ok: true,
      record: { kind: 'session_meta', sessionId, observedAt },
    };
  }

  if (type === 'turn_context') {
    const model = readString(payload?.['model']) ?? readString(row['model']);
    if (model === undefined) {
      return { ok: false, reason: 'missing_required_field' };
    }
    return { ok: true, record: { kind: 'turn_context', observedAt, model } };
  }

  // `token_count` — accept either `payload.info` or `info` at the row top,
  // and either `event_msg` wrappers or bare rows.
  const info =
    readObject(payload?.['info']) ??
    readObject(row['info']) ??
    readObject(payload);
  if (info === undefined) {
    return { ok: false, reason: 'missing_required_field' };
  }
  const total = readTokenUsage(readObject(info['total_token_usage']));
  const last = readTokenUsage(readObject(info['last_token_usage']));
  if (isEmptyUsage(total) && isEmptyUsage(last)) {
    return { ok: false, reason: 'invalid_usage' };
  }
  return {
    ok: true,
    record: {
      kind: 'token_count',
      observedAt,
      last: isEmptyUsage(last) ? null : last,
      total: isEmptyUsage(total) ? null : total,
    },
  };
}
