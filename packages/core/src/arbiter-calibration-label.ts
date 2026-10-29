/**
 * Arbiter human-calibration label taxonomy (HOK-3269).
 *
 * A person reads a sampled PR and its candidate fixes and records whether
 * the follow-up work was corrective, why (a cause code, HOK-3047), and, when
 * it was not, which exclusion applies (the human half of
 * {@link EXCLUSION_CODES}, HOK-3048). These labels are their own stream:
 * they never become `owner_corrected` S2 rows, and they are label-side
 * evidence only, never merge-time features.
 *
 * Calibration labels stay private (they score the corrective definition);
 * only aggregate validation tables are published.
 */

import type { ExclusionCode } from './arbiter-corrective-rework.js';

/** Version of this taxonomy. Bump when a code is added, merged, split or retired. */
export const CALIBRATION_TAXONOMY_VERSION = '1.0.0';

/** "Was this PR followed within the horizon by corrective work?" `unclear` is a legitimate answer, never forced. */
export const CALIBRATION_VERDICTS = ['yes', 'no', 'unclear'] as const;
export type CalibrationVerdict = (typeof CALIBRATION_VERDICTS)[number];

/**
 * Why the change needed rework, each defined by observable evidence:
 * - `missing_context`: the fix touches files the original didn't, which existed at merge and were graph-adjacent.
 * - `blast_radius`: breakage lands in files the original never touched but which depend on it.
 * - `test_gap`: CI was green at merge; the fix adds or changes tests on paths the original touched but didn't cover.
 * - `plan_error`: the fix rewrites rather than patches (high file overlap, low survival of the original's lines).
 * - `local_generation_error`: the fix is small and local, in the same function; the original's lines mostly survive.
 * - `dependency_drift`: the fix is in lockfiles or config; the original code is substantially untouched.
 * - `review_gap`: no review, or review metadata shows it was cursory.
 * - `not_rework`: escape; the verdict is `no` and an exclusion code says why.
 * - `unclear`: escape.
 * `stale_context` is deliberately absent: it needs a logged context packet, which public history lacks.
 */
export const CAUSE_CODES = [
  'missing_context',
  'blast_radius',
  'test_gap',
  'plan_error',
  'local_generation_error',
  'dependency_drift',
  'review_gap',
  'not_rework',
  'unclear',
] as const;
export type CauseCode = (typeof CAUSE_CODES)[number];

/** Exclusion codes a person can assign: the shared human taxonomy, not the automatic pre-acceptance codes. */
export const HUMAN_EXCLUSION_CODES = [
  'planned_iteration',
  'requirement_change',
  'unrelated_edit',
  'refactor',
  'revert_non_defect',
  'linkage_error',
] as const satisfies readonly ExclusionCode[];
export type HumanExclusionCode = (typeof HUMAN_EXCLUSION_CODES)[number];
