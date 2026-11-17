import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  computeActualCostUsd,
  MODEL_PRICING,
  type TokenCostInput,
} from './pricing.js';

describe('published token prices', () => {
  const table = JSON.parse(
    readFileSync(
      new URL('../prices/hokusai_token_prices.v1.json', import.meta.url),
      'utf8',
    ),
  ) as {
    models: Record<
      string,
      {
        as_of: string;
        source: string;
        inputPerMTokUsd: number;
        outputPerMTokUsd: number;
        cachedInputPerMTokUsd: number | null;
      }
    >;
  };
  const parity = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/token-prices/parity.v1.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: { input: TokenCostInput; expected_usd: number | null }[] };
  it('covers every priced model with explicit cache rates and provenance', () => {
    expect(Object.keys(table.models).sort()).toEqual(
      Object.keys(MODEL_PRICING).sort(),
    );
    for (const row of Object.values(table.models) as Record<
      string,
      unknown
    >[]) {
      expect(row.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.source).toMatch(/^https:\/\//);
      expect(row).toHaveProperty('cachedInputPerMTokUsd');
      expect(row).toHaveProperty('cacheWritePerMTokUsd');
    }
  });
  it('keeps all exported comparison vectors fresh', () => {
    for (const row of parity.cases)
      expect(computeActualCostUsd(row.input) ?? null).toBe(row.expected_usd);
  });
  it('records the three verified provider rates', () => {
    expect(table.models['claude-sonnet-5']!.inputPerMTokUsd).toBe(2);
    expect(table.models['claude-sonnet-5']!.outputPerMTokUsd).toBe(10);
    expect(table.models['gpt-5.6-terra']!.inputPerMTokUsd).toBe(2);
    expect(table.models['gpt-5.6-terra']!.outputPerMTokUsd).toBe(12);
    expect(table.models['gpt-5.3-codex']!.cachedInputPerMTokUsd).toBe(0.175);
    expect(table.models['glm-5.3']!.source).toBe(
      'https://openrouter.ai/api/v1/models',
    );
  });
});
