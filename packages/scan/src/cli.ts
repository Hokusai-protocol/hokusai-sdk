#!/usr/bin/env node
/**
 * `hokusai-scan` bin entry (`npx @hokusai/scan`). All logic lives in
 * `cli-core.ts`, shared with the GitHub Action entry.
 */

import { runScanCliAsync } from './cli-core.js';

const result = await runScanCliAsync(process.argv.slice(2), {
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
  env: process.env,
});
process.exitCode = result.exitCode;
