/**
 * Pure input-mapping for the GitHub Action entry: `INPUT_*` values → the
 * exact `hokusai-scan` argv. Separated from `action-entry.ts` (which runs on
 * import) so the mapping is unit-testable.
 */

import { isAbsolute, join } from 'node:path';

export interface ActionEnv {
  input: (name: string) => string | undefined;
  runnerTemp: string | undefined;
  workspace: string | undefined;
}

export function readActionInput(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const raw = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function actionFlagIsTrue(value: string | undefined): boolean {
  return value !== undefined && /^(true|1|yes)$/i.test(value);
}

/** Shadow modes (HOK-2820) never write Action outputs or a step summary. */
export function isShadowMode(mode: string | undefined): boolean {
  return mode === 'shadow-score' || mode === 'shadow-backfill' || mode === 'shadow-report';
}

/**
 * Map `INPUT_*` values to the shadow sub-CLI argv. No `--out`: shadow
 * commands write only to `--data-dir` and stdout.
 */
export function buildShadowActionArgv(env: ActionEnv): { argv: string[] } {
  const mode = env.input('mode') ?? '';
  const argv: string[] = [mode];

  argv.push('--repo', env.input('repo-path') ?? env.workspace ?? '.');

  const dataDir = env.input('data-dir');
  if (dataDir !== undefined) argv.push('--data-dir', dataDir);

  const githubRepo = env.input('github-repo');
  if (githubRepo !== undefined) argv.push('--github-repo', githubRepo);

  const integrationBranch = env.input('integration-branch');
  if (integrationBranch !== undefined) argv.push('--integration-branch', integrationBranch);

  for (const flag of ['threshold', 'bootstrap-days', 'max-prs', 'horizon-days', 'window-days']) {
    const value = env.input(flag);
    if (value !== undefined) argv.push(`--${flag}`, value);
  }

  return { argv };
}

export function buildActionArgv(env: ActionEnv): { argv: string[]; outputPath: string } {
  const mode = env.input('mode') ?? '';
  const argv: string[] = [mode];

  const repo = env.input('repo-path') ?? env.workspace ?? '.';
  argv.push('--repo', repo);

  const integrationBranch = env.input('integration-branch');
  if (integrationBranch !== undefined) argv.push('--integration-branch', integrationBranch);

  const prNumber = env.input('pr-number');
  if (prNumber !== undefined) argv.push('--pr', prNumber);

  const prUrl = env.input('pr-url');
  if (prUrl !== undefined) argv.push('--pr-url', prUrl);

  const githubRepo = env.input('github-repo');
  if (githubRepo !== undefined) argv.push('--github-repo', githubRepo);

  const asOf = env.input('as-of');
  if (asOf !== undefined) argv.push('--as-of', asOf);

  const horizons = env.input('horizons');
  if (horizons !== undefined) argv.push('--horizons', horizons);

  const baseRef = env.input('base-ref');
  if (baseRef !== undefined) argv.push('--base-ref', baseRef);

  if (actionFlagIsTrue(env.input('no-links'))) argv.push('--no-links');
  if (actionFlagIsTrue(env.input('offline'))) argv.push('--offline');
  if (actionFlagIsTrue(env.input('debug'))) argv.push('--debug');

  const requestedOut = env.input('output-path') ?? 'hokusai-scan-output.jsonl';
  const outputPath = isAbsolute(requestedOut)
    ? requestedOut
    : join(env.runnerTemp ?? '.', requestedOut);
  argv.push('--out', outputPath);

  // The workflow's `token` input reaches the CLI through the GITHUB_TOKEN
  // environment variable (never argv), matching --token-env's default.
  return { argv, outputPath };
}
