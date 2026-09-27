/**
 * Shadow scoring runner: extract features and score merged PRs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GitRunner } from '../survival-labeller.js';
import type { CandidateFeaturesV1 } from '@hokusai/core';
import { extractCandidateFeatures } from '../candidate-features.js';
import type { ShadowScorer } from './scorer.js';
import { BASELINE_V0, NULL_STATIC_FEATURES } from './scorer.js';
import type {
  ArbiterShadowScoreV1,
  ArbiterShadowStateV1,
  ArbiterShadowRunStatus,
  ArbiterShadowErrorCode,
} from '@hokusai/core';
import { validateShadowScoreRow } from '@hokusai/core';
import { ShadowError } from './errors.js';
import { discoverMerges } from './discover.js';
import { readJsonl, appendJsonl, readState, writeState, ensureWritableDataDir } from './store.js';

export interface RunShadowScoreOptions {
  dataDir: string;
  repo: string; // owner/repo
  githubRepo: string; // owner/repo
  integrationBranch: string;
  checkoutDir: string;
  threshold: number;
  bootstrapDays: number;
  maxPrs: number;
  runGit: GitRunner;
  now: () => Date;
  log: (line: string) => void;
  scorer?: ShadowScorer;
}

export interface RunShadowScoreResult {
  scored: number;
  skipped: number;
  cursor_before: string | null;
  cursor_after: string | null;
  status: ArbiterShadowRunStatus;
}

/** Run shadow scoring: discover, extract, score, and store results. */
export function runShadowScore(opts: RunShadowScoreOptions): RunShadowScoreResult {
  const {
    dataDir,
    repo,
    integrationBranch,
    checkoutDir,
    threshold,
    bootstrapDays,
    maxPrs,
    runGit,
    now,
    log,
    scorer = BASELINE_V0,
  } = opts;

  ensureWritableDataDir(dataDir);

  // Load existing state
  const { state: oldState, corrupt } = readState(dataDir, repo, scorer.id, scorer.version);
  const cursorBefore = oldState.last_seen_merge_sha;

  // Read existing scores to avoid duplicates
  const scoresFile = `${dataDir}/scores.jsonl`;
  const existing = readJsonl(scoresFile, validateShadowScoreRow);
  const existingMergeShas = new Set(existing.rows.map(r => r.merge_sha));

  let cursorAfter = cursorBefore;
  let scored = 0;
  let skipped = 0;
  let status: ArbiterShadowRunStatus = 'ok';
  let lastError: ArbiterShadowErrorCode | null = null;
  let cursorReset = false;

  // Dedicated detached, no-checkout worktree in the OS temp dir (plan D6):
  // moving HEAD here never mutates the live checkout, and --no-checkout means
  // no files are ever materialised.
  const worktreeDir = path.join(
    os.tmpdir(),
    `arbiter-shadow-wt-${now().getTime()}-${Math.random().toString(36).slice(2)}`,
  );
  let worktreeCreated = false;

  try {
    // Discover merges
    const discovered = discoverMerges({
      runGit,
      checkoutDir,
      ref: integrationBranch,
      cursor: cursorBefore,
      bootstrapDays,
      now,
      maxPrs,
    });

    cursorReset = discovered.cursorReset;
    const rows: ArbiterShadowScoreV1[] = [];

    if (discovered.merges.length > 0) {
      // Prune stale worktree registrations, then create the temp worktree.
      runGit(['-C', checkoutDir, 'worktree', 'prune']);
      const add = runGit([
        '-C',
        checkoutDir,
        'worktree',
        'add',
        '--detach',
        '--no-checkout',
        worktreeDir,
      ]);
      if (add.exitCode !== 0) {
        throw new ShadowError('NOT_A_GIT_REPO');
      }
      worktreeCreated = true;
    }

    // Process each merge
    for (const merge of discovered.merges) {
      try {
        // Skip if already scored
        if (existingMergeShas.has(merge.mergeSha)) {
          skipped++;
          cursorAfter = merge.mergeSha;
          continue;
        }

        // Move the temp worktree's HEAD to this merge (cheap, no files).
        runGit(['-C', worktreeDir, 'update-ref', '--no-deref', 'HEAD', merge.mergeSha]);

        // Extract features. staticFeatures: NULL_STATIC_FEATURES guarantees no
        // tool execution (tsc/eslint/build) per plan D6; offline avoids network.
        let features: CandidateFeaturesV1 | null = null;
        try {
          features = extractCandidateFeatures({
            checkoutDir: worktreeDir,
            prNumber: merge.prNumber ?? 0,
            baseRef: merge.parentSha,
            offline: true,
            staticFeatures: NULL_STATIC_FEATURES,
          });
        } catch {
          log(`SHADOW_SKIP pr=${merge.prNumber ?? 'none'} code=EXTRACT_FAILED`);
          skipped++;
          status = 'partial';
          cursorAfter = merge.mergeSha;
          continue;
        }

        if (!features) {
          log(`SHADOW_SKIP pr=${merge.prNumber ?? 'none'} code=EXTRACT_FAILED`);
          skipped++;
          status = 'partial';
          cursorAfter = merge.mergeSha;
          continue;
        }

        // Score
        const score = scorer.score(features);

        // Build row
        const mergedAt = new Date(merge.mergedAtEpoch * 1000).toISOString();
        const scoredAt = now().toISOString();

        const row: ArbiterShadowScoreV1 = {
          schema_version: 'arbiter_shadow_score/v1',
          repo,
          pr_number: merge.prNumber,
          merge_sha: merge.mergeSha,
          merged_at: mergedAt,
          scored_at: scoredAt,
          scorer_id: scorer.id,
          scorer_version: scorer.version,
          score,
          threshold,
          would_flag: score < threshold,
          features,
        };

        // Validate
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
        // Log and continue
        const prNum = merge.prNumber ?? 'none';
        log(`SHADOW_SKIP pr=${prNum} code=EXTRACT_FAILED`);
        skipped++;
        status = 'partial';
        cursorAfter = merge.mergeSha;
      }
    }

    // Append all rows atomically
    if (rows.length > 0) {
      appendJsonl(scoresFile, rows, validateShadowScoreRow);
    }
  } catch (error) {
    if (error instanceof ShadowError) {
      lastError = error.code;
    } else {
      lastError = 'INTERNAL';
    }
    status = 'error';
  } finally {
    // Always remove the temp worktree and prune its registration.
    if (worktreeCreated) {
      try {
        runGit(['-C', checkoutDir, 'worktree', 'remove', '--force', worktreeDir]);
      } catch {
        // ignore
      }
      try {
        runGit(['-C', checkoutDir, 'worktree', 'prune']);
      } catch {
        // ignore
      }
    }
    // Belt-and-braces: drop the directory if `worktree remove` left anything.
    try {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // Write state last
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
    // Best-effort state write - don't fail the whole operation
  }

  return {
    scored,
    skipped,
    cursor_before: cursorBefore,
    cursor_after: cursorAfter,
    status,
  };
}
