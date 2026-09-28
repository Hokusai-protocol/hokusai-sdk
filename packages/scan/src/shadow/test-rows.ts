/**
 * Test-only builders for valid shadow rows and stub survival labels.
 * Not exported from the package index.
 */

import type {
  ArbiterShadowScoreV1,
  ArbiterSurvivalLabelV1,
  CandidateFeaturesV1,
} from '@hokusai/core';
import { CANDIDATE_FEATURES_SCHEMA_VERSION, CANDIDATE_FEATURE_FIELDS } from '@hokusai/core';

export function nullFeatures(): CandidateFeaturesV1 {
  return {
    schema_version: CANDIDATE_FEATURES_SCHEMA_VERSION,
    ...Object.fromEntries(CANDIDATE_FEATURE_FIELDS.map((field) => [field, null])),
  } as CandidateFeaturesV1;
}

/** Deterministic fake 40-hex SHA from a small integer. */
export function fakeSha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

export interface ScoreRowSpec {
  prNumber?: number | null;
  sha?: string;
  mergedAt: string;
  score?: number;
  threshold?: number;
  repo?: string;
}

export function scoreRow(n: number, spec: ScoreRowSpec): ArbiterShadowScoreV1 {
  const score = spec.score ?? 0.9;
  const threshold = spec.threshold ?? 0.5;
  return {
    schema_version: 'arbiter_shadow_score/v1',
    repo: spec.repo ?? 'o/r',
    pr_number: spec.prNumber === undefined ? n : spec.prNumber,
    merge_sha: spec.sha ?? fakeSha(n),
    merged_at: spec.mergedAt,
    scored_at: spec.mergedAt,
    scorer_id: 'baseline-v0',
    scorer_version: '0.1.0',
    score,
    threshold,
    would_flag: score < threshold,
    features: nullFeatures(),
  };
}

/** A full survival label (with empty line_ranges) as the labeller seam returns. */
export function stubLabel(
  mergeSha: string,
  prNumber: number,
  survived: boolean | null,
  reasonCodes: string[] = ['clean'],
): ArbiterSurvivalLabelV1 {
  return {
    schema_version: '1.0.0',
    prUrl: `https://github.com/o/r/pull/${prNumber}`,
    horizon_days: 30,
    label_provenance: 'harvested',
    line_ranges: [],
    outcome: {
      survived,
      survival_ratio: survived === null ? null : survived ? 1 : 0,
      reverted: survived === null ? null : !survived,
      undone_by: null,
      followup: survived === null ? null : false,
      report_outcome: survived === null ? null : survived ? 'survived' : 'reverted',
      reason_codes: reasonCodes as ArbiterSurvivalLabelV1['outcome']['reason_codes'],
    },
    envelope: {
      schema_version: '1.0.0',
      labeller_version: 'stub',
      normalization_version: 'stub',
      pr_head_sha: mergeSha,
      merge_sha: mergeSha,
      horizon_terminal_sha: mergeSha,
      integration_branch: 'auto/integration',
      computed_at: '2026-01-01T00:00:00.000Z',
    },
  };
}
