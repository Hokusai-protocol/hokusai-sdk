/**
 * Bounded, fail-soft JSONL parsing. Line by line so a bad row cannot corrupt
 * the whole file; caps on line length and line count protect against
 * pathological inputs.
 *
 * @module sources/jsonl
 */

import type { SourceDiagnosticCode } from './types.js';

/** Hard defaults that keep pathological telemetry from exhausting memory. */
export const DEFAULT_MAX_LINE_BYTES = 1_048_576; // 1 MiB
export const DEFAULT_MAX_LINES = 200_000;

export interface JsonlParseOptions {
  maxLineBytes?: number;
  maxLines?: number;
}

export interface JsonlDiagnosticCount {
  code: SourceDiagnosticCode;
  count: number;
}

export interface JsonlParseResult {
  /** One parsed object per accepted line, in source order. */
  rows: readonly Record<string, unknown>[];
  /** Diagnostic counts emitted while parsing (malformed lines, truncation). */
  diagnostics: readonly JsonlDiagnosticCount[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a raw JSONL blob into a list of plain objects. Never throws.
 * Non-object payloads (numbers, arrays, `null`) and malformed lines increment
 * `malformed_json`; if the total line count exceeds the cap the tail is
 * dropped with `input_truncated`.
 */
export function parseJsonl(
  text: string,
  options: JsonlParseOptions = {},
): JsonlParseResult {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const rows: Record<string, unknown>[] = [];
  const counts = new Map<SourceDiagnosticCode, number>();
  const bump = (code: SourceDiagnosticCode): void => {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  };

  const lines = text.split('\n');
  let seen = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) continue;
    seen += 1;
    if (seen > maxLines) {
      bump('input_truncated');
      continue;
    }
    if (line.length > maxLineBytes) {
      bump('input_truncated');
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      bump('malformed_json');
      continue;
    }
    if (!isPlainObject(parsed)) {
      bump('malformed_json');
      continue;
    }
    rows.push(parsed);
  }
  const diagnostics: JsonlDiagnosticCount[] = [];
  for (const [code, count] of counts) diagnostics.push({ code, count });
  return { rows, diagnostics };
}
