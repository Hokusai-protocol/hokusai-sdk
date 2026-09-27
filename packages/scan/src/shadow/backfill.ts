/**
 * Shadow outcome backfilling: label matured PRs.
 */

import type { SurvivalLabellerDeps, SurvivalLabellerTarget, MergedPrRef } from '../survival-labeller.js';
import { labelMergedPr, enumerateMergedPrs } from '../survival-labeller.js';
import type { ArbiterShadowScoreV1, ArbiterShadowOutcomeV1, HorizonDays } from '@hokusai/core';
import { validateShadowOutcomeRow, HORIZONS } from '@hokusai/core';
import { readJsonl, appendJsonl } from './store.js';

export interface RunShadowBackfillOptions {
  dataDir: string;
  repo: string;
  githubRepo: string;
  integrationBranch: string;
  horizonDays: HorizonDays;
  checkoutDir: string;
  target: SurvivalLabellerTarget;
  deps: SurvivalLabellerDeps;
  now: () => Date;
  log: (line: string) => void;
}

export interface RunShadowBackfillResult {
  labelled: number;
  pending: number;
  skipped: number;
  unlabellable: number;
}

/** Backfill outcomes for matured scored PRs. */
export async function runShadowBackfill(opts: RunShadowBackfillOptions): Promise<RunShadowBackfillResult> {
  const {
    dataDir,
    repo,
    integrationBranch,
    horizonDays,
    target,
    deps,
    now,
    log,
  } = opts;

  // Load scores and outcomes
  const scoresFile = `${dataDir}/scores.jsonl`;
  const outcomesFile = `${dataDir}/outcomes.jsonl`;

  const scoresResult = readJsonl(scoresFile, (row: unknown) => {
    const r = row as Partial<ArbiterShadowScoreV1>;
    return {
      ok: r.schema_version === 'arbiter_shadow_score/v1' && !!r.merge_sha,
      value: r as ArbiterShadowScoreV1,
    };
  });

  const outcomesResult = readJsonl(outcomesFile, (row: unknown) => {
    const r = row as Partial<ArbiterShadowOutcomeV1>;
    return {
      ok: r.schema_version === 'arbiter_shadow_outcome/v1' && !!r.merge_sha,
      value: r as ArbiterShadowOutcomeV1,
    };
  });

  // Index existing outcomes
  const existingOutcomes = new Set(
    outcomesResult.rows.map(r => `${r.merge_sha}:${r.horizon_days}`),
  );

  // Get merged PRs for labelling
  const allMergedPrsResult = await enumerateMergedPrs(target, deps, { maxCount: 10000 });

  const now_epoch = Math.floor(now().getTime() / 1000);
  const horizon_seconds = horizonDays * 86400;

  const rows: ArbiterShadowOutcomeV1[] = [];
  let labelled = 0;
  let pending = 0;
  let skipped = 0;
  let unlabellable = 0;

  for (const score of scoresResult.rows) {
    const outcomeKey = `${score.merge_sha}:${horizonDays}`;

    // Skip if already has outcome for this horizon
    if (existingOutcomes.has(outcomeKey)) {
      continue;
    }

    // Check if mature
    const mergedAtEpoch = Math.floor(new Date(score.merged_at).getTime() / 1000);
    if (mergedAtEpoch + horizon_seconds > now_epoch) {
      pending++;
      continue;
    }

    // Skip if pr_number is null
    if (score.pr_number === null) {
      unlabellable++;
      continue;
    }

    try {
      // Look up in all merged PRs
      const prRef = allMergedPrsResult.find(p => p.prNumber === score.pr_number);
      if (!prRef) {
        skipped++;
        continue;
      }

      // Label
      const labelResult = await labelMergedPr(target, deps, prRef, {
        horizons: [horizonDays],
        allMergedPrs: allMergedPrsResult,
        includeLinkedReferences: false,
      });

      if (!labelResult || !labelResult.label) {
        // Missing label - skip for now, retry later
        if (labelResult?.reason === 'missing_horizon') {
          // Not yet mature for this horizon
          pending++;
        } else {
          skipped++;
        }
        continue;
      }

      // Build outcome row
      const outcome: ArbiterShadowOutcomeV1 = {
        schema_version: 'arbiter_shadow_outcome/v1',
        repo: score.repo,
        pr_number: score.pr_number,
        merge_sha: score.merge_sha,
        horizon_days: horizonDays,
        labelled_at: now().toISOString(),
        survived: labelResult.label.outcome.survived,
        label: {
          schema_version: labelResult.label.schema_version,
          prUrl: labelResult.label.prUrl,
          horizon_days: labelResult.label.horizon_days,
          label_provenance: labelResult.label.label_provenance,
          outcome: labelResult.label.outcome,
          envelope: labelResult.label.envelope,
        },
      };

      // Validate
      const validation = validateShadowOutcomeRow(outcome);
      if (!validation.ok) {
        skipped++;
        continue;
      }

      rows.push(outcome);
      labelled++;
      existingOutcomes.add(outcomeKey);
    } catch (error) {
      log(`SHADOW_SKIP pr=${score.pr_number} code=LABEL_FAILED`);
      skipped++;
    }
  }

  // Append outcomes
  if (rows.length > 0) {
    appendJsonl(outcomesFile, rows, validateShadowOutcomeRow);
  }

  return {
    labelled,
    pending,
    skipped,
    unlabellable,
  };
}
