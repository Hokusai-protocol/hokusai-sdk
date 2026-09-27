/**
 * Shadow report generation: compute metrics over scored and labelled PRs.
 */

import type { ArbiterShadowScoreV1, ArbiterShadowOutcomeV1 } from '@hokusai/core';
import { readJsonl, writeReport } from './store.js';

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
  scorer_id: string;
  scorer_version: string;
  threshold_sweep: Array<{
    threshold: number;
    would_flag_count: number;
    precision: number | null;
    false_positive_rate: number | null;
  }>;
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
  return d === 0 ? null : n / d;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface ComputeReportOptions {
  windowDays: number;
  horizonDays: number;
  now: () => Date;
  thresholds?: number[];
}

export function computeShadowReport(
  scores: ArbiterShadowScoreV1[],
  outcomes: ArbiterShadowOutcomeV1[],
  opts: ComputeReportOptions,
): ShadowReport {
  const { windowDays, horizonDays, now, thresholds = [] } = opts;

  const now_time = now();
  const cutoff = new Date(now_time.getTime() - windowDays * 86400 * 1000);

  // Filter to window
  const windowScores = scores.filter(s => new Date(s.merged_at) >= cutoff);

  // Index outcomes
  const outcomesByKey = new Map<string, ArbiterShadowOutcomeV1>();
  for (const o of outcomes) {
    if (o.horizon_days === horizonDays) {
      outcomesByKey.set(`${o.merge_sha}`, o);
    }
  }

  // Group by repo
  const repoScores = new Map<string, ArbiterShadowScoreV1[]>();
  for (const s of windowScores) {
    if (!repoScores.has(s.repo)) {
      repoScores.set(s.repo, []);
    }
    repoScores.get(s.repo)!.push(s);
  }

  // Compute metrics per repo
  const repos: ReportMetrics[] = [];
  for (const [repo, repoScoredList] of repoScores.entries()) {
    const n_scored = repoScoredList.length;

    // Count flagged at main threshold
    const mainThreshold = repoScoredList[0]?.threshold ?? 0.5;
    let n_flagged = 0;
    let n_matured = 0;
    let n_unlabelled = 0;
    let flagged_survived = 0;
    let flagged_not_survived = 0;
    let survived_total = 0;

    for (const score of repoScoredList) {
      const flagged = score.score < mainThreshold;

      // Flagging is independent of maturity: count over all scored rows.
      if (flagged) {
        n_flagged++;
      }

      const outcome = outcomesByKey.get(score.merge_sha);
      if (!outcome) {
        continue;
      }

      if (outcome.survived === null) {
        // Matured but unlabellable: excluded from matured denominators.
        n_unlabelled++;
        continue;
      }

      // Matured and labelled.
      n_matured++;

      if (flagged) {
        if (outcome.survived) {
          flagged_survived++;
        } else {
          flagged_not_survived++;
        }
      }

      if (outcome.survived) {
        survived_total++;
      }
    }

    const flagged_matured = flagged_survived + flagged_not_survived;
    const would_flag_rate = ratio(n_flagged, n_scored);
    const precision = ratio(flagged_not_survived, flagged_matured);
    const false_positive_rate = ratio(flagged_survived, survived_total);
    const base_survival_rate = ratio(survived_total, n_matured);

    // Threshold sweep
    const sweep_thresholds = thresholds.length > 0 ? thresholds : Array.from({ length: 19 }, (_, i) => (i + 1) * 0.05);
    const threshold_sweep = sweep_thresholds.map(t => {
      let sweep_flagged = 0;
      let sweep_flagged_not_survived = 0;
      let sweep_survived = 0;

      let sweep_flagged_matured = 0;
      let sweep_flagged_survived = 0;

      for (const score of repoScoredList) {
        const flagged = score.score < t;

        // would_flag_count is independent of maturity: count over all scored.
        if (flagged) {
          sweep_flagged++;
        }

        const outcome = outcomesByKey.get(score.merge_sha);
        if (!outcome || outcome.survived === null) {
          continue;
        }

        if (flagged) {
          sweep_flagged_matured++;
          if (outcome.survived) {
            sweep_flagged_survived++;
          } else {
            sweep_flagged_not_survived++;
          }
        }

        if (outcome.survived) {
          sweep_survived++;
        }
      }

      return {
        threshold: round4(t),
        would_flag_count: sweep_flagged,
        precision: ratio(sweep_flagged_not_survived, sweep_flagged_matured),
        false_positive_rate: ratio(sweep_flagged_survived, sweep_survived),
      };
    });

    const scorerId = repoScoredList[0]?.scorer_id ?? 'unknown';
    const scorerVersion = repoScoredList[0]?.scorer_version ?? 'unknown';

    repos.push({
      repo,
      n_scored,
      n_matured,
      n_unlabelled,
      n_flagged,
      would_flag_rate: would_flag_rate === null ? null : round4(would_flag_rate),
      precision: precision === null ? null : round4(precision),
      false_positive_rate: false_positive_rate === null ? null : round4(false_positive_rate),
      base_survival_rate: base_survival_rate === null ? null : round4(base_survival_rate),
      scorer_id: scorerId,
      scorer_version: scorerVersion,
      threshold_sweep,
    });
  }

  return {
    schema_version: 'arbiter_shadow_report/v1',
    generated_at: now_time.toISOString(),
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

export function runShadowReport(opts: RunShadowReportOptions): void {
  const { dataDir, windowDays, horizonDays, now, log } = opts;

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

  // Compute report
  const report = computeShadowReport(scoresResult.rows, outcomesResult.rows, {
    windowDays,
    horizonDays,
    now,
  });

  // Add malformed counts
  report.malformed_lines.scores = scoresResult.malformed;
  report.malformed_lines.outcomes = outcomesResult.malformed;

  // Write to disk and stdout
  const date = now().toISOString().slice(0, 10);
  writeReport(dataDir, date, report);
  log(JSON.stringify(report));
}
