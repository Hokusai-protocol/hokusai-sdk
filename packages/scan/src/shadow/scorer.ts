/**
 * Shadow mode scorer interface and baseline implementation.
 */

import type { CandidateFeaturesV1, StaticFeaturesResult } from '@hokusai/core';

/** Scorer interface: pure function to score candidate features. */
export interface ShadowScorer {
  readonly id: string;
  readonly version: string;
  score(features: CandidateFeaturesV1): number;
}

/** Baseline v0 weights: tuned so small PRs land around 0.85–0.9, very large test-less PRs fall below 0.5. */
export const BASELINE_V0_WEIGHTS = Object.freeze({
  baseZ: 2.0,
  locPenalty: 0.35,
  locSaturation: 2000,
  filePenalty: 0.25,
  fileSaturation: 50,
  testBonus: 0.4,
  uncertainPenalty: 0.5,
  typeErrorPenalty: 0.3,
  typeErrorSaturation: 20,
  lintErrorPenalty: 0.3,
  lintErrorSaturation: 50,
  buildFailPenalty: 0.6,
  complexityDeltaPenalty: 0.2,
  complexityDeltaSaturation: 50,
  changeRequestsPenalty: 0.15,
  changeRequestsSaturation: 5,
  reviewRoundsPenalty: 0.05,
  reviewRoundsSaturation: 10,
});

/** Null static features result (no tool execution in shadow mode). */
export const NULL_STATIC_FEATURES: StaticFeaturesResult = Object.freeze({
  type_errors: null,
  lint_errors: null,
  build_ok: null,
  build_warnings: null,
  complexity_delta: null,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Logistic function: 1 / (1 + e^(-z)). */
function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Round to 6 decimal places for byte-stable output. */
function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

/**
 * Baseline v0 scorer: deterministic logistic over candidate features.
 * All null features contribute 0 (no penalty, no bonus).
 */
export const BASELINE_V0: ShadowScorer = Object.freeze({
  id: 'baseline-v0',
  version: '0.1.0',

  score(features: CandidateFeaturesV1): number {
    const w = BASELINE_V0_WEIGHTS;
    let z = w.baseZ;

    // Size penalties
    const locTouched = features.loc_touched ?? 0;
    z -= (w.locPenalty * Math.log2(1 + locTouched)) / Math.log2(1 + w.locSaturation) * 4;

    const filesTouched = features.files_touched ?? 0;
    z -= (w.filePenalty * Math.min(filesTouched, w.fileSaturation)) / w.fileSaturation * 4;

    // Test bonus
    if (features.tests_changed) {
      z += w.testBonus;
    }

    // Uncertainty penalty
    if (features.diff_uncertain) {
      z -= w.uncertainPenalty;
    }

    // Static analysis penalties
    const typeErrors = features.type_errors ?? 0;
    z -= (w.typeErrorPenalty * Math.min(typeErrors, w.typeErrorSaturation)) / w.typeErrorSaturation;

    const lintErrors = features.lint_errors ?? 0;
    z -= (w.lintErrorPenalty * Math.min(lintErrors, w.lintErrorSaturation)) / w.lintErrorSaturation;

    // Build failure penalty
    if (features.build_ok === false) {
      z -= w.buildFailPenalty;
    }

    // Complexity delta penalty
    const complexityDelta = features.complexity_delta ?? 0;
    z -= (w.complexityDeltaPenalty * Math.min(complexityDelta, w.complexityDeltaSaturation)) / w.complexityDeltaSaturation;

    // Review signals penalties
    const changeRequests = features.change_requests ?? 0;
    z -= w.changeRequestsPenalty * Math.min(changeRequests, w.changeRequestsSaturation);

    const reviewRounds = features.review_rounds ?? 0;
    z -= w.reviewRoundsPenalty * Math.min(reviewRounds, w.reviewRoundsSaturation);

    // Compute score
    const rawScore = logistic(z);
    const clamped = clamp(rawScore, 0, 1);
    return round6(clamped);
  },
});
