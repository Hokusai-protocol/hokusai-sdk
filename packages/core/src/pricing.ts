/**
 * Minimal per-model price tables used to derive `actual_cost_usd` for harness
 * contribution rows when a harness reports token counts instead of a measured
 * dollar cost.
 *
 * Prices are US dollars per 1,000,000 tokens, taken from provider-published
 * model pricing. Keep these tables small and easy to update: add or adjust a
 * row and bump the relevant `*_AS_OF` constant. Models absent from the table
 * yield no cost (the caller omits `actual_cost_usd` and the row stays
 * telemetry-only) rather than a fabricated value.
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
 * in {@link computeActualCostUsd} when cache token counts are supplied. These
 * multipliers remain Anthropic-specific; non-Anthropic callers should omit cache
 * token counts unless they know the same rates apply.
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

/**
 * OpenAI pricing source:
 * https://developers.openai.com/api/docs/pricing
 * Individual model pages are used for deprecated but still-practical ids such
 * as `gpt-4o`, `gpt-4-turbo`, `o1`, and `o3-mini`.
 *
 * Some OpenAI models apply higher rates for large prompts. The fallback pricing
 * logic only sees aggregate token totals, so this table captures the standard
 * per-token rates; adapters should prefer host-reported measured cost whenever
 * that is available.
 */
export const OPENAI_MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'gpt-5.5': { inputPerMTokUsd: 5, outputPerMTokUsd: 30 },
  'gpt-5': { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  'gpt-5-mini': { inputPerMTokUsd: 0.25, outputPerMTokUsd: 2 },
  'gpt-5-codex': { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  'codex-mini-latest': { inputPerMTokUsd: 1.5, outputPerMTokUsd: 6 },
  'gpt-4o': { inputPerMTokUsd: 2.5, outputPerMTokUsd: 10 },
  'gpt-4o-mini': { inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 },
  'gpt-4.1': { inputPerMTokUsd: 2, outputPerMTokUsd: 8 },
  'gpt-4.1-mini': { inputPerMTokUsd: 0.4, outputPerMTokUsd: 1.6 },
  'gpt-4-turbo': { inputPerMTokUsd: 10, outputPerMTokUsd: 30 },
  o1: { inputPerMTokUsd: 15, outputPerMTokUsd: 60 },
  'o1-mini': { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 },
  o3: { inputPerMTokUsd: 2, outputPerMTokUsd: 8 },
  'o3-mini': { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 },
  'o4-mini': { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 },
};

/**
 * Gemini pricing source:
 * https://ai.google.dev/gemini-api/docs/pricing
 *
 * Gemini 2.5 Pro varies by prompt size; the fallback uses the standard <=200k
 * prompt tier because aggregate token totals do not preserve per-request prompt
 * boundaries. Hosts with measured billing should pass `explicitActualCostUsd`.
 */
export const GOOGLE_MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'gemini-2.5-pro': { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  'gemini-2.5-flash': { inputPerMTokUsd: 0.3, outputPerMTokUsd: 2.5 },
  'gemini-2.0-flash': { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.4 },
  'gemini-2.0-flash-001': { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.4 },
};

export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  ...ANTHROPIC_MODEL_PRICING,
  ...OPENAI_MODEL_PRICING,
  ...GOOGLE_MODEL_PRICING,
};

/** ISO date the merged multi-provider price table was last verified. */
export const MODEL_PRICING_AS_OF = '2026-07-15';

const COMPACT_DATE_SUFFIX = /-\d{8}$/;
const DASHED_DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;
const GEMINI_STABLE_SUFFIX = /-001$/;

/**
 * Provider prefixes stripped by {@link normalizeModelId}. Case-insensitive, and
 * applied repeatedly so nested ids such as `openrouter/anthropic/...` collapse
 * to the base model id used in {@link MODEL_PRICING}.
 */
const KNOWN_PROVIDER_PREFIXES = [
  'openrouter/',
  'litellm/',
  'openai/',
  'anthropic/',
  'google/',
  'gemini/',
  'deepseek/',
  'meta-llama/',
  'meta/',
  'mistralai/',
  'moonshotai/',
  'qwen/',
  'x-ai/',
  'z-ai/',
] as const;

/**
 * Normalize a caller-supplied model id to the base key used by
 * {@link MODEL_PRICING}. Unknown prefixes are preserved so unrelated vendor ids
 * cannot collide with known table rows.
 */
export function normalizeModelId(id: string): string {
  let normalized = id.trim().toLowerCase();

  for (let index = 0; index < 5; index += 1) {
    const prefix = KNOWN_PROVIDER_PREFIXES.find((candidate) => normalized.startsWith(candidate));
    if (!prefix) {
      break;
    }
    normalized = normalized.slice(prefix.length);
  }

  if (normalized.startsWith('claude-')) {
    normalized = normalized.replaceAll('.', '-');
  }

  return normalized;
}

function stripKnownSnapshotSuffixes(model: string): string {
  const compactDate = model.replace(COMPACT_DATE_SUFFIX, '');
  if (compactDate !== model) {
    return compactDate;
  }

  const dashedDate = model.replace(DASHED_DATE_SUFFIX, '');
  if (dashedDate !== model) {
    return dashedDate;
  }

  if (model.startsWith('gemini-')) {
    return model.replace(GEMINI_STABLE_SUFFIX, '');
  }

  return model;
}

/**
 * Resolve the price for a model id. Tries an exact match first, then strips a
 * known snapshot/version suffix. Returns `undefined` when the model is not in
 * the table.
 */
export function resolveModelPrice(model: string | undefined): ModelPrice | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const normalized = normalizeModelId(model);
  if (normalized.length === 0) {
    return undefined;
  }

  return MODEL_PRICING[normalized] ?? MODEL_PRICING[stripKnownSnapshotSuffixes(normalized)];
}

export interface TokenCostInput {
  /** Resolved model actually run. */
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
 * `undefined` — never a fabricated value — when the model is unknown, when any
 * supplied token count is not a finite, non-negative number, or when non-zero
 * cache tokens are supplied for a non-Anthropic model (whose cache pricing is
 * not represented here).
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

  if (
    (cacheCreationTokens > 0 || cacheReadTokens > 0) &&
    !isAnthropicModel(input.model)
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

function isAnthropicModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (ANTHROPIC_MODEL_PRICING[normalized]) {
    return true;
  }
  return Boolean(ANTHROPIC_MODEL_PRICING[stripKnownSnapshotSuffixes(normalized)]);
}
