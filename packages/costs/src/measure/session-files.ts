/**
 * Session-file capture for `measureTask` (`sessionFiles` option).
 *
 * Correlation is always driven by the explicit boundary — task id, non-empty
 * session ids, and an inclusive time window (the HOK-3070 rule: never "the
 * newest file"). File reads go through `../sources/node-fs.js` via a dynamic
 * `import()`, so the package root's *static* import graph stays Node-free and
 * `node:fs` loads only when this option is actually used. The pure adapters
 * (`extractClaudeCodeUsage` / `extractCodexUsage`) are imported statically —
 * they touch no Node API.
 *
 * @module measure/session-files
 */

import { extractClaudeCodeUsage } from '../sources/claude-code/index.js';
import { extractCodexUsage } from '../sources/codex/index.js';
import type { IngestUsageInput } from '../engine.js';
import type {
  TaskCostBoundaryV1,
  TaskCostSourceDiagnostics,
  TaskCostSourceResult,
} from '../sources/types.js';
import { TaskCostMeasureError } from './errors.js';
import type { SessionFilesOptions } from './types.js';

export interface CollectedSessionFiles {
  inputs: readonly IngestUsageInput[];
  diagnostics: TaskCostSourceDiagnostics;
  /** How many files were read. Paths never leave this module. */
  fileCount: number;
}

/**
 * Validate the option shape eagerly — these are all programmer errors, and
 * they must fail loudly instead of silently attributing nothing.
 */
export function validateSessionFilesOptions(
  options: SessionFilesOptions,
): void {
  if (typeof options !== 'object' || options === null) {
    throw new TaskCostMeasureError('sessionFiles must be an object');
  }
  if (options.harness !== 'claude-code' && options.harness !== 'codex') {
    throw new TaskCostMeasureError(
      "sessionFiles.harness must be 'claude-code' or 'codex'",
    );
  }
  if (
    !Array.isArray(options.sessionIds) &&
    typeof options.sessionIds !== 'function'
  ) {
    throw new TaskCostMeasureError(
      'sessionFiles.sessionIds must be an array of session ids or a function returning one',
    );
  }
  for (const [name, list] of [
    ['paths', options.paths],
    ['roots', options.roots],
  ] as const) {
    if (list === undefined) continue;
    if (
      !Array.isArray(list) ||
      list.some((entry) => typeof entry !== 'string')
    ) {
      throw new TaskCostMeasureError(
        `sessionFiles.${name} must be an array of strings`,
      );
    }
  }
  if (options.paths === undefined && options.roots === undefined) {
    throw new TaskCostMeasureError(
      'sessionFiles requires paths and/or roots — nothing is ever discovered implicitly',
    );
  }
}

function resolveSessionIds(options: SessionFilesOptions): readonly string[] {
  const resolved: readonly string[] =
    typeof options.sessionIds === 'function'
      ? options.sessionIds()
      : options.sessionIds;
  const candidates: unknown = resolved;
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    candidates.some((id) => typeof id !== 'string' || id.length === 0)
  ) {
    throw new TaskCostMeasureError(
      'sessionFiles.sessionIds must resolve to a non-empty array of session ids (the explicit task boundary is required)',
    );
  }
  return resolved;
}

/**
 * Read and extract usage for one task from session files. File-level and
 * line-level problems degrade to count-only diagnostics; only a misconfigured
 * boundary throws.
 */
export async function collectSessionFiles(
  taskId: string,
  options: SessionFilesOptions,
  defaultWindow: { startedAt: string; endedAt: string },
): Promise<CollectedSessionFiles> {
  const sessionIds = resolveSessionIds(options);
  const window = options.window ?? defaultWindow;
  const boundary: TaskCostBoundaryV1 = {
    boundaryVersion: 1,
    taskId,
    sessionIds,
    startedAt: window.startedAt,
    endedAt: window.endedAt,
  };

  // Node-only file access, loaded on demand (see module doc).
  const nodeFs = await import('../sources/node-fs.js');
  const diagnostics: TaskCostSourceDiagnostics = {};
  const files: string[] = [];
  if (options.paths !== undefined && options.paths.length > 0) {
    const read = nodeFs.readSessionFilePaths({
      paths: options.paths,
      ...(options.maxFileBytes !== undefined
        ? { maxFileBytes: options.maxFileBytes }
        : {}),
    });
    files.push(...read.contents);
    mergeDiagnostics(diagnostics, read.diagnostics);
  }
  if (options.roots !== undefined && options.roots.length > 0) {
    const read = nodeFs.readSessionFiles({
      roots: options.roots,
      sessionIds,
      ...(options.maxFileBytes !== undefined
        ? { maxFileBytes: options.maxFileBytes }
        : {}),
    });
    files.push(...read.files.map((file) => file.content));
    mergeDiagnostics(diagnostics, read.diagnostics);
  }

  const extract =
    options.harness === 'claude-code'
      ? extractClaudeCodeUsage
      : extractCodexUsage;
  const result: TaskCostSourceResult<IngestUsageInput> = extract({
    boundary,
    files,
  });
  mergeDiagnostics(diagnostics, result.diagnostics);

  return { inputs: result.inputs, diagnostics, fileCount: files.length };
}

function mergeDiagnostics(
  into: TaskCostSourceDiagnostics,
  from: TaskCostSourceDiagnostics,
): void {
  for (const [code, count] of Object.entries(from) as [
    keyof TaskCostSourceDiagnostics,
    number,
  ][]) {
    if (count !== undefined && count > 0)
      into[code] = (into[code] ?? 0) + count;
  }
}
