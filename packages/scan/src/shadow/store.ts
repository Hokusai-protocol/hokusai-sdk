/**
 * JSONL store for shadow mode records and state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ArbiterShadowScoreV1,
  ArbiterShadowOutcomeV1,
  ArbiterShadowStateV1,
  HokusaiFieldError,
} from '@hokusai/core';
import {
  ARBITER_SHADOW_STATE_SCHEMA_VERSION,
  initialShadowState,
  validateShadowScoreRow,
  validateShadowOutcomeRow,
  validateShadowState,
} from '@hokusai/core';
import { ShadowError } from './errors.js';

export interface JsonlResult<T> {
  rows: T[];
  malformed: number;
}

/** Ensure the data directory exists and is writable. */
export function ensureWritableDataDir(dir: string): void {
  try {
    // Create directory if it doesn't exist
    fs.mkdirSync(dir, { recursive: true });
    // Test write access
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new ShadowError('DATA_DIR_UNWRITABLE');
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
        const parsed = JSON.parse(line);
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

  // Build new content
  const newLines = rows.map(row => JSON.stringify(row));
  const newContent = existingContent + (existingContent ? '\n' : '') + newLines.join('\n');

  // Write atomically using temp file + rename
  const tempFile = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFileSync(tempFile, newContent, 'utf-8');
    fs.fsyncSync(fs.openSync(tempFile, 'r'));
    fs.renameSync(tempFile, file);
  } catch (error) {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore
    }
    throw error;
  }
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
    const parsed = JSON.parse(content);
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

  const content = JSON.stringify(state);
  const tempFile = `${stateFile}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;

  try {
    fs.writeFileSync(tempFile, content, 'utf-8');
    fs.fsyncSync(fs.openSync(tempFile, 'r'));
    fs.renameSync(tempFile, stateFile);
  } catch (error) {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore
    }
    throw error;
  }
}

/** Write report to data directory. */
export function writeReport(
  dir: string,
  date: string, // YYYY-MM-DD format
  json: unknown,
): void {
  const reportsDir = path.join(dir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const reportFile = path.join(reportsDir, `${date}.json`);
  const content = JSON.stringify(json, null, 2);

  fs.writeFileSync(reportFile, content, 'utf-8');
}
