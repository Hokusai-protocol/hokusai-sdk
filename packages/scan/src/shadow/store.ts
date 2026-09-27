/**
 * JSONL store for shadow mode records and state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArbiterShadowStateV1, HokusaiFieldError } from '@hokusai/core';
import { initialShadowState, validateShadowState } from '@hokusai/core';
import { ShadowError } from './errors.js';

export interface JsonlResult<T> {
  rows: T[];
  malformed: number;
}

/** Ensure the data directory exists and is writable (probe file, not just mode bits). */
export function ensureWritableDataDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    const probe = path.join(dir, `.probe-${process.pid}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch {
    throw new ShadowError('DATA_DIR_UNWRITABLE');
  }
}

/** Write bytes to `file` atomically: temp file, fsync, rename. */
function writeFileAtomic(file: string, content: string): void {
  const tempFile = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tempFile, 'w');
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempFile, file);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore
    }
    throw error;
  }
}

/** Read JSONL file and validate each row. Missing file returns empty result. */
export function readJsonl<T>(
  file: string,
  validate: (row: unknown) => { ok: boolean; errors?: HokusaiFieldError[] } & { value?: T },
): JsonlResult<T> {
  const rows: T[] = [];
  let malformed = 0;

  // Missing file is not an error
  if (!fs.existsSync(file)) {
    return { rows, malformed };
  }

  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(line => line.length > 0);

    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        const result = validate(parsed);
        if (result.ok && result.value) {
          rows.push(result.value);
        } else {
          malformed++;
        }
      } catch {
        // JSON parse error or validation error - count as malformed
        malformed++;
      }
    }
  } catch {
    // File read error - treat as empty file
  }

  return { rows, malformed };
}

/** Append rows to JSONL file atomically. Validates all rows first. */
export function appendJsonl<T>(
  file: string,
  rows: T[],
  validate: (row: unknown) => { ok: boolean; errors?: HokusaiFieldError[] },
): void {
  // Validate all rows first
  for (const row of rows) {
    const result = validate(row);
    if (!result.ok) {
      throw new ShadowError('INVALID_ROW');
    }
  }

  if (rows.length === 0) {
    return;
  }

  // Read existing content
  let existingContent = '';
  if (fs.existsSync(file)) {
    existingContent = fs.readFileSync(file, 'utf-8');
  }

  // Build new content: existing bytes + new lines, one JSON object per line.
  const newLines = rows.map(row => JSON.stringify(row));
  const trimmed = existingContent.length > 0 && !existingContent.endsWith('\n')
    ? `${existingContent}\n`
    : existingContent;
  const newContent = `${trimmed}${newLines.join('\n')}\n`;

  writeFileAtomic(file, newContent);
}

/** Read state from data directory. Missing or invalid state returns initial state. */
export function readState(
  dir: string,
  repo: string,
  scorerId: string,
  scorerVersion: string,
): {
  state: ArbiterShadowStateV1;
  corrupt: boolean;
} {
  const stateFile = path.join(dir, 'state.json');

  if (!fs.existsSync(stateFile)) {
    return {
      state: initialShadowState(repo, scorerId, scorerVersion),
      corrupt: false,
    };
  }

  try {
    const content = fs.readFileSync(stateFile, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = validateShadowState(parsed);

    if (result.ok) {
      return { state: result.value, corrupt: false };
    } else {
      return {
        state: {
          ...initialShadowState(repo, scorerId, scorerVersion),
          last_run_status: 'error',
          last_error_code: 'STATE_CORRUPT',
        },
        corrupt: true,
      };
    }
  } catch {
    return {
      state: {
        ...initialShadowState(repo, scorerId, scorerVersion),
        last_run_status: 'error',
        last_error_code: 'STATE_CORRUPT',
      },
      corrupt: true,
    };
  }
}

/** Write state to data directory atomically. */
export function writeState(dir: string, state: ArbiterShadowStateV1): void {
  const stateFile = path.join(dir, 'state.json');

  const result = validateShadowState(state);
  if (!result.ok) {
    throw new ShadowError('INVALID_ROW');
  }

  writeFileAtomic(stateFile, JSON.stringify(state, null, 2));
}

/** Write an already-serialized report to `reports/<date>.json`. */
export function writeReport(
  dir: string,
  date: string, // YYYY-MM-DD format
  serialized: string,
): void {
  const reportsDir = path.join(dir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  writeFileAtomic(path.join(reportsDir, `${date}.json`), serialized);
}
