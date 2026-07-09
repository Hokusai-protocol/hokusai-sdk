import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODEL_PRICING,
  ANTHROPIC_MODEL_PRICING_AS_OF,
  computeActualCostUsd,
  resolveModelPrice,
} from './pricing.js';

describe('resolveModelPrice', () => {
  it('resolves a known base model id', () => {
    expect(resolveModelPrice('claude-opus-4-8')).toEqual({
      inputPerMTokUsd: 5,
      outputPerMTokUsd: 25,
    });
  });

  it('strips a date snapshot suffix to resolve the base model', () => {
    expect(resolveModelPrice('claude-haiku-4-5-20251001')).toEqual(
      ANTHROPIC_MODEL_PRICING['claude-haiku-4-5'],
    );
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveModelPrice('  Claude-Sonnet-4-6 ')).toEqual({
      inputPerMTokUsd: 3,
      outputPerMTokUsd: 15,
    });
  });

  it('returns undefined for an unknown model', () => {
    expect(resolveModelPrice('gpt-5-codex')).toBeUndefined();
    expect(resolveModelPrice(undefined)).toBeUndefined();
    expect(resolveModelPrice('')).toBeUndefined();
  });
});

describe('computeActualCostUsd', () => {
  it('computes cost from token counts for a known model', () => {
    // 1M input @ $5 + 0.5M output @ $25 = 5 + 12.5 = 17.5
    expect(
      computeActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }),
    ).toBe(17.5);
  });

  it('rounds to micro-dollar precision', () => {
    // 1234 input @ $3/1M + 567 output @ $15/1M
    const expected =
      Math.round((1234 * 3 + 567 * 15)) / 1_000_000; // = 0.012207
    expect(
      computeActualCostUsd({
        model: 'claude-sonnet-4-6',
        inputTokens: 1234,
        outputTokens: 567,
      }),
    ).toBeCloseTo(expected, 9);
  });

  it('returns undefined (no fabricated cost) for an unknown model', () => {
    expect(
      computeActualCostUsd({
        model: 'some-unlisted-model',
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBeUndefined();
  });

  it('returns undefined for non-finite or negative token counts', () => {
    expect(
      computeActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: Number.NaN,
        outputTokens: 100,
      }),
    ).toBeUndefined();
    expect(
      computeActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: -1,
        outputTokens: 100,
      }),
    ).toBeUndefined();
  });

  it('documents an asOf date', () => {
    expect(ANTHROPIC_MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
