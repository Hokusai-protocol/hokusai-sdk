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

  it('prices OpenAI cache tokens at the shared multipliers (HOK-3104)', () => {
    // gpt-5 at $1.25 input / $10 output per MTok, read at 0.1× input.
    // 100k input + 900k cache_read + 10k output
    //   = 100000/1e6×1.25 + 900000/1e6×1.25×0.1 + 10000/1e6×10
    //   = 0.125 + 0.1125 + 0.1 = 0.3375
    expect(
      computeActualCostUsd({
        model: 'gpt-5-codex',
        inputTokens: 100_000,
        outputTokens: 10_000,
        cacheReadTokens: 900_000,
      }),
    ).toBeCloseTo(0.3375, 9);
    // Snapshot-suffixed OpenAI ids also price through.
    expect(
      computeActualCostUsd({
        model: 'gpt-4o-2024-08-06',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 500,
      }),
    ).not.toBeUndefined();
  });

  it('returns undefined when non-zero cache tokens are supplied for a Gemini model', () => {
    // Gemini's cache read tier (0.25×) is not the Anthropic/OpenAI shared
    // multiplier; refuse to fabricate a cost rather than mispricing it.
    expect(
      computeActualCostUsd({
        model: 'gemini-2.5-pro',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheCreationTokens: 500,
      }),
    ).toBeUndefined();
    expect(
      computeActualCostUsd({
        model: 'gemini-2.5-pro',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 500,
      }),
    ).toBeUndefined();
  });

  it('accepts zero cache token counts for Gemini models', () => {
    expect(
      computeActualCostUsd({
        model: 'gemini-2.5-pro',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBe(0.01125);
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

describe('OpenAI price table (pricing page, 2026-11-04)', () => {
  it('prices the HOK-3412 spike session on gpt-6.1-sol at the per-model cached rate', () => {
    // 12,634 uncached input + 26,624 cached + 118 output; cached is 0.05x input.
    expect(
      computeActualCostUsd({
        model: 'gpt-6.1-sol',
        inputTokens: 12_634,
        cacheReadTokens: 26_624,
        outputTokens: 118,
        requestScoped: true,
      }),
    ).toBe(0.02911);
    // 12634 * 2 + 26624 * 0.1 + 118 * 10 = 29,110.4 micro-USD before rounding.
  });

  it('uses per-model cached rates, not a shared multiplier', () => {
    const cached = (model: string) => computeActualCostUsd({ model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
    expect(cached('gpt-6.1-sol')).toBe(0.1); // 0.05x of $2
    expect(cached('gpt-5')).toBe(0.125); // 0.1x
    expect(cached('gpt-4.1')).toBe(0.5); // 0.25x
    expect(cached('gpt-4o')).toBe(1.25); // 0.5x
  });

  it('applies the long-context tier above 272K input tokens, per request only', () => {
    const at = (inputTokens: number, requestScoped: boolean) =>
      computeActualCostUsd({ model: 'gpt-6.1-sol', inputTokens, outputTokens: 0, requestScoped });
    expect(at(272_000, true)).toBe(0.544); // standard: $2 / MTok
    expect(at(272_001, true)).toBe(1.088004); // long: $4 / MTok
    // An aggregate cannot be split into requests: standard rates.
    expect(at(272_001, false)).toBe(0.544002);
  });

  it('counts cached tokens toward the long-context threshold', () => {
    expect(
      computeActualCostUsd({ model: 'gpt-6.1-sol', inputTokens: 72_001, cacheReadTokens: 200_000, outputTokens: 0, requestScoped: true }),
    ).toBe(0.328004); // 72,001 * $4 + 200,000 * $0.20
  });

  it('leaves usage unpriced when the table has no rate for it', () => {
    // TTL-dependent cache writes (gpt-6 / gpt-5.6).
    expect(computeActualCostUsd({ model: 'gpt-6.1-sol', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 10 })).toBeUndefined();
    // No cached-input rate on pro models.
    expect(computeActualCostUsd({ model: 'gpt-5.5-pro', inputTokens: 1, outputTokens: 1, cacheReadTokens: 10 })).toBeUndefined();
    // Not on the pricing page.
    expect(computeActualCostUsd({ model: 'codex-auto-review', inputTokens: 1, outputTokens: 1 })).toBeUndefined();
  });

  it('keeps the legacy multipliers for rows the page no longer lists', () => {
    expect(
      computeActualCostUsd({ model: 'gpt-5-codex', inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }),
    ).toBe(0.125);
  });

  it('prices the newly listed models', () => {
    for (const model of ['gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5-nano', 'o3-pro']) {
      expect(computeActualCostUsd({ model, inputTokens: 1000, outputTokens: 1000 }), model).toBeGreaterThan(0);
    }
  });
});
