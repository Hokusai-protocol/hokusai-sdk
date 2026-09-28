/**
 * Bounded, fail-soft JSONL parsing. A malformed or oversized line becomes a
 * diagnostic count and is skipped; nothing here ever throws on bad input, and
 * the raw line text is never retained past `JSON.parse`.
 *
 * @module sources/jsonl
 */

import { countDiagnostic, type TaskCostSourceDiagnostics } from './types.js';

export interface ParseJsonlOptions {
  /** Maximum characters per line; longer lines are counted and skipped. */
  maxLineLength?: number;
  /** Maximum lines to consider; the rest are counted as truncated input. */
  maxLines?: number;
}

export const DEFAULT_MAX_LINE_LENGTH = 4 * 1024 * 1024;
export const DEFAULT_MAX_LINES = 500_000;

/**
 * Parse JSONL content into plain objects. Blank lines are ignored; malformed
 * JSON, non-object values, and oversized lines are counted into
 * `diagnostics` and skipped.
 */
export function parseJsonlObjects(
  content: string,
  diagnostics: TaskCostSourceDiagnostics,
  options: ParseJsonlOptions = {},
): Record<string, unknown>[] {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const rows: Record<string, unknown>[] = [];

  let lineCount = 0;
  let offset = 0;
  while (offset <= content.length) {
    const newline = content.indexOf('\n', offset);
    const end = newline === -1 ? content.length : newline;
    const line = content.slice(offset, end).replace(/\r$/, '');
    offset = end + 1;
    if (newline === -1 && line.length === 0) break;
    if (line.trim().length === 0) {
      if (newline === -1) break;
      continue;
    }

    lineCount += 1;
    if (lineCount > maxLines) {
      countDiagnostic(diagnostics, 'truncated_input');
      break;
    }
    if (line.length > maxLineLength) {
      countDiagnostic(diagnostics, 'oversized_line');
      if (newline === -1) break;
      continue;
    }

    try {
      const value: unknown = JSON.parse(line);
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        rows.push(value as Record<string, unknown>);
      } else {
        countDiagnostic(diagnostics, 'malformed_line');
      }
    } catch {
      countDiagnostic(diagnostics, 'malformed_line');
    }
    if (newline === -1) break;
  }

  return rows;
}
