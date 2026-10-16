/** Deterministic confidence intervals used by descriptive report cells. */
export interface Interval { low: number; high: number }
export interface RatioInterval extends Interval { ratio: number }

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
function roundedInterval(low: number, high: number, value?: number): Interval {
  let lo = round4(Math.max(0, Math.min(1, low)));
  let hi = round4(Math.max(0, Math.min(1, high)));
  if (value !== undefined) {
    lo = Math.min(lo, round4(value));
    hi = Math.max(hi, round4(value));
  }
  return { low: lo, high: hi };
}

/** Wilson score interval for a binomial proportion; null when no observations exist. */
export function wilsonInterval(k: number, n: number, z = 1.959964): Interval | null {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n < 0 || k < 0 || k > n || !Number.isInteger(k) || !Number.isInteger(n) || z <= 0) {
    throw new RangeError('wilsonInterval requires integer counts with 0 <= k <= n and z > 0');
  }
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / den;
  return roundedInterval(center - half, center + half, p);
}

/** Katz log confidence interval for a risk ratio, with Haldane correction for zero cells. */
export function katzLogRatioInterval(k1: number, n1: number, k2: number, n2: number): RatioInterval {
  for (const [k, n] of [[k1, n1], [k2, n2]] as const) {
    if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) {
      throw new RangeError('katzLogRatioInterval requires integer counts with 0 <= k <= n');
    }
  }
  const corrected = [k1, n1 - k1, k2, n2 - k2].some((x) => x === 0);
  const a = k1 + (corrected ? 0.5 : 0);
  const b = n1 - k1 + (corrected ? 0.5 : 0);
  const c = k2 + (corrected ? 0.5 : 0);
  const d = n2 - k2 + (corrected ? 0.5 : 0);
  const ratio = (a / (a + b)) / (c / (c + d));
  const se = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  const low = Math.exp(Math.log(ratio) - 1.959964 * se);
  const high = Math.exp(Math.log(ratio) + 1.959964 * se);
  const r = round4(ratio);
  return { ratio: r, low: Math.min(r, round4(low)), high: Math.max(r, round4(high)) };
}

/** Nearest-rank quartile cut points for an ascending numeric sample. */
export function nearestRankQuartiles(sorted: readonly number[]): [number, number, number] | null {
  if (!sorted.length) return null;
  for (let i = 0; i < sorted.length; i++) {
    if (!Number.isFinite(sorted[i]) || (i > 0 && sorted[i]! < sorted[i - 1]!)) {
      throw new RangeError('nearestRankQuartiles requires finite ascending values');
    }
  }
  const at = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
  return [at(0.25), at(0.5), at(0.75)];
}

/** Ties stay in the lower quartile, including coincident cut points. */
export function quartileOf(value: number, cuts: readonly [number, number, number]): 'q1' | 'q2' | 'q3' | 'q4' {
  if (!Number.isFinite(value) || cuts.some((n, i) => !Number.isFinite(n) || (i > 0 && n < cuts[i - 1]!))) {
    throw new RangeError('quartileOf requires finite values and ascending cuts');
  }
  return value <= cuts[0] ? 'q1' : value <= cuts[1] ? 'q2' : value <= cuts[2] ? 'q3' : 'q4';
}
