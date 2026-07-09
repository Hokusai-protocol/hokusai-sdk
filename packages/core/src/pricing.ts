/**
 * Minimal Anthropic per-model price table used to derive `actual_cost_usd` for
 * harness contribution rows when a harness reports token counts instead of a
 * measured dollar cost.
 *
 * Prices are US dollars per 1,000,000 tokens, taken from Anthropic's published
 * model pricing. Keep this table small and easy to update: add or adjust a row
 * and bump `ANTHROPIC_MODEL_PRICING_AS_OF`. Models absent from the table yield
 * no cost (the caller omits `actual_cost_usd` and the row stays telemetry-only)
 * rather than a fabricated value.
 *
 * @module pricing
 */

/** ISO date the price table below was last verified against Anthropic pricing. */
export const ANTHROPIC_MODEL_PRICING_AS_OF = '2026-07-09';

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMTokUsd: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTokUsd: number;
}

/**
 * Prompt-cache pricing multipliers relative to the base input rate, per
 * Anthropic's published pricing. Cache writes (5-minute TTL, which Claude Code
 * uses by default) bill at 1.25x input; cache reads bill at 0.1x input. Applied
 * in {@link computeActualCostUsd} when cache token counts are supplied.
 */
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;
export const CACHE_READ_INPUT_MULTIPLIER = 0.1;

/**
 * Per-model prices keyed by canonical Anthropic model id. Date-suffixed ids
 * (e.g. `claude-haiku-4-5-20251001`) resolve to their base id via
 * {@link resolveModelPrice}, so only base ids need entries here.
 */
export const ANTHROPIC_MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5': { inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
  'claude-opus-4-8': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-opus-4-7': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-opus-4-6': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-sonnet-5': { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  'claude-sonnet-4-6': { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  'claude-haiku-4-5': { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
};

const DATE_SUFFIX = /-\d{8}$/;

/**
 * Resolve the price for a model id. Tries an exact match first, then strips a
 * trailing `-YYYYMMDD` snapshot suffix. Returns `undefined` when the model is
 * not in the table.
 */
export function resolveModelPrice(model: string | undefined): ModelPrice | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const normalized = model.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  return (
    ANTHROPIC_MODEL_PRICING[normalized] ??
    ANTHROPIC_MODEL_PRICING[normalized.replace(DATE_SUFFIX, '')]
  );
}

export interface TokenCostInput {
  /** Resolved model actually run (Anthropic model id). */
  model: string;
  /** Uncached prompt/input tokens consumed. */
  inputTokens: number;
  /** Completion/output tokens produced. */
  outputTokens: number;
  /**
   * Prompt-cache write tokens (`cache_creation_input_tokens`). Billed at
   * {@link CACHE_WRITE_INPUT_MULTIPLIER}x the input rate. Defaults to 0.
   */
  cacheCreationTokens?: number;
  /**
   * Prompt-cache read tokens (`cache_read_input_tokens`). Billed at
   * {@link CACHE_READ_INPUT_MULTIPLIER}x the input rate. Defaults to 0.
   */
  cacheReadTokens?: number;
}

/** A finite, non-negative number, or 0 when the value is absent/invalid-as-zero. */
function nonNegativeOrNull(value: number | undefined): number | null {
  if (value === undefined) {
    return 0;
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Compute `actual_cost_usd` from token counts and the resolved model. Cache
 * write/read tokens are billed at their reduced rates relative to input. Returns
 * `undefined` — never a fabricated value — when the model is unknown or any
 * supplied token count is not a finite, non-negative number.
 */
export function computeActualCostUsd(input: TokenCostInput): number | undefined {
  const price = resolveModelPrice(input.model);
  if (!price) {
    return undefined;
  }

  const inputTokens = nonNegativeOrNull(input.inputTokens);
  const outputTokens = nonNegativeOrNull(input.outputTokens);
  const cacheCreationTokens = nonNegativeOrNull(input.cacheCreationTokens);
  const cacheReadTokens = nonNegativeOrNull(input.cacheReadTokens);
  if (
    inputTokens === null ||
    outputTokens === null ||
    cacheCreationTokens === null ||
    cacheReadTokens === null
  ) {
    return undefined;
  }

  const cost =
    (inputTokens / 1_000_000) * price.inputPerMTokUsd +
    (cacheCreationTokens / 1_000_000) *
      price.inputPerMTokUsd *
      CACHE_WRITE_INPUT_MULTIPLIER +
    (cacheReadTokens / 1_000_000) *
      price.inputPerMTokUsd *
      CACHE_READ_INPUT_MULTIPLIER +
    (outputTokens / 1_000_000) * price.outputPerMTokUsd;

  // Round to 6 decimal places (micro-dollar) to avoid floating-point noise.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
