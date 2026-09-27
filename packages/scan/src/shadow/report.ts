/**
 * Shadow report generation: compute would-be flag rate, precision and
 * false-positive rate per repo over a window, plus a threshold sweep.
 *
 * Metric definitions (denominator 0 → null, never 0 or NaN):
 * - would_flag_rate      = flagged / n_scored
 * - precision            = (flagged ∧ ¬survived) / (flagged ∧ matured)
 * - false_positive_rate  = (flagged ∧ survived) / (survived ∧ matured)
 * - base_survival_rate   = survived / n_matured
 *
 * "Matured" means an outcome row exists with `survived !== null`; outcome
 * rows with `survived: null` (labeller-declared missing) are counted as
 * `n_unlabelled` and excluded from every outcome-based denominator.
 */

import { join } from 'node:path';
import type { ArbiterShadowOutcomeV1, ArbiterShadowScoreV1 } from '@hokusai/core';
import { validateShadowOutcomeRow, validateShadowScoreRow } from '@hokusai/core';
import { ensureWritableDataDir, readJsonl, writeReport } from './store.js';

export interface ThresholdSweepEntry {
  threshold: number;
  would_flag_count: number;
  would_flag_rate: number | null;
  precision: number | null;
  false_positive_rate: number | null;
}

export interface ReportMetrics {
  repo: string;
  n_scored: number;
  n_matured: number;
  n_unlabelled: number;
  n_flagged: number;
  would_flag_rate: number | null;
  precision: number | null;
  false_positive_rate: number | null;
  base_survival_rate: number | null;
  /** The most frequent (scorer_id, scorer_version) pair in the window. */
  scorer_id: string;
  scorer_version: string;
  /** True when the window mixes more than one scorer id/version pair. */
  scorer_mixed: boolean;
  threshold_sweep: ThresholdSweepEntry[];
}

