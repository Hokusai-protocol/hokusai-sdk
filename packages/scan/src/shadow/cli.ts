/**
 * Shadow mode CLI interface.
 */

import * as path from 'node:path';
import { createDefaultDeps } from '../default-deps.js';
import { HORIZONS, validateGithubRepo } from '@hokusai/core';
import { BASELINE_V0 } from './scorer.js';
import { runShadowScore } from './score.js';
import { runShadowBackfill } from './backfill.js';
import { runShadowReport } from './report.js';
import { ShadowError } from './errors.js';
import type { GitRunner } from '../survival-labeller.js';
import { execArgvCommand } from '../shell-utils.js';

export interface ShadowCliIO {
  log: (line: string) => void;
}

async function createGitRunner(): Promise<GitRunner> {
  return async (args: string[], opts?: { cwd?: string }): Promise<{ stdout: string; exitCode: number }> => {
    try {
      const result = await execArgvCommand(['git', ...args], opts);
      return { stdout: result.stdout, exitCode: result.exitCode };
    } catch (error) {
      throw new ShadowError('NOT_A_GIT_REPO');
    }
  };
}

export async function runShadowCli(
  command: string,
  argv: Record<string, unknown>,
  io: ShadowCliIO,
  runGit?: GitRunner,
): Promise<{ exitCode: number }> {
  const log = io.log;

  try {
    // Validate common inputs
    const dataDir = argv['data-dir'] as string | undefined;
    if (!dataDir) {
      throw new ShadowError('INVALID_ARG');
    }

    const repo = argv['repo'] as string | undefined || '.';
    const githubRepo = argv['github-repo'] as string | undefined;
    if (!githubRepo) {
      throw new ShadowError('INVALID_ARG');
    }

    // Validate github-repo format
    const repoValidation = validateGithubRepo(githubRepo);
    if (!repoValidation.ok) {
      throw new ShadowError('INVALID_ARG');
    }

    const integrationBranch = argv['integration-branch'] as string | undefined;
    if (!integrationBranch) {
      throw new ShadowError('INVALID_ARG');
    }

    const threshold = Number(argv['threshold'] ?? 0.5);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new ShadowError('INVALID_ARG');
    }

    const bootstrapDays = Number(argv['bootstrap-days'] ?? 30);
    if (!Number.isInteger(bootstrapDays) || bootstrapDays < 1) {
      throw new ShadowError('INVALID_ARG');
    }

    const maxPrs = Number(argv['max-prs'] ?? 200);
    if (!Number.isInteger(maxPrs) || maxPrs < 1) {
      throw new ShadowError('INVALID_ARG');
    }

    const horizonDaysNum = Number(argv['horizon-days'] ?? 30);
    if (!HORIZONS.includes(horizonDaysNum as any)) {
      throw new ShadowError('INVALID_ARG');
    }
    const horizonDays = horizonDaysNum as 14 | 30 | 60;

    const windowDays = Number(argv['window-days'] ?? 30);
    if (!Number.isInteger(windowDays) || windowDays < 1) {
      throw new ShadowError('INVALID_ARG');
    }

    // Create git runner
    if (!runGit) {
      runGit = await createGitRunner();
    }

    const checkoutDir = repo === '.' ? process.cwd() : path.resolve(repo);

    if (command === 'shadow-score') {
      const result = await runShadowScore({
        dataDir,
        repo: githubRepo,
        githubRepo,
        integrationBranch,
        checkoutDir,
        threshold,
        bootstrapDays,
        maxPrs,
        runGit,
        now: () => new Date(),
        log,
        scorer: BASELINE_V0,
      });

      log(`SHADOW_OK scored=${result.scored} skipped=${result.skipped}`);
    } else if (command === 'shadow-backfill') {
      const deps = createDefaultDeps(
        { checkoutDir, gitBranch: integrationBranch, githubRepoRef: githubRepo },
        { github: { client: { request: async () => ({ data: {} }) } } },
      );

      const result = await runShadowBackfill({
        dataDir,
        repo: githubRepo,
        githubRepo,
        integrationBranch,
        horizonDays,
        checkoutDir,
        target: { integrationBranch, checkoutDir },
        deps,
        now: () => new Date(),
        log,
      });

      log(
        `SHADOW_OK labelled=${result.labelled} pending=${result.pending} skipped=${result.skipped} unlabellable=${result.unlabellable}`,
      );
    } else if (command === 'shadow-report') {
      await runShadowReport({
        dataDir,
        windowDays,
        horizonDays,
        now: () => new Date(),
        log,
      });
    }

    return { exitCode: 0 };
  } catch (error) {
    if (error instanceof ShadowError) {
      log(`SHADOW_ERROR code=${error.code}`);
    } else {
      log('SHADOW_ERROR code=INTERNAL');
    }
    return { exitCode: 0 };
  }
}
