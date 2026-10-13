/**
 * Node-only session-file reader, loaded via dynamic `import()` from
 * `measureTask` strictly on the `sessionFile` branch.
 *
 * Why dynamic: the package root must stay runtime-neutral —
 * `src/sources/node-fs.ts` (a subpath export) is the only module allowed a
 * static `node:fs` import, and keeping this module out of the root-reachable
 * static graph preserves that architecture value. The `events`/manual paths
 * never touch this module.
 *
 * Never throws: an unreadable file yields `content: null` and the caller
 * emits a count-only `SESSION_FILE_UNREADABLE` diagnostic.
 *
 * @module measure/node-read
 */

import { readFile } from 'node:fs/promises';

export interface SessionFileContent {
  /** Caller-supplied path, verbatim. */
  path: string;
  /** File text, or `null` when the file could not be read. */
  content: string | null;
}

export async function readSessionFiles(
  paths: readonly string[],
): Promise<SessionFileContent[]> {
  return Promise.all(
    paths.map(async (path): Promise<SessionFileContent> => {
      try {
        return { path, content: await readFile(path, 'utf8') };
      } catch {
        return { path, content: null };
      }
    }),
  );
}