export interface ShadowReport {
  schema_version: 'arbiter_shadow_report/v1';
  generated_at: string;
  window_days: number;
  horizon_days: number;
  malformed_lines: { scores: number; outcomes: number };
  repos: ReportMetrics[];
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : round4(n / d);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface ComputeReportOptions {
  windowDays: number;
  horizonDays: number;
  now: () => Date;
  thresholds?: number[] | undefined;
}

const SWEEP_THRESHOLDS = Array.from({ length: 19 }, (_, i) => round4((i + 1) * 0.05));

interface RepoMetricInputs {
  scores: ArbiterShadowScoreV1[];
  outcomeFor: (score: ArbiterShadowScoreV1) => ArbiterShadowOutcomeV1 | undefined;
}

function metricsAtThreshold(
  { scores, outcomeFor }: RepoMetricInputs,
  threshold: number,
): { flagged: number; flaggedMatured: number; flaggedNotSurvived: number; flaggedSurvived: number; survived: number } {
  let flagged = 0;
  let flaggedMatured = 0;
  let flaggedNotSurvived = 0;
  let flaggedSurvived = 0;
  let survived = 0;

  for (const score of scores) {
    const isFlagged = score.score < threshold;
    if (isFlagged) flagged++;

    const outcome = outcomeFor(score);
    if (!outcome || outcome.survived === null) continue;

    if (outcome.survived) survived++;
    if (isFlagged) {
      flaggedMatured++;
      if (outcome.survived) flaggedSurvived++;
      else flaggedNotSurvived++;
    }
  }

  return { flagged, flaggedMatured, flaggedNotSurvived, flaggedSurvived, survived };
}

/** Pure report computation over already-loaded rows. */
export function computeShadowReport(
  scores: ArbiterShadowScoreV1[],
  outcomes: ArbiterShadowOutcomeV1[],
  opts: ComputeReportOptions,
): ShadowReport {
  const { windowDays, horizonDays, now, thresholds = SWEEP_THRESHOLDS } = opts;

  const nowTime = now();
  const cutoff = new Date(nowTime.getTime() - windowDays * 86400 * 1000);
  const windowScores = scores.filter((s) => new Date(s.merged_at) >= cutoff);

  const outcomesByKey = new Map<string, ArbiterShadowOutcomeV1>();
  for (const o of outcomes) {
    if (o.horizon_days === horizonDays) {
      outcomesByKey.set(`${o.repo}:${o.merge_sha}`, o);
    }
  }
  const outcomeFor = (score: ArbiterShadowScoreV1): ArbiterShadowOutcomeV1 | undefined =>
    outcomesByKey.get(`${score.repo}:${score.merge_sha}`);

  const repoScores = new Map<string, ArbiterShadowScoreV1[]>();
  for (const s of windowScores) {
    const list = repoScores.get(s.repo);
    if (list) list.push(s);
    else repoScores.set(s.repo, [s]);
  }

  const repos: ReportMetrics[] = [];
  for (const [repo, scored] of repoScores.entries()) {
    const inputs: RepoMetricInputs = { scores: scored, outcomeFor };
    const n_scored = scored.length;

    let n_matured = 0;
    let n_unlabelled = 0;
    for (const score of scored) {
      const outcome = outcomeFor(score);
      if (!outcome) continue;
      if (outcome.survived === null) n_unlabelled++;
      else n_matured++;
    }

    // The recorded threshold (most recent row wins on mixed thresholds).
    const lastScore = scored[scored.length - 1];
    const mainThreshold = lastScore ? lastScore.threshold : 0.5;
    const main = metricsAtThreshold(inputs, mainThreshold);

    // Most frequent scorer pair in the window; flag mixed-scorer windows.
    const scorerCounts = new Map<string, number>();
    for (const score of scored) {
      const key = `${score.scorer_id}\u0000${score.scorer_version}`;
      scorerCounts.set(key, (scorerCounts.get(key) ?? 0) + 1);
    }
    let topScorerKey = '';
    let topScorerCount = -1;
    for (const [key, count] of scorerCounts.entries()) {
      if (count > topScorerCount) {
        topScorerKey = key;
        topScorerCount = count;
      }
    }
    const [topScorerId = 'unknown', topScorerVersion = 'unknown'] = topScorerKey.split('\u0000');

    const threshold_sweep: ThresholdSweepEntry[] = thresholds.map((t) => {
      const m = metricsAtThreshold(inputs, t);
      return {
        threshold: round4(t),
        would_flag_count: m.flagged,
        would_flag_rate: ratio(m.flagged, n_scored),
        precision: ratio(m.flaggedNotSurvived, m.flaggedMatured),
        false_positive_rate: ratio(m.flaggedSurvived, m.survived),
      };
    });

    repos.push({
      repo,
      n_scored,
      n_matured,
      n_unlabelled,
      n_flagged: main.flagged,
      would_flag_rate: ratio(main.flagged, n_scored),
      precision: ratio(main.flaggedNotSurvived, main.flaggedMatured),
      false_positive_rate: ratio(main.flaggedSurvived, main.survived),
      base_survival_rate: ratio(main.survived, n_matured),
      scorer_id: topScorerId,
      scorer_version: topScorerVersion,
      scorer_mixed: scorerCounts.size > 1,
      threshold_sweep,
    });
  }

  return {
    schema_version: 'arbiter_shadow_report/v1',
    generated_at: nowTime.toISOString(),
    window_days: windowDays,
    horizon_days: horizonDays,
    malformed_lines: { scores: 0, outcomes: 0 },
    repos: repos.sort((a, b) => a.repo.localeCompare(b.repo)),
  };
}

export interface RunShadowReportOptions {
  dataDir: string;
  windowDays: number;
  horizonDays: number;
  now: () => Date;
  log: (line: string) => void;
}

/** Load rows, compute the report, write `reports/<date>.json`, print to stdout. */
export function runShadowReport(opts: RunShadowReportOptions): ShadowReport {
  const { dataDir, windowDays, horizonDays, now, log } = opts;

  // Surface an unwritable data dir as DATA_DIR_UNWRITABLE, not INTERNAL.
  ensureWritableDataDir(dataDir);

  const scoresResult = readJsonl(join(dataDir, 'scores.jsonl'), validateShadowScoreRow);
  const outcomesResult = readJsonl(join(dataDir, 'outcomes.jsonl'), validateShadowOutcomeRow);

  const report = computeShadowReport(scoresResult.rows, outcomesResult.rows, {
    windowDays,
    horizonDays,
    now,
  });
  report.malformed_lines.scores = scoresResult.malformed;
  report.malformed_lines.outcomes = outcomesResult.malformed;

  const serialized = JSON.stringify(report, null, 2);
  const date = now().toISOString().slice(0, 10);
  writeReport(dataDir, date, serialized);
  log(serialized);
  return report;
}
