import { describe, expect, it } from 'vitest';
import { priceTokens, toMicroUsd, toNanoUsd } from './money.js';

describe('priceTokens', () => {
  it('prices 1,000 tokens at $3/MTok as 3,000,000 pico-USD ($0.003)', () => {
    expect(priceTokens(1_000, 3)).toBe(3_000_000_000n);
    expect(toNanoUsd(priceTokens(1_000, 3))).toBe(0.003);
  });

  it('prices zero tokens as 0n', () => {
    expect(priceTokens(0, 3)).toBe(0n);
  });

  it('prices MAX_SAFE_INTEGER tokens exactly (no float drift)', () => {
    // 2^53 - 1 tokens at $1/MTok = (2^53 - 1) × 10^6 pico-USD, exactly.
    const expected = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n;
    expect(priceTokens(Number.MAX_SAFE_INTEGER, 1)).toBe(expected);
  });

  it('handles fractional rates without accumulating drift', () => {
    // $0.15/MTok over 10M tokens = $1.50 exactly.
    expect(toNanoUsd(priceTokens(10_000_000, 0.15))).toBe(1.5);
  });

  it('returns 0n for non-finite, negative, or non-integer token counts', () => {
    expect(priceTokens(Number.NaN, 3)).toBe(0n);
    expect(priceTokens(Number.POSITIVE_INFINITY, 3)).toBe(0n);
    expect(priceTokens(-1, 3)).toBe(0n);
    expect(priceTokens(1.5, 3)).toBe(0n);
  });

  it('returns 0n for non-finite or negative rates', () => {
    expect(priceTokens(100, Number.NaN)).toBe(0n);
    expect(priceTokens(100, -3)).toBe(0n);
  });
});

describe('toNanoUsd', () => {
  it('converts pico to USD at nano precision', () => {
    expect(toNanoUsd(3_000_000_000n)).toBe(0.003);
    expect(toNanoUsd(0n)).toBe(0);
  });

  it('rounds half-up at the nano boundary', () => {
    expect(toNanoUsd(1_499n)).toBe(0.000000001);
    expect(toNanoUsd(1_500n)).toBe(0.000000002);
  });

  it('matches a hand-summed float within one nano-USD for many small values', () => {
    let pico = 0n;
    let float = 0;
    for (let i = 0; i < 10_000; i += 1) {
      pico += priceTokens(137, 3.3);
      float += (137 / 1e6) * 3.3;
    }
    expect(Math.abs(toNanoUsd(pico) - float)).toBeLessThanOrEqual(1e-9);
  });

  it('stays exact for very large totals', () => {
    const pico = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n; // MAX_SAFE tokens at $1/MTok
    expect(toNanoUsd(pico)).toBe(Number.MAX_SAFE_INTEGER / 1e6);
  });
});

describe('toMicroUsd', () => {
  it('converts pico to USD at micro precision', () => {
    expect(toMicroUsd(3_000_000_000n)).toBe(0.003);
  });

  it('rounds half-up at the micro boundary', () => {
    expect(toMicroUsd(1_499_999n)).toBe(0.000001);
    expect(toMicroUsd(1_500_000n)).toBe(0.000002);
  });

  it('matches computeActualCostUsd rounding convention (6 decimals)', () => {
    // 123 tokens at $3/MTok = $0.000369 exactly at micro precision.
    expect(toMicroUsd(priceTokens(123, 3))).toBe(0.000369);
  });
});
