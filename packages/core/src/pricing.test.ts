import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODEL_PRICING,
  ANTHROPIC_MODEL_PRICING_AS_OF,
  GOOGLE_MODEL_PRICING,
  MODEL_PRICING_AS_OF,
  OPENAI_MODEL_PRICING,
  computeActualCostUsd,
  normalizeModelId,
  resolveModelPrice,
} from './pricing.js';

describe('normalizeModelId', () => {
  it('lowercases and trims base ids', () => {
    expect(normalizeModelId(' GPT-4O ')).toBe('gpt-4o');
  });

  it('strips known provider prefixes', () => {
    expect(normalizeModelId('openai/gpt-4o')).toBe('gpt-4o');
    expect(normalizeModelId('anthropic/claude-sonnet-4.6')).toBe('claude-sonnet-4-6');
  });

  it('strips nested provider prefixes', () => {
    expect(normalizeModelId('openrouter/anthropic/claude-sonnet-4.6')).toBe(
      'claude-sonnet-4-6',
    );
    expect(normalizeModelId('litellm/google/gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });

  it('preserves empty and garbage inputs without throwing', () => {
    expect(normalizeModelId('')).toBe('');
    expect(normalizeModelId('///')).toBe('///');
  });

  it('does not strip unknown vendor prefixes', () => {
    expect(normalizeModelId('unknownvendor/foo')).toBe('unknownvendor/foo');
  });
});

describe('resolveModelPrice', () => {
  it('resolves a known base model id', () => {
    expect(resolveModelPrice('claude-opus-4-8')).toEqual({
      inputPerMTokUsd: 5,
      outputPerMTokUsd: 25,
    });
  });

  it('strips an Anthropic snapshot suffix to resolve the base model', () => {
    expect(resolveModelPrice('anthropic/claude-haiku-4.5-20251001')).toEqual(
      ANTHROPIC_MODEL_PRICING['claude-haiku-4-5'],
    );
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveModelPrice('  Claude-Sonnet-4-6 ')).toEqual({
      inputPerMTokUsd: 3,
      outputPerMTokUsd: 15,
    });
  });

  it('resolves known OpenAI and Gemini models', () => {
    expect(resolveModelPrice('gpt-4o')).toEqual(OPENAI_MODEL_PRICING['gpt-4o']);
    expect(resolveModelPrice('gemini-2.5-pro')).toEqual(GOOGLE_MODEL_PRICING['gemini-2.5-pro']);
  });

  it('treats provider-prefixed aliases the same as the bare model id', () => {
    expect(resolveModelPrice('openrouter/anthropic/claude-sonnet-4.6')).toEqual(
      resolveModelPrice('claude-sonnet-4-6'),
    );
    expect(resolveModelPrice('OPENAI/GPT-4O-mini')).toEqual(
      OPENAI_MODEL_PRICING['gpt-4o-mini'],
    );
    expect(resolveModelPrice('google/gemini-2.0-flash-001')).toEqual(
      GOOGLE_MODEL_PRICING['gemini-2.0-flash'],
    );
  });

  it('strips an OpenAI dashed snapshot suffix when present', () => {
    expect(resolveModelPrice('gpt-4o-2024-08-06')).toEqual(OPENAI_MODEL_PRICING['gpt-4o']);
  });

  it('returns undefined for an unknown model', () => {
    expect(resolveModelPrice('totally-made-up-model')).toBeUndefined();
    expect(resolveModelPrice('openrouter/vendor/model-not-mapped')).toBeUndefined();
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

  it('prices cache write at 1.25x and cache read at 0.1x the input rate', () => {
    // opus input $5/M: input 1M @ $5 + write 1M @ $6.25 + read 1M @ $0.5 = 11.75
    expect(
      computeActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(11.75);
  });

  it('treats absent cache token counts as zero', () => {
    expect(
      computeActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(5);
  });

  it('computes cost from token counts for a known OpenAI model', () => {
    expect(
      computeActualCostUsd({
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBe(0.0125);
  });

  it('computes cost from token counts for a known Gemini model', () => {
    expect(
      computeActualCostUsd({
        model: 'gemini-2.5-pro',
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBe(0.01125);
  });

  it('prices provider-prefixed Anthropic aliases the same as the bare id', () => {
    expect(
      computeActualCostUsd({
        model: 'openrouter/anthropic/claude-sonnet-4.6',
        inputTokens: 1234,
        outputTokens: 567,
      }),
    ).toBe(
      computeActualCostUsd({
        model: 'claude-sonnet-4-6',
        inputTokens: 1234,
        outputTokens: 567,
      }),
    );
  });

  it('returns undefined for a negative cache token count', () => {
    expect(
      computeActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: -5,
      }),
    ).toBeUndefined();
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

  it('documents asOf dates', () => {
    expect(ANTHROPIC_MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MODEL_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
