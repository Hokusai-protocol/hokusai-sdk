/**
 * Shadow outcome backfilling: label matured scored PRs with the existing
 * S2/S4 survival labeller and append validated outcome rows.
 *
 * Idempotent: an existing `(repo, merge_sha, horizon_days)` outcome is never
 * re-appended. Privacy (D4): the embedded label omits `line_ranges` (file
 * paths) and `owner_correction`.
 */

import { join } from 'node:path';
import type { ArbiterShadowOutcomeV1, ArbiterShadowScoreV1, HorizonDays } from '@hokusai/core';
import { validateShadowOutcomeRow, validateShadowScoreRow } from '@hokusai/core';
import {
  enumerateMergedPrs,
  labelMergedPr,
  type MergedPrRef,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
} from '../survival-labeller.js';
import { appendJsonl, ensureWritableDataDir, readJsonl } from './store.js';

export interface RunShadowBackfillOptions {
  dataDir: string;
  horizonDays: HorizonDays;
  target: SurvivalLabellerTarget;
  deps: SurvivalLabellerDeps;
  now: () => Date;
  log: (line: string) => void;
  /** Upper bound on the merged-PR enumeration walk. */
  maxCount?: number | undefined;
  /** Seam for tests: merged-PR enumeration. */
  enumerate?: typeof enumerateMergedPrs | undefined;
  /** Seam for tests: the survival labeller. */
  label?: typeof labelMergedPr | undefined;
}

export interface RunShadowBackfillResult {
  labelled: number;
  pending: number;
  skipped: number;
  unlabellable: number;
}

/** Backfill outcomes for matured scored PRs. */
export function runShadowBackfill(opts: RunShadowBackfillOptions): RunShadowBackfillResult {
  const {
    dataDir,
    horizonDays,
    target,
    deps,
    now,
    log,
    maxCount = 10000,
    enumerate = enumerateMergedPrs,
    label = labelMergedPr,
  } = opts;

  ensureWritableDataDir(dataDir);

  const scoresFile = join(dataDir, 'scores.jsonl');
  const outcomesFile = join(dataDir, 'outcomes.jsonl');

  const scoresResult = readJsonl(scoresFile, validateShadowScoreRow);
  const outcomesResult = readJsonl(outcomesFile, validateShadowOutcomeRow);

  const existingOutcomes = new Set(
    outcomesResult.rows.map((r) => `${r.repo}:${r.merge_sha}:${r.horizon_days}`),
  );

  const nowEpoch = Math.floor(now().getTime() / 1000);
  const horizonSeconds = horizonDays * 86400;

  // Filter to matured candidates first so the (potentially expensive)
  // enumeration only happens when there is work to do.
  const candidates: ArbiterShadowScoreV1[] = [];
  let pending = 0;
  let unlabellable = 0;
  for (const score of scoresResult.rows) {
    if (existingOutcomes.has(`${score.repo}:${score.merge_sha}:${horizonDays}`)) continue;

    const mergedAtEpoch = Math.floor(new Date(score.merged_at).getTime() / 1000);
    if (mergedAtEpoch + horizonSeconds > nowEpoch) {
      // Maturity is inclusive: merged_at + horizon == now counts as mature.
      pending++;
      continue;
    }

    if (score.pr_number === null) {
      unlabellable++;
      continue;
    }

    candidates.push(score);
  }

  const rows: ArbiterShadowOutcomeV1[] = [];
  let labelled = 0;
  let skipped = 0;

  if (candidates.length > 0) {
    const allMergedPrs = enumerate(target, deps, { maxCount });
    const byMergeSha = new Map<string, MergedPrRef>(allMergedPrs.map((p) => [p.mergeSha, p]));

    for (const score of candidates) {
      try {
        const prRef = byMergeSha.get(score.merge_sha);
        if (!prRef) {
          log(`SHADOW_SKIP pr=${score.pr_number} code=LABEL_FAILED`);
          skipped++;
          continue;
        }

        const labelResults = label(target, deps, prRef, {
          horizons: [horizonDays],
          allMergedPrs,
          includeLinkedReferences: false,
        });

        const result = labelResults[0];
        if (!result) {
          // No label for the horizon yet: retry next run.
          pending++;
          continue;
        }
        if (result.outcome.reason_codes.includes('missing_horizon')) {
          // Not yet mature by the labeller's clock: retry next run.
          pending++;
          continue;
        }

        // D4 privacy: strip line_ranges (file paths) and owner_correction.
        const outcome: ArbiterShadowOutcomeV1 = {
          schema_version: 'arbiter_shadow_outcome/v1',
          repo: score.repo,
          pr_number: score.pr_number,
          merge_sha: score.merge_sha,
          horizon_days: horizonDays,
          labelled_at: now().toISOString(),
          survived: result.outcome.survived,
          label: {
            schema_version: result.schema_version,
            prUrl: result.prUrl,
            horizon_days: result.horizon_days,
            label_provenance: result.label_provenance,
            outcome: result.outcome,
            envelope: result.envelope,
          },
        };

        const validation = validateShadowOutcomeRow(outcome);
        if (!validation.ok) {
          log(`SHADOW_SKIP pr=${score.pr_number} code=INVALID_ROW`);
          skipped++;
          continue;
        }

        rows.push(outcome);
        labelled++;
      } catch {
        log(`SHADOW_SKIP pr=${score.pr_number} code=LABEL_FAILED`);
        skipped++;
      }
    }

    if (rows.length > 0) {
      appendJsonl(outcomesFile, rows, validateShadowOutcomeRow);
    }
  }

  return { labelled, pending, skipped, unlabellable };
}
