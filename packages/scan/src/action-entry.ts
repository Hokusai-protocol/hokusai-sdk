/**
 * GitHub Action entry (`packages/scan/action`). Reads the Action's `INPUT_*`
 * environment variables, maps them to the exact CLI argv, and runs the same
 * in-process command as the bin entry — one code path, two front doors.
 *
 * Everything the pre-extraction tooling assumed from its home environment
 * (repo identity, token, config) arrives as an explicit Action input here;
 * nothing is read from ambient host state beyond what the workflow passes.
 */

import { appendFileSync } from 'node:fs';
import {
  buildActionArgv,
  buildShadowActionArgv,
  isShadowMode,
  readActionInput,
} from './action-io.js';
import { runScanCli } from './cli-core.js';
import { scanContractVersion } from './contract.js';

function writeGithubKeyValue(file: string | undefined, key: string, value: string): void {
  if (!file) return;
  appendFileSync(file, `${key}=${value}\n`);
}

function main(): number {
  const actionEnv = {
    input: (name: string) => readActionInput(process.env, name),
    runnerTemp: process.env.RUNNER_TEMP,
    workspace: process.env.GITHUB_WORKSPACE,
  };

  if (isShadowMode(actionEnv.input('mode'))) {
    // Shadow mode (HOK-2820): never visible, never gating. No GITHUB_OUTPUT,
    // no GITHUB_STEP_SUMMARY, and the step always succeeds (exit 0).
    const { argv } = buildShadowActionArgv(actionEnv);
    runScanCli(argv, {
      writeStdout: (text) => process.stdout.write(text),
      writeStderr: (text) => process.stderr.write(text),
      env: { ...process.env },
    });
    return 0;
  }

  const { argv, outputPath } = buildActionArgv(actionEnv);

  const env: Record<string, string | undefined> = { ...process.env };
  const token = readActionInput(process.env, 'token');
  if (token !== undefined) env.GITHUB_TOKEN = token;

  const result = runScanCli(argv, {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
    env,
  });

  if (result.exitCode === 0) {
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, 'output-path', result.outputPath ?? outputPath);
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, 'contract-version', scanContractVersion());
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, 'row-count', String(result.rowCount));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = [
        '### hokusai-scan',
        '',
        ...result.summaryLines.map((line) => `- ${line}`),
        '',
      ].join('\n');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
  }
  return result.exitCode;
}

process.exitCode = main();
