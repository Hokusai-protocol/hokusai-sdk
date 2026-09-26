/**
 * Node-only file discovery for the source adapters. Callers pass in one or
 * more explicit roots and a set of allowed session ids; the helper returns
 * the raw JSONL text for each file matching those session ids.
 *
 * Every unreadable file is reported through an ordinal/count diagnostic —
 * paths, filenames, and error messages are never surfaced.
 *
 * This is the only place `@hokusai/costs` imports from `node:fs`; the rest of
 * the source pipeline is pure JavaScript.
 *
 * @module sources/node-fs
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { DiagnosticTally } from './correlation.js';

export interface DiscoverJsonlOptions {
  /** Absolute directories to scan for JSONL files. */
  roots: readonly string[];
  /** Session ids the caller has attributed to this task. */
  allowedSessionIds: readonly string[];
  /** File name extension to match (default `.jsonl`). */
  extension?: string;
  /**
   * Cap on the number of files opened per call. Files above the cap increment
   * `input_truncated`.
   */
  maxFiles?: number;
  /** Optional tally to increment `unreadable_file` counts against. */
  tally?: DiagnosticTally;
}

export interface DiscoveredJsonlBlob {
  /** The raw file contents. Callers pass this to `runClaudeCodeAdapter` etc. */
  blob: string;
}

async function listRootFiles(
  root: string,
  extension: string,
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(extension)) continue;
    files.push(join(root, entry.name));
  }
  return files;
}

/**
 * Discover JSONL files under one or more roots whose filenames name an allowed
 * session id. Sessions the caller did not authorize are ignored without any
 * diagnostic (they may belong to another task or another user).
 */
export async function discoverJsonlBlobs(
  options: DiscoverJsonlOptions,
): Promise<readonly DiscoveredJsonlBlob[]> {
  const extension = options.extension ?? '.jsonl';
  const maxFiles = options.maxFiles ?? 200;
  const allowed = new Set(options.allowedSessionIds);
  const blobs: DiscoveredJsonlBlob[] = [];

  let opened = 0;
  for (const root of options.roots) {
    let candidates: string[] = [];
    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) continue;
      candidates = await listRootFiles(root, extension);
    } catch {
      options.tally?.bump('unreadable_file');
      continue;
    }
    for (const filePath of candidates) {
      const base = filePath
        .slice(filePath.lastIndexOf('/') + 1)
        .replace(new RegExp(`${extension.replace('.', '\\.')}$`), '');
      if (!allowed.has(base)) continue;
      if (opened >= maxFiles) {
        options.tally?.bump('input_truncated');
        continue;
      }
      opened += 1;
      try {
        const blob = await readFile(filePath, 'utf8');
        blobs.push({ blob });
      } catch {
        options.tally?.bump('unreadable_file');
      }
    }
  }
  return blobs;
}
