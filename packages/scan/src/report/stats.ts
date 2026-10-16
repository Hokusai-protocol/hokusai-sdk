/** Rounded descriptive statistics used by arbiter_report/v1. */
const Z = 1.959963984540054;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function wilsonInterval(k: number, n: number): { low: number; high: number } | null {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) throw new RangeError('Invalid binomial counts');
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + Z * Z / n;
  const center = (p + Z * Z / (2 * n)) / denominator;
  const radius = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / denominator;
  return { low: round4(Math.max(0, center - radius)), high: round4(Math.min(1, center + radius)) };
}

/** Katz log risk ratio; zero cells receive Haldane–Anscombe correction. */
export function katzLogRatioInterval(k1: number, n1: number, k2: number, n2: number): { ratio: number; low: number; high: number } | null {
  if (![k1, n1, k2, n2].every(Number.isInteger) || n1 < 0 || n2 < 0 || k1 < 0 || k2 < 0 || k1 > n1 || k2 > n2) throw new RangeError('Invalid risk counts');
  if (n1 === 0 || n2 === 0) return null;
  const correction = [k1, n1 - k1, k2, n2 - k2].some((n) => n === 0) ? 0.5 : 0;
  const a = k1 + correction;
  const b = n1 + 2 * correction;
  const c = k2 + correction;
  const d = n2 + 2 * correction;
  const ratio = (a / b) / (c / d);
  const se = Math.sqrt(1 / a - 1 / b + 1 / c - 1 / d);
  return { ratio: round4(ratio), low: round4(Math.min(ratio, Math.exp(Math.log(ratio) - Z * se))), high: round4(Math.max(ratio, Math.exp(Math.log(ratio) + Z * se))) };
}

export function nearestRankQuartiles(values: readonly number[]): readonly [number, number, number] | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some((v) => !Number.isFinite(v))) throw new RangeError('Non-finite quartile value');
  return [0.25, 0.5, 0.75].map((p) => sorted[Math.ceil(sorted.length * p) - 1]!) as unknown as readonly [number, number, number];
}

export function quartileOf(value: number, cuts: readonly [number, number, number]): 'q1' | 'q2' | 'q3' | 'q4' {
  return value <= cuts[0] ? 'q1' : value <= cuts[1] ? 'q2' : value <= cuts[2] ? 'q3' : 'q4';
}
