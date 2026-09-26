import {
  MODEL_PRICING_AS_OF,
  computeActualCostUsd,
  type TaskCostTokenUsage,
} from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import {
  buildOverrideIndex,
  resolveEventPrice,
  validateHostPriceOverride,
  type HostPriceOverride,
} from './pricing-resolver.js';

function usage(
  overrides: Partial<TaskCostTokenUsage> = {},
): TaskCostTokenUsage {
  return {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    ...overrides,
  };
}

describe('resolveEventPrice — provider-reported charge', () => {
  it('records a finite charge and marks the event provider_reported', () => {
    const resolved = resolveEventPrice({
      observedModel: 'claude-sonnet-4-6',
      usage: usage(),
      actualCostUsd: 0.0042,
    });
    expect(resolved.actualCostUsd).toBe(0.0042);
    expect(resolved.costSource).toBe('provider_reported');
    // The estimate still fills in alongside as a cross-check.
    expect(resolved.estimatedCostUsd).toBe(0.0105);
  });

  it('treats a zero charge as known-zero, not missing', () => {
    const resolved = resolveEventPrice({
      observedModel: 'unknown-model',
      usage: usage(),
      actualCostUsd: 0,
    });
    expect(resolved.actualCostUsd).toBe(0);
    expect(resolved.costSource).toBe('provider_reported');
  });

  it('degrades a non-finite charge to null with a diagnostic', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const resolved = resolveEventPrice({
        observedModel: 'claude-sonnet-4-6',
        usage: usage(),
        actualCostUsd: bad,
      });
      expect(resolved.actualCostUsd).toBeNull();
      expect(resolved.diagnostics).toContain('invalid_token_usage');
      expect(resolved.costSource).toBe('local_estimate'); // the estimate still resolved
    }
  });

  it('treats null/absent charge as missing without a diagnostic', () => {
    const resolved = resolveEventPrice({
      observedModel: 'claude-sonnet-4-6',
      usage: usage(),
      actualCostUsd: null,
    });
    expect(resolved.actualCostUsd).toBeNull();
    expect(resolved.diagnostics).toEqual([]);
  });
});

describe('resolveEventPrice — caller-supplied estimate', () => {
  it('trusts the estimate verbatim with caller provenance', () => {
    const resolved = resolveEventPrice({
      observedModel: 'gpt-5',
      usage: usage(),
      estimatedCostUsd: 0.00625,
      pricingSource: 'openrouter_api',
      priceTable: 'openrouter',
    });
    expect(resolved.estimatedCostUsd).toBe(0.00625);
    expect(resolved.pricingSource).toBe('openrouter_api');
    expect(resolved.priceTable).toBe('openrouter');
    expect(resolved.pricingRevision).toBeUndefined();
  });

  it('defaults provenance to local_estimate / external', () => {
    const resolved = resolveEventPrice({
      observedModel: 'gpt-5',
      usage: usage(),
      estimatedCostUsd: 0.01,
    });
    expect(resolved.pricingSource).toBe('local_estimate');
    expect(resolved.priceTable).toBe('external');
  });

  it('stamps an explicitly configured revision on caller-supplied estimates', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'gpt-5', usage: usage(), estimatedCostUsd: 0.01 },
      { pricingRevision: '2026-02-02' },
    );
    expect(resolved.pricingRevision).toBe('2026-02-02');
  });

  it('an explicit null estimate opts out of engine pricing entirely', () => {
    const resolved = resolveEventPrice({
      observedModel: 'claude-sonnet-4-6',
      usage: usage(),
      estimatedCostUsd: null,
    });
    expect(resolved.estimatedCostUsd).toBeNull();
    expect(resolved.pricingSource).toBe('none');
    expect(resolved.costSource).toBe('none');
  });
});

