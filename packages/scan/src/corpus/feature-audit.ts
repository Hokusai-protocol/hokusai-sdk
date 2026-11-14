/**
 * `hokusai-scan corpus-feature-audit` (HOK-3023): the leakage validator for
 * callers outside TypeScript. It holds no rules of its own, so the Python
 * dataset assembly (HOK-2818) gets the same answer as `@hokusai/core` callers.
 *
 * Exit codes: 0 the columns pass, 1 leakage found, 2 usage or input error.
 * The JSON result on stdout is the interface for callers.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  REWORK_RISK_FEATURE_MANIFEST,
  REWORK_RISK_FEATURE_MANIFEST_VERSION,
  validateFeatureColumns,
} from '@hokusai/core';

export interface FeatureAuditIO {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  cwd: string;
}

export function runFeatureAudit(argv: readonly string[], io: FeatureAuditIO): { exitCode: number } {
  let values: { columns?: string; 'allow-segments'?: boolean; 'print-manifest'?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        columns: { type: 'string' },
        'allow-segments': { type: 'boolean' },
        'print-manifest': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }

  if (values['print-manifest']) {
    io.writeStdout(`${JSON.stringify(REWORK_RISK_FEATURE_MANIFEST, null, 2)}\n`);
    return { exitCode: 0 };
  }
  if (!values.columns) {
    io.writeStderr('error: corpus-feature-audit needs --columns <json array of names> or --print-manifest\n');
    return { exitCode: 2 };
  }

  let columns: unknown;
  try {
    columns = JSON.parse(readFileSync(resolve(io.cwd, values.columns), 'utf8'));
  } catch (error) {
    io.writeStderr(`error: --columns: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  if (!Array.isArray(columns) || columns.length === 0 || !columns.every((name) => typeof name === 'string')) {
    io.writeStderr('error: --columns must hold a non-empty JSON array of column names\n');
    return { exitCode: 2 };
  }

  const errors = validateFeatureColumns(columns, { allowSegments: values['allow-segments'] === true });
  io.writeStdout(`${JSON.stringify({ manifest_version: REWORK_RISK_FEATURE_MANIFEST_VERSION, ok: errors.length === 0, errors }, null, 2)}\n`);
  return { exitCode: errors.length === 0 ? 0 : 1 };
}
