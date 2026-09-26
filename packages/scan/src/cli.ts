#!/usr/bin/env node
/**
 * `hokusai-scan` bin entry (`npx @hokusai/scan`). All logic lives in
 * `cli-core.ts`, shared with the GitHub Action entry.
 */

import { runScanCli } from './cli-core.js';

const result = runScanCli(process.argv.slice(2), {
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
  env: process.env,
});
process.exitCode = result.exitCode;