describe('resolveEventPrice — host override', () => {
  const override: HostPriceOverride = {
    model: 'local-llama',
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 2,
  };

  it('prices from the override with override provenance', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'local-llama', usage: usage() },
      { overrides: [override] },
    );
    // 1000/1e6 × $1 + 500/1e6 × $2 = $0.002
    expect(resolved.estimatedCostUsd).toBe(0.002);
    expect(resolved.pricingSource).toBe('local_estimate');
    expect(resolved.priceTable).toBe('override');
    expect(resolved.costSource).toBe('local_estimate');
  });

  it('beats the built-in table for a model both know', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'claude-sonnet-4-6', usage: usage() },
      {
        overrides: [
          {
            model: 'claude-sonnet-4-6',
            inputPerMTokUsd: 1,
            outputPerMTokUsd: 1,
          },
        ],
      },
    );
    expect(resolved.estimatedCostUsd).toBe(0.0015); // not the table's 0.0105
    expect(resolved.priceTable).toBe('override');
  });

  it('matches through normalizeModelId on both sides', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'claude-sonnet-4-6', usage: usage() },
      {
        overrides: [
          {
            model: 'anthropic/claude-sonnet-4.6',
            inputPerMTokUsd: 1,
            outputPerMTokUsd: 2,
          },
        ],
      },
    );
    expect(resolved.estimatedCostUsd).toBe(0.002);
  });

  it('stamps asOf as the pricing revision', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'local-llama', usage: usage() },
      { overrides: [{ ...override, asOf: '2026-01-01' }] },
    );
    expect(resolved.pricingRevision).toBe('2026-01-01');
  });

  it('falls back to the context revision when asOf is absent', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'local-llama', usage: usage() },
      { overrides: [override], pricingRevision: '2026-03-03' },
    );
    expect(resolved.pricingRevision).toBe('2026-03-03');
  });

  it('honours a custom priceTable label', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'local-llama', usage: usage() },
      { overrides: [{ ...override, priceTable: 'external' }] },
    );
    expect(resolved.priceTable).toBe('external');
  });

  it('prices cache tiers with the configured multipliers', () => {
    const resolved = resolveEventPrice(
      {
        observedModel: 'local-llama',
        usage: usage({ cache_write_tokens: 2000, cache_read_tokens: 10_000 }),
      },
      {
        overrides: [
          {
            model: 'local-llama',
            inputPerMTokUsd: 1,
            outputPerMTokUsd: 2,
            cacheWriteMultiplier: 1.25,
            cacheReadMultiplier: 0.1,
          },
        ],
      },
    );
    // 0.001 + 0.001 + 2000/1e6×1.25 + 10000/1e6×0.1 = 0.002 + 0.0025 + 0.001 = 0.0055
    expect(resolved.estimatedCostUsd).toBe(0.0055);
  });

  it('leaves the estimate null (no_pricing_data) for reported cache tokens without multipliers', () => {
    const resolved = resolveEventPrice(
      {
        observedModel: 'local-llama',
        usage: usage({ cache_write_tokens: 2000 }),
      },
      { overrides: [override] },
    );
    expect(resolved.estimatedCostUsd).toBeNull();
    expect(resolved.pricingSource).toBe('none');
    expect(resolved.diagnostics).toContain('no_pricing_data');
  });

  it('bills unreported (null) cache counters as zero like computeActualCostUsd', () => {
    const resolved = resolveEventPrice(
      {
        observedModel: 'local-llama',
        usage: usage({ cache_write_tokens: null, cache_read_tokens: null }),
      },
      { overrides: [override] },
    );
    expect(resolved.estimatedCostUsd).toBe(0.002);
  });

  it('zero-rate override is known-zero evidence, not a fallback', () => {
    const resolved = resolveEventPrice(
      { observedModel: 'local-llama', usage: usage() },
      {
        overrides: [
          { model: 'local-llama', inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
        ],
      },
    );
    expect(resolved.estimatedCostUsd).toBe(0);
    expect(resolved.pricingSource).toBe('local_estimate');
    expect(resolved.costSource).toBe('local_estimate');
  });

  it('bills codex reasoning tokens as output through the override path', () => {
    const resolved = resolveEventPrice(
      {
        observedModel: 'local-llama',
        usage: usage({ reasoning_tokens: 500 }),
        harness: 'codex',
      },
      { overrides: [override] },
    );
    // output billed as 500 + 500 = 1000 -> 0.001 + 0.002
    expect(resolved.estimatedCostUsd).toBe(0.003);
  });
});

