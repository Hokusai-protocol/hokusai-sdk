/**
 * Shadow mode CLI: `shadow-score`, `shadow-backfill`, `shadow-report`.
 *
 * Fail-silent contract (REQ-F7): every failure exits 0 and prints exactly
 * `SHADOW_ERROR code=<CODE>` to stdout — no message, stack trace or path.
 * Argument and repo-precondition failures are detected before any write.
 * No ambient process state is read here; the caller supplies `cwd`.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { HorizonDays } from '@hokusai/core';
import { HORIZONS } from '@hokusai/core';
import { createDefaultDeps, createOfflineGitHubClient } from '../default-deps.js';
import { validateGithubRepo, type GithubRepoRef } from '../inputs.js';
import { execArgvCommand } from '../shell-utils.js';
import {
  GIT_OUTPUT_MAX_BUFFER,
  type GitRunner,
  type SurvivalLabellerTarget,
} from '../survival-labeller.js';
import { ShadowError } from './errors.js';
import { BASELINE_V0 } from './scorer.js';
import { runShadowScore } from './score.js';
import { runShadowBackfill } from './backfill.js';
import { runShadowReport } from './report.js';

export interface ShadowCliIO {
  /** One stdout line per call (no trailing newline needed). */
  log: (line: string) => void;
  /** Base directory that a relative `--repo` resolves against. */
  cwd: string;
  /** Clock override for tests. */
  now?: (() => Date) | undefined;
}

export const SHADOW_COMMANDS = ['shadow-score', 'shadow-backfill', 'shadow-report'] as const;
export type ShadowCommand = (typeof SHADOW_COMMANDS)[number];

export function isShadowCommand(command: string): command is ShadowCommand {
  return (SHADOW_COMMANDS as readonly string[]).includes(command);
}

const SHADOW_OPTION_SPEC = {
  'data-dir': { type: 'string' },
  'repo': { type: 'string' },
  'github-repo': { type: 'string' },
  'integration-branch': { type: 'string' },
  'threshold': { type: 'string' },
  'bootstrap-days': { type: 'string' },
  'max-prs': { type: 'string' },
  'horizon-days': { type: 'string' },
  'window-days': { type: 'string' },
} as const;

function parseBoundedFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ShadowError('INVALID_ARG');
  }
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ShadowError('INVALID_ARG');
  }
  return value;
}

function parseHorizon(raw: string | undefined): HorizonDays {
  const value = raw === undefined ? 30 : Number(raw);
  const horizon = HORIZONS.find((h) => h === value);
  if (horizon === undefined) {
    throw new ShadowError('INVALID_ARG');
  }
  return horizon;
}

function makeGitRunner(dir: string): GitRunner {
  return (args) =>
    execArgvCommand('git', ['-C', dir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER });
}

/** Repo preconditions, checked before any write (REQ-F7). */
function checkRepoPreconditions(repoDir: string, runGit: GitRunner): void {
  if (!existsSync(repoDir) || !statSync(repoDir).isDirectory()) {
    throw new ShadowError('NOT_A_GIT_REPO');
  }
  const inside = runGit(['rev-parse', '--is-inside-work-tree']);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    throw new ShadowError('NOT_A_GIT_REPO');
  }
  const shallow = runGit(['rev-parse', '--is-shallow-repository']);
  if (shallow.stdout.trim() === 'true') {
    throw new ShadowError('SHALLOW_CLONE');
  }
}

function detectGithubRepo(runGit: GitRunner): GithubRepoRef | null {
  const result = runGit(['remote', 'get-url', 'origin']);
  if (result.exitCode !== 0) return null;
  const match = result.stdout.trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1] as string, repo: match[2] as string };
}

export function runShadowCli(
  command: string,
  args: readonly string[],
  io: ShadowCliIO,
): { exitCode: number } {
  const log = io.log;
  const now = io.now ?? (() => new Date());

  try {
    if (!isShadowCommand(command)) {
      throw new ShadowError('INVALID_ARG');
    }

    let values: Record<string, string | boolean | undefined>;
    try {
      ({ values } = parseArgs({
        args: [...args],
        options: SHADOW_OPTION_SPEC,
        strict: true,
        allowPositionals: false,
      }));
    } catch {
      throw new ShadowError('INVALID_ARG');
    }

    const dataDir = values['data-dir'] as string | undefined;
    if (!dataDir) {
      throw new ShadowError('INVALID_ARG');
    }

    const threshold = parseBoundedFloat(values['threshold'] as string | undefined, 0.5, 0, 1);
    const bootstrapDays = parsePositiveInt(values['bootstrap-days'] as string | undefined, 30);
    const maxPrs = parsePositiveInt(values['max-prs'] as string | undefined, 200);
    const horizonDays = parseHorizon(values['horizon-days'] as string | undefined);
    const windowDays = parsePositiveInt(values['window-days'] as string | undefined, 30);

    if (command === 'shadow-report') {
      runShadowReport({ dataDir, windowDays, horizonDays, now, log });
      return { exitCode: 0 };
    }

    // score/backfill need the repo checkout and its GitHub identity.
    const repoDir = resolve(io.cwd, (values['repo'] as string | undefined) ?? '.');
    const runGit = makeGitRunner(repoDir);
    checkRepoPreconditions(repoDir, runGit);

    let githubRepo: GithubRepoRef | null;
    try {
      githubRepo = validateGithubRepo(values['github-repo'] as string | undefined) ?? null;
    } catch {
      throw new ShadowError('INVALID_ARG');
    }
    githubRepo = githubRepo ?? detectGithubRepo(runGit);
    if (!githubRepo) {
      throw new ShadowError('INVALID_ARG');
    }
    const repoSlug = `${githubRepo.owner}/${githubRepo.repo}`;

    const integrationBranch = values['integration-branch'] as string | undefined;
    if (!integrationBranch || integrationBranch === 'main') {
      throw new ShadowError('INVALID_ARG');
    }

    if (command === 'shadow-score') {
      const result = runShadowScore({
        dataDir,
        repo: repoSlug,
        integrationBranch,
        threshold,
        bootstrapDays,
        maxPrs,
        runGit,
        now,
        log,
        scorer: BASELINE_V0,
      });
      log(`SHADOW_OK scored=${result.scored} skipped=${result.skipped} status=${result.status}`);
    } else {
      const target: SurvivalLabellerTarget = {
        owner: githubRepo.owner,
        repo: githubRepo.repo,
        integrationBranch,
        repoDir,
      };
      // D7: zero API calls — git-only deps plus the offline GitHub client,
      // with cross-reference lookups disabled inside runShadowBackfill.
      const deps = createDefaultDeps(target, { now });
      deps.github = createOfflineGitHubClient();

      const result = runShadowBackfill({ dataDir, horizonDays, target, deps, now, log });
      log(
        `SHADOW_OK labelled=${result.labelled} pending=${result.pending} skipped=${result.skipped} unlabellable=${result.unlabellable}`,
      );
    }

    return { exitCode: 0 };
  } catch (error) {
    const code = error instanceof ShadowError ? error.code : 'INTERNAL';
    log(`SHADOW_ERROR code=${code}`);
    return { exitCode: 0 };
  }
}
