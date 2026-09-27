/**
 * baseline-v0 scorer tests: determinism (byte-stable), range clamping,
 * documented weight sensitivity, and purity over null features.
 */

import { describe, expect, it } from 'vitest';
import { BASELINE_V0, BASELINE_V0_WEIGHTS } from './scorer.js';
import { nullFeatures } from './test-rows.js';

describe('baseline-v0 scorer', () => {
  it('is deterministic: identical features give byte-identical scores', () => {
    const features = {
      ...nullFeatures(),
      loc_touched: 250,
      files_touched: 7,
      tests_changed: true,
      diff_uncertain: false,
    };
    const first = JSON.stringify(BASELINE_V0.score(features));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(BASELINE_V0.score(features))).toBe(first);
    }
  });

  it('stays in [0, 1] at the extremes', () => {
    const worst = {
      ...nullFeatures(),
      loc_touched: 1_000_000,
      files_touched: 10_000,
      tests_changed: false,
      diff_uncertain: true,
      type_errors: 1_000,
      lint_errors: 1_000,
      build_ok: false,
      complexity_delta: 1_000,
      change_requests: 100,
      review_rounds: 100,
    };
    const worstScore = BASELINE_V0.score(worst);
    expect(worstScore).toBeGreaterThanOrEqual(0);
    expect(worstScore).toBeLessThanOrEqual(1);

    const bestScore = BASELINE_V0.score({ ...nullFeatures(), tests_changed: true });
    expect(bestScore).toBeGreaterThanOrEqual(0);
    expect(bestScore).toBeLessThanOrEqual(1);
    expect(worstScore).toBeLessThan(bestScore);
  });

  it('all-null features score the documented baseline (logistic of baseZ)', () => {
    const expected =
      Math.round((1 / (1 + Math.exp(-BASELINE_V0_WEIGHTS.baseZ))) * 1_000_000) / 1_000_000;
    expect(BASELINE_V0.score(nullFeatures())).toBe(expected);
  });

  it('small tested PRs land high; very large untested PRs land below 0.5', () => {
    const small = BASELINE_V0.score({
      ...nullFeatures(),
      loc_touched: 40,
      files_touched: 2,
      tests_changed: true,
    });
    expect(small).toBeGreaterThan(0.8);

    const large = BASELINE_V0.score({
      ...nullFeatures(),
      loc_touched: 5_000,
      files_touched: 80,
      tests_changed: false,
      diff_uncertain: true,
    });
    expect(large).toBeLessThan(0.5);
  });

  it('a negative complexity delta is neutral, never a bonus', () => {
    const base = BASELINE_V0.score(nullFeatures());
    const reduced = BASELINE_V0.score({ ...nullFeatures(), complexity_delta: -100 });
    expect(reduced).toBe(base);
  });
});
