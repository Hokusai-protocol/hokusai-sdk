/**
 * Node-only session file discovery (`@hokusai/costs/sources/node-fs`).
 *
 * This is the single module in `@hokusai/costs` that touches `node:fs`, and
 * it is only reachable through its own subpath export — the package root
 * stays runtime-neutral. Discovery is deliberately narrow:
 *
 * - roots are explicitly supplied by the caller (e.g. a Claude Code project
 *   directory or `~/.codex/sessions`); nothing is inferred;
 * - a file matches only when its basename contains one of the boundary's
 *   session ids — never "the newest file";
 * - unreadable or oversized files become count-only diagnostics; no path
 *   ever appears in the result.
 *
 * @module sources/node-fs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  countDiagnostic,
  type TaskCostSourceDiagnostics,
} from './types.js';

export interface ReadSessionFilesOptions {
  /** Directories to search, explicitly supplied. Searched recursively. */
  roots: readonly string[];
  /** Session ids to match against `.jsonl` basenames. */
  sessionIds: readonly string[];
  /** Skip files larger than this many bytes (default 64 MiB). */
  maxFileBytes?: number;
  /** Maximum directory depth below each root (default 6). */
  maxDepth?: number;
}

export interface DiscoveredSessionFile {
  /** The session id whose match selected this file. */
  sessionId: string;
  /** Raw JSONL content, for the pure adapters. */
  content: string;
}

export interface ReadSessionFilesResult {
  files: readonly DiscoveredSessionFile[];
  /** Count-only diagnostics; unreadable entries are counted, never named. */
  diagnostics: TaskCostSourceDiagnostics;
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 6;

/**
 * Read every `.jsonl` file under the supplied roots whose basename contains
 * one of the session ids. Never throws: filesystem failures degrade to
 * `unreadable_file` counts.
 */
export function readSessionFiles(
  options: ReadSessionFilesOptions,
): ReadSessionFilesResult {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const sessionIds = options.sessionIds.filter(
    (id) => typeof id === 'string' && id.length > 0,
  );
  const diagnostics: TaskCostSourceDiagnostics = {};
  const files: DiscoveredSessionFile[] = [];
  const seen = new Set<string>();

  function visit(dir: string, depth: number): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      countDiagnostic(diagnostics, 'unreadable_file');
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = sessionIds.find((id) => entry.name.includes(id));
      if (sessionId === undefined || seen.has(fullPath)) continue;
      seen.add(fullPath);
      try {
        if (statSync(fullPath).size > maxFileBytes) {
          countDiagnostic(diagnostics, 'oversized_file');
          continue;
        }
        files.push({ sessionId, content: readFileSync(fullPath, 'utf8') });
      } catch {
        countDiagnostic(diagnostics, 'unreadable_file');
      }
    }
  }

  for (const root of options.roots) {
    visit(root, 0);
  }
  return { files, diagnostics };
}

export {
  TASK_COST_SOURCE_DIAGNOSTIC_CODES,
  type TaskCostSourceDiagnosticCode,
  type TaskCostSourceDiagnostics,
} from './types.js';
