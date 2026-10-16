import { describe, expect, it } from 'vitest';
import { katzLogRatioInterval, nearestRankQuartiles, quartileOf, wilsonInterval } from './stats.js';

describe('report confidence interval primitives', () => {
  it('computes Wilson reference intervals and empty samples', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(0, 10)).toEqual({ low: 0, high: 0.2775 });
    expect(wilsonInterval(5, 10)).toEqual({ low: 0.2366, high: 0.7634 });
    expect(wilsonInterval(10, 10)).toEqual({ low: 0.7225, high: 1 });
    expect(wilsonInterval(20, 20)).toEqual({ low: 0.8389, high: 1 });
  });
  it('computes finite Katz intervals including zero cells', () => {
    expect(katzLogRatioInterval(10, 20, 5, 20)).toEqual({ ratio: 2, low: 0.8325, high: 4.8051 });
    const zero = katzLogRatioInterval(0, 10, 2, 10);
    expect(Number.isFinite(zero.low) && zero.low <= zero.ratio && zero.ratio <= zero.high).toBe(true);
  });
  it('uses deterministic nearest ranks and puts ties in the lower quartile', () => {
    expect(nearestRankQuartiles([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([2, 4, 6]);
    expect(quartileOf(4, [4, 4, 4])).toBe('q1');
    expect(nearestRankQuartiles([])).toBeNull();
  });
  it('keeps Wilson intervals ordered and bounded across a count sweep', () => {
    for (let n = 1; n <= 60; n++) for (let k = 0; k <= n; k++) {
      const ci = wilsonInterval(k, n)!;
      expect(ci.low).toBeGreaterThanOrEqual(0);
      expect(ci.high).toBeLessThanOrEqual(1);
      expect(ci.low).toBeLessThanOrEqual(Math.round((k / n) * 10_000) / 10_000);
      expect(ci.high).toBeGreaterThanOrEqual(Math.round((k / n) * 10_000) / 10_000);
    }
  });
});