describe('resolveEventPrice — built-in table', () => {
  it('prices a known Anthropic model with cache tiers exactly like computeActualCostUsd', () => {
    const cacheUsage = usage({
      cache_write_tokens: 2000,
      cache_read_tokens: 50_000,
    });
    const resolved = resolveEventPrice({
      observedModel: 'claude-sonnet-4-6',
      usage: cacheUsage,
    });
    expect(resolved.estimatedCostUsd).toBe(
      computeActualCostUsd({
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 2000,
        cacheReadTokens: 50_000,
      }),
    );
    expect(resolved.priceTable).toBe('anthropic');
    expect(resolved.pricingRevision).toBe(MODEL_PRICING_AS_OF);
  });

  it('labels OpenAI- and Google-table models with their table', () => {
    expect(
      resolveEventPrice({ observedModel: 'gpt-5', usage: usage() }).priceTable,
    ).toBe('openai');
    expect(
      resolveEventPrice({ observedModel: 'gemini-2.5-pro', usage: usage() })
        .priceTable,
    ).toBe('google');
  });

  it('bills codex reasoning tokens as output', () => {
    const resolved = resolveEventPrice({
      observedModel: 'gpt-5',
      usage: usage({ output_tokens: 500, reasoning_tokens: 1500 }),
      harness: 'codex',
    });
    expect(resolved.estimatedCostUsd).toBe(
      computeActualCostUsd({
        model: 'gpt-5',
        inputTokens: 1000,
        outputTokens: 2000,
      }),
    );
  });

  it('leaves Claude Code thinking tokens alone (already inside output)', () => {
    const resolved = resolveEventPrice({
      observedModel: 'claude-sonnet-4-6',
      usage: usage({ reasoning_tokens: 400 }),
      harness: 'claude-code',
    });
    expect(resolved.estimatedCostUsd).toBe(
      computeActualCostUsd({
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );
  });

  it('an unknown model yields null with unpriced_model, never zero', () => {
    const resolved = resolveEventPrice({
      observedModel: 'mystery-model-9',
      usage: usage(),
    });
    expect(resolved.estimatedCostUsd).toBeNull();
    expect(resolved.pricingSource).toBe('none');
    expect(resolved.costSource).toBe('none');
    expect(resolved.diagnostics).toContain('unpriced_model');
  });

  it('non-Anthropic cache tokens are unpriceable (no_pricing_data)', () => {
    const resolved = resolveEventPrice({
      observedModel: 'gpt-5',
      usage: usage({ cache_read_tokens: 5000 }),
    });
    expect(resolved.estimatedCostUsd).toBeNull();
    expect(resolved.diagnostics).toContain('no_pricing_data');
  });

  it('incomplete usage (missing input or output) yields null without a pricing diagnostic', () => {
    for (const partial of [
      usage({ input_tokens: null }),
      usage({ output_tokens: null }),
    ]) {
      const resolved = resolveEventPrice({
        observedModel: 'claude-sonnet-4-6',
        usage: partial,
      });
      expect(resolved.estimatedCostUsd).toBeNull();
      expect(resolved.diagnostics).toEqual([]);
    }
  });
});

describe('override validation', () => {
  it('rejects negative or non-finite rates naming the model', () => {
    expect(() =>
      validateHostPriceOverride({
        model: 'local-llama',
        inputPerMTokUsd: -1,
        outputPerMTokUsd: 2,
      }),
    ).toThrow(/local-llama.*inputPerMTokUsd/);
    expect(() =>
      validateHostPriceOverride({
        model: 'local-llama',
        inputPerMTokUsd: 1,
        outputPerMTokUsd: Number.NaN,
      }),
    ).toThrow(/local-llama.*outputPerMTokUsd/);
  });

  it('rejects invalid cache multipliers', () => {
    expect(() =>
      validateHostPriceOverride({
        model: 'local-llama',
        inputPerMTokUsd: 1,
        outputPerMTokUsd: 2,
        cacheReadMultiplier: -0.1,
      }),
    ).toThrow(/cacheReadMultiplier/);
  });

  it('rejects two overrides that normalize to the same model', () => {
    expect(() =>
      buildOverrideIndex([
        {
          model: 'anthropic/claude-sonnet-4.6',
          inputPerMTokUsd: 1,
          outputPerMTokUsd: 2,
        },
        { model: 'claude-sonnet-4-6', inputPerMTokUsd: 3, outputPerMTokUsd: 4 },
      ]),
    ).toThrow(/duplicate price override/);
  });
});
