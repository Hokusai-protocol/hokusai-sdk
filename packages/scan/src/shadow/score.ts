/**
 * Shadow scoring runner: discover newly merged PRs, extract candidate
 * features, score them, and append validated rows to the data dir.
 *
 * Feature extraction runs against a temporary detached no-checkout worktree
 * whose HEAD is moved per merge with `update-ref` — the live checkout's HEAD
 * is never touched, no files are populated, and no static tooling runs
 * (`NULL_STATIC_FEATURES` is passed explicitly, so tsc/eslint/build never
 * execute against historical commits).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ArbiterShadowErrorCode,
  ArbiterShadowRunStatus,
  ArbiterShadowScoreV1,
  ArbiterShadowStateV1,
  CandidateFeaturesV1,
} from '@hokusai/core';
import { validateShadowScoreRow } from '@hokusai/core';
import {
  extractCandidateFeatures,
  type CandidateFeaturesOptions,
} from '../candidate-features.js';
import { GIT_OUTPUT_MAX_BUFFER, type GitRunner } from '../survival-labeller.js';
import { execArgvCommand } from '../shell-utils.js';
import { ShadowError } from './errors.js';
import { discoverMerges } from './discover.js';
import { BASELINE_V0, NULL_STATIC_FEATURES, type ShadowScorer } from './scorer.js';
import { appendJsonl, ensureWritableDataDir, readJsonl, readState, writeState } from './store.js';

export interface RunShadowScoreOptions {
  dataDir: string;
  /** "owner/name" recorded on every row. */
  repo: string;
  /** Branch whose first-parent history is walked (never `main`; see D1). */
  integrationBranch: string;
  threshold: number;
  bootstrapDays: number;
  maxPrs: number;
  /** Git runner bound to `checkoutDir`. */
  runGit: GitRunner;
  now: () => Date;
  log: (line: string) => void;
  scorer?: ShadowScorer | undefined;
  /** Seam for tests: builds a git runner bound to an arbitrary directory. */
  makeGitRunner?: ((dir: string) => GitRunner) | undefined;
  /** Seam for tests: candidate-feature extraction. */
  extract?: ((options: CandidateFeaturesOptions) => CandidateFeaturesV1) | undefined;
}

export interface RunShadowScoreResult {
  scored: number;
  skipped: number;
  cursor_before: string | null;
  cursor_after: string | null;
  status: ArbiterShadowRunStatus;
}

function defaultMakeGitRunner(dir: string): GitRunner {
  return (args) =>
    execArgvCommand('git', ['-C', dir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER });
}

/** Run shadow scoring: discover, extract, score, and store results. */
export function runShadowScore(opts: RunShadowScoreOptions): RunShadowScoreResult {
  const {
    dataDir,
    repo,
    integrationBranch,
    threshold,
    bootstrapDays,
    maxPrs,
    runGit,
    now,
    log,
    scorer = BASELINE_V0,
    makeGitRunner = defaultMakeGitRunner,
    extract = extractCandidateFeatures,
  } = opts;

  ensureWritableDataDir(dataDir);

  const { state: oldState, corrupt } = readState(dataDir, repo, scorer.id, scorer.version);
  const cursorBefore = oldState.last_seen_merge_sha;

  // Existing merge SHAs make scoring idempotent, including after a crash
  // between the rows append and the state write.
  const scoresFile = join(dataDir, 'scores.jsonl');
  const existing = readJsonl(scoresFile, validateShadowScoreRow);
  const existingMergeShas = new Set(existing.rows.map((r) => r.merge_sha));

  let cursorAfter = cursorBefore;
  let scored = 0;
  let skipped = 0;
  let status: ArbiterShadowRunStatus = 'ok';
  let lastError: ArbiterShadowErrorCode | null = null;
  let cursorReset = false;

  try {
    const discovered = discoverMerges({
      runGit,
      ref: integrationBranch,
      cursor: cursorBefore,
      bootstrapDays,
      now,
      maxPrs,
    });
    cursorReset = discovered.cursorReset;

    const rows: ArbiterShadowScoreV1[] = [];

    if (discovered.merges.length > 0) {
      // One detached no-checkout worktree per run; HEAD moves per merge.
      runGit(['worktree', 'prune']);
      const worktreeDir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-'));
      const added = runGit([
        'worktree', 'add', '--detach', '--no-checkout', '--force', worktreeDir,
      ]);
      if (added.exitCode !== 0) {
        throw new ShadowError('EXTRACT_FAILED');
      }
      const runWorktreeGit = makeGitRunner(worktreeDir);

      try {
        for (const merge of discovered.merges) {
          if (existingMergeShas.has(merge.mergeSha)) {
            skipped++;
            cursorAfter = merge.mergeSha;
            continue;
          }

          try {
            const moved = runWorktreeGit(['update-ref', '--no-deref', 'HEAD', merge.mergeSha]);
            if (moved.exitCode !== 0) {
              throw new ShadowError('EXTRACT_FAILED');
            }

            const features = extract({
              checkoutDir: worktreeDir,
              // The extractor stringifies this; offline mode never sends it
              // anywhere. Non-PR merges fall back to the SHA.
              prNumber: merge.prNumber ?? merge.mergeSha,
              baseRef: merge.parentSha,
              offline: true,
              staticFeatures: NULL_STATIC_FEATURES,
            });

            const score = scorer.score(features);
            const row: ArbiterShadowScoreV1 = {
              schema_version: 'arbiter_shadow_score/v1',
              repo,
              pr_number: merge.prNumber,
              merge_sha: merge.mergeSha,
              merged_at: new Date(merge.mergedAtEpoch * 1000).toISOString(),
              scored_at: now().toISOString(),
              scorer_id: scorer.id,
              scorer_version: scorer.version,
              score,
              threshold,
              would_flag: score < threshold,
              features,
            };

            const validation = validateShadowScoreRow(row);
            if (!validation.ok) {
              log(`SHADOW_SKIP pr=${merge.prNumber ?? 'none'} code=INVALID_ROW`);
              skipped++;
              status = 'partial';
              cursorAfter = merge.mergeSha;
              continue;
            }

            rows.push(row);
            scored++;
            cursorAfter = merge.mergeSha;
          } catch {
            log(`SHADOW_SKIP pr=${merge.prNumber ?? 'none'} code=EXTRACT_FAILED`);
            skipped++;
            status = 'partial';
            cursorAfter = merge.mergeSha;
          }
        }

        if (rows.length > 0) {
          appendJsonl(scoresFile, rows, validateShadowScoreRow);
        }
      } finally {
        runGit(['worktree', 'remove', '--force', worktreeDir]);
        rmSync(worktreeDir, { recursive: true, force: true });
        runGit(['worktree', 'prune']);
      }
    }
  } catch (error) {
    lastError = error instanceof ShadowError ? error.code : 'INTERNAL';
    status = 'error';
  }

  const newState: ArbiterShadowStateV1 = {
    schema_version: 'arbiter_shadow_state/v1',
    repo,
    last_seen_merge_sha: cursorAfter,
    last_run_at: now().toISOString(),
    last_run_status: status,
    last_error_code: corrupt ? 'STATE_CORRUPT' : cursorReset ? 'CURSOR_RESET' : lastError,
    scorer_id: scorer.id,
    scorer_version: scorer.version,
  };

  try {
    writeState(dataDir, newState);
  } catch {
    // Best-effort: a failed state write means the next run re-discovers and
    // dedups by merge_sha, so no duplicate rows are possible.
  }

  return {
    scored,
    skipped,
    cursor_before: cursorBefore,
    cursor_after: cursorAfter,
    status,
  };
}
