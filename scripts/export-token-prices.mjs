#!/usr/bin/env node
// HOK-3421: the published JSON is derived from the resolver, never hand-edited.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_PRICING,
  MODEL_PRICING_AS_OF,
  MODEL_PRICE_ALIASES,
  ANTHROPIC_MODEL_PRICING,
  ANTHROPIC_MODEL_PRICING_AS_OF,
  OPENAI_MODEL_PRICING,
  OPENAI_MODEL_PRICING_AS_OF,
  GOOGLE_MODEL_PRICING,
  appliedRates,
  computeActualCostUsd,
} from '../packages/core/dist/pricing.js';

const providerSources = [
  [
    ANTHROPIC_MODEL_PRICING,
    ANTHROPIC_MODEL_PRICING_AS_OF,
    'https://platform.claude.com/docs/en/about-claude/pricing',
  ],
  [
    OPENAI_MODEL_PRICING,
    OPENAI_MODEL_PRICING_AS_OF,
    'https://developers.openai.com/api/docs/pricing',
  ],
  [
    GOOGLE_MODEL_PRICING,
    '2026-07-09',
    'https://ai.google.dev/gemini-api/docs/pricing',
  ],
];
function rates(model, price, long = false) {
  const r = appliedRates(
    model,
    price,
    long ? price.longContext.thresholdInputTokens + 1 : 0,
    long,
  );
  return {
    inputPerMTokUsd: r.input,
    outputPerMTokUsd: r.output,
    cachedInputPerMTokUsd: r.cacheRead ?? null,
    cacheWritePerMTokUsd: r.cacheWrite ?? null,
  };
}
const models = Object.fromEntries(
  Object.entries(MODEL_PRICING)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, price]) => {
      const [, asOf, source] = providerSources.find(
        ([table]) => table[model] === price,
      ) ?? [null, '2026-11-02', 'https://openrouter.ai/api/v1/models'];
      return [
        model,
        {
          ...rates(model, price),
          as_of: [
            'gpt-5.6-terra',
            'gpt-5.3-codex',
            'gpt-5.6-sol',
            'kimi-k3.1-pro',
          ].includes(model)
            ? '2026-11-16'
            : asOf,
          source:
            model === 'kimi-k3.1-pro'
              ? 'https://openrouter.ai/moonshotai/kimi-k3.1-pro'
              : source,
          ...(price.longContext
            ? {
                long_context: {
                  threshold_input_tokens:
                    price.longContext.thresholdInputTokens,
                  ...rates(model, price, true),
                },
              }
            : {}),
        },
      ];
    }),
);
const table = {
  schema_version: 'hokusai_token_prices/v1',
  version: MODEL_PRICING_AS_OF,
  units: 'USD per 1000000 tokens',
  service_tier: 'standard',
  note: 'API-equivalent resource cost independent of subscription or payment arrangement. Null rates are unpriced. Aggregate usage uses standard context; long_context applies only to one request. Reasoning is already included in output. Historical legacy rows retain their prior provider rates; no frozen history is repriced.',
  aliases: MODEL_PRICE_ALIASES,
  models,
};
const cases = [];
for (const model of Object.keys(models)) {
  for (const [label, usage] of Object.entries({
    ordinary: { inputTokens: 1000, outputTokens: 200 },
    cache_read: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 4000 },
    cache_write: {
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 500,
    },
    zero: { inputTokens: 0, outputTokens: 0 },
  })) {
    const input = { model, ...usage };
    cases.push({
      label,
      input,
      expected_usd: computeActualCostUsd(input) ?? null,
    });
  }
  if (models[model].long_context) {
    for (const requestScoped of [false, true]) {
      const input = {
        model,
        inputTokens: 300000,
        outputTokens: 200,
        cacheReadTokens: 4000,
        requestScoped,
      };
      cases.push({
        label: 'long_context',
        input,
        expected_usd: computeActualCostUsd(input) ?? null,
      });
    }
  }
}
for (const model of [
  'openrouter:openai/gpt-5-codex',
  'anthropic/claude-haiku-4-5-20251001',
  'openrouter/anthropic/claude-sonnet-5',
  'qwen-3-coder',
  'llama-3.3-70b',
  'mistral-large-2',
  'unknown-model',
]) {
  const input = { model, inputTokens: 1000, outputTokens: 200 };
  cases.push({
    label: 'identity',
    input,
    expected_usd: computeActualCostUsd(input) ?? null,
  });
}
for (const [relative, payload] of [
  ['packages/core/prices/hokusai_token_prices.v1.json', table],
  [
    'fixtures/token-prices/parity.v1.json',
    { schema_version: 'hokusai_token_price_parity/v1', cases },
  ],
]) {
  const target = fileURLToPath(new URL('../' + relative, import.meta.url));
  const content = JSON.stringify(payload, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content)
      throw new Error(relative + ' is stale; run pnpm export:token-prices');
  } else {
    mkdirSync(dirname(target), {
      recursive: true,
    });
    writeFileSync(target, content);
  }
}
