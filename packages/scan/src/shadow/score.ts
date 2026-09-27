/**
 * Shadow scoring runner: extract features and score merged PRs.
 */

import type { GitRunner } from '../survival-labeller.js';
import type { CandidateFeaturesV1 } from '@hokusai/core';
import { extractCandidateFeatures } from '../candidate-features.js';
import type { ShadowScorer } from './scorer.js';
import { BASELINE_V0 } from './scorer.js';
import type { DiscoveredMerge } from './discover.js';
import type { ArbiterShadowScoreV1, ArbiterShadowStateV1, ArbiterShadowRunStatus } from '@hokusai/core';
import { validateShadowScoreRow } from '@hokusai/core';
import { ShadowError } from './errors.js';
import { discoverMerges, isAncestor } from './discover.js';
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
export async function runShadowScore(opts: RunShadowScoreOptions): Promise<RunShadowScoreResult> {
  const {
    dataDir,
    repo,
    githubRepo,
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
  let lastError: string | null = null;
  let cursorReset = false;

  try {
    // Discover merges
    const discovered = await discoverMerges({
      runGit,
      ref: integrationBranch,
      cursor: cursorBefore,
      bootstrapDays,
      now,
      maxPrs,
    });

    cursorReset = discovered.cursorReset;
    const rows: ArbiterShadowScoreV1[] = [];

    // Process each merge
    for (const merge of discovered.merges) {
      try {
        // Skip if already scored
        if (existingMergeShas.has(merge.mergeSha)) {
          skipped++;
          cursorAfter = merge.mergeSha;
          continue;
        }

        // Update git worktree HEAD to this merge
        await runGit(['update-ref', '--no-deref', 'HEAD', merge.mergeSha], { cwd: checkoutDir });

        // Extract features
        let features: CandidateFeaturesV1 | null = null;
        try {
          const result = await extractCandidateFeatures({
            checkoutDir,
            prNumber: merge.prNumber,
            baseRef: merge.parentSha,
            offline: true,
            staticFeatures: null,
          });
          features = result.features;
        } catch (error) {
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
      } catch (error) {
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
