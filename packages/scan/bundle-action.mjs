#!/usr/bin/env node
/**
 * Bundle the GitHub Action entry into the committed single-file runtime at
 * `action/dist/index.js`.
 *
 * The bundle is committed because the Action runs on someone else's CI
 * runner with `runs.using: node20` and cannot `pnpm install` — everything,
 * including `@hokusai/core`, is inlined. CI regenerates the bundle and fails
 * if the committed copy is stale, so drift is caught on the PR that causes
 * it (same pattern as the plugin zips).
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(packageDir, 'src', 'action-entry.ts')],
  outfile: path.join(packageDir, 'action', 'dist', 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // No externals: the runner installs nothing. node builtins stay external
  // via platform: 'node'.
  legalComments: 'none',
  logLevel: 'info',
});
