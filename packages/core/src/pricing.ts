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

/** Rates above a prompt-size threshold (OpenAI: more than 272K input tokens). */
export interface LongContextPrice {
  /** Requests with more input tokens than this (cached included) use these rates. */
  thresholdInputTokens: number;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  /** `null`: the model has no cached-input rate in this tier. */
  cachedInputPerMTokUsd?: number | null;
}

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMTokUsd: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTokUsd: number;
  /**
   * USD per 1,000,000 cache-read (cached input) tokens. `undefined`: derive it
   * from the provider multiplier (Anthropic, and OpenAI rows the current page
   * no longer lists). `null`: the model has no cached-input rate, so non-zero
   * cache reads leave the usage unpriced.
   */
  cachedInputPerMTokUsd?: number | null;
  /**
   * USD per 1,000,000 cache-write tokens, with the same `undefined` / `null`
   * rule. `null` where the write rate depends on a cache TTL the usage
   * does not record (OpenAI gpt-6 / gpt-5.6: 30m vs 12h).
   */
  cacheWritePerMTokUsd?: number | null;
  /** Higher rates for large prompts, applied per request only. */
  longContext?: LongContextPrice;
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

/** ISO date the OpenAI table was last verified against the pricing page. */
export const OPENAI_MODEL_PRICING_AS_OF = '2026-11-04';

/** OpenAI bills prompts above this many input tokens at the long-context rates. */
export const OPENAI_LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;

function openAiLong(
  inputPerMTokUsd: number,
  cachedInputPerMTokUsd: number | null,
  outputPerMTokUsd: number,
): LongContextPrice {
  return {
    thresholdInputTokens: OPENAI_LONG_CONTEXT_THRESHOLD_TOKENS,
    inputPerMTokUsd,
    cachedInputPerMTokUsd,
    outputPerMTokUsd,
  };
}

/**
 * OpenAI pricing source, Standard tier:
 * https://developers.openai.com/api/docs/pricing (read 2026-11-04).
 * Batch / Flex / Fast (formerly Priority) tiers are not represented. A usage
 * source that knows its tier must leave a non-Standard request unpriced.
 * Regional and FedRAMP uplifts are out of scope.
 *
 * - `cachedInputPerMTokUsd` is per model (the ratio to input varies: 0.05x for
 *   gpt-6.1-sol, 0.1x for most, 0.25x for gpt-4.1 / o3, 0.5x for gpt-4o). `null`
 *   means the page lists no cached rate.
 * - gpt-6 / gpt-5.6 list cache-write rates by TTL (30m = 1.25x input, 12h =
 *   2.5x). Usage does not say which TTL applied, so `cacheWritePerMTokUsd`
 *   is `null`: a non-zero cache write leaves the usage unpriced, never guessed.
 * - `longContext` (more than 272K input tokens) applies per request only (see
 *   `TokenCostInput.requestScoped`).
 *
 * Rows not on the current page (`gpt-5-codex`, `codex-mini-latest`,
 * `gpt-4-turbo`, `o1*`, `o3-mini`, `o4-mini`) keep their earlier per-model
 * pages' rates and the legacy cache multipliers. `codex-auto-review` is not on
 * the page and is deliberately unpriced.
 */
export const OPENAI_MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'gpt-6-astra': {
    inputPerMTokUsd: 10, cachedInputPerMTokUsd: 1, outputPerMTokUsd: 50,
    cacheWritePerMTokUsd: null, longContext: openAiLong(20, 2, 75),
  },
  'gpt-6.1-sol': {
    inputPerMTokUsd: 2, cachedInputPerMTokUsd: 0.1, outputPerMTokUsd: 10,
    cacheWritePerMTokUsd: null, longContext: openAiLong(4, 0.2, 15),
  },
  'gpt-6.1-terra': {
    inputPerMTokUsd: 1, cachedInputPerMTokUsd: 0.05, outputPerMTokUsd: 5,
    cacheWritePerMTokUsd: null, longContext: openAiLong(2, 0.1, 7.5),
  },
  'gpt-6-sol': {
    inputPerMTokUsd: 2, cachedInputPerMTokUsd: 0.2, outputPerMTokUsd: 10,
    cacheWritePerMTokUsd: null, longContext: openAiLong(4, 0.4, 15),
  },
  'gpt-6-luna': {
    inputPerMTokUsd: 0.1, cachedInputPerMTokUsd: 0.01, outputPerMTokUsd: 0.5,
    cacheWritePerMTokUsd: null, longContext: openAiLong(0.2, 0.02, 0.75),
  },
  // Promotional pricing "through at least 2026-11-21": re-verify after then.
  'gpt-5.6-sol': {
    inputPerMTokUsd: 4, cachedInputPerMTokUsd: 0.4, outputPerMTokUsd: 20,
    cacheWritePerMTokUsd: null, longContext: openAiLong(8, 0.8, 30),
  },
  'gpt-5.6-terra': {
    inputPerMTokUsd: 2, cachedInputPerMTokUsd: 0.2, outputPerMTokUsd: 12,
    cacheWritePerMTokUsd: null, longContext: openAiLong(4, 0.4, 18),
  },
  'gpt-5.6-luna': {
    inputPerMTokUsd: 0.2, cachedInputPerMTokUsd: 0.02, outputPerMTokUsd: 1.2,
    cacheWritePerMTokUsd: null, longContext: openAiLong(0.4, 0.04, 1.8),
  },
  'gpt-5.5': {
    inputPerMTokUsd: 5, cachedInputPerMTokUsd: 0.5, outputPerMTokUsd: 30,
    longContext: openAiLong(10, 1, 45),
  },
  'gpt-5.5-pro': {
    inputPerMTokUsd: 30, cachedInputPerMTokUsd: null, outputPerMTokUsd: 180,
    longContext: openAiLong(60, null, 270),
  },
  'gpt-5.4': {
    inputPerMTokUsd: 2.5, cachedInputPerMTokUsd: 0.25, outputPerMTokUsd: 15,
    longContext: openAiLong(5, 0.5, 22.5),
  },
  'gpt-5.4-pro': {
    inputPerMTokUsd: 30, cachedInputPerMTokUsd: null, outputPerMTokUsd: 180,
    longContext: openAiLong(60, null, 270),
  },
  'gpt-5.4-mini': { inputPerMTokUsd: 0.75, cachedInputPerMTokUsd: 0.075, outputPerMTokUsd: 4.5 },
  'gpt-5.4-nano': { inputPerMTokUsd: 0.2, cachedInputPerMTokUsd: 0.02, outputPerMTokUsd: 1.25 },
  'gpt-5.3-codex': { inputPerMTokUsd: 1.75, cachedInputPerMTokUsd: 0.175, outputPerMTokUsd: 14 },
  'gpt-5.2': { inputPerMTokUsd: 1.75, cachedInputPerMTokUsd: 0.175, outputPerMTokUsd: 14 },
  'gpt-5.2-pro': { inputPerMTokUsd: 21, cachedInputPerMTokUsd: null, outputPerMTokUsd: 168 },
  'gpt-5.1': { inputPerMTokUsd: 1.25, cachedInputPerMTokUsd: 0.125, outputPerMTokUsd: 10 },
  'gpt-5': { inputPerMTokUsd: 1.25, cachedInputPerMTokUsd: 0.125, outputPerMTokUsd: 10 },
  'gpt-5-mini': { inputPerMTokUsd: 0.25, cachedInputPerMTokUsd: 0.025, outputPerMTokUsd: 2 },
  'gpt-5-nano': { inputPerMTokUsd: 0.05, cachedInputPerMTokUsd: 0.005, outputPerMTokUsd: 0.4 },
  'gpt-5-pro': { inputPerMTokUsd: 15, cachedInputPerMTokUsd: null, outputPerMTokUsd: 120 },
  'gpt-4.1': { inputPerMTokUsd: 2, cachedInputPerMTokUsd: 0.5, outputPerMTokUsd: 8 },
  'gpt-4.1-mini': { inputPerMTokUsd: 0.4, cachedInputPerMTokUsd: 0.1, outputPerMTokUsd: 1.6 },
  'gpt-4o': { inputPerMTokUsd: 2.5, cachedInputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  'gpt-4o-mini': { inputPerMTokUsd: 0.15, cachedInputPerMTokUsd: 0.075, outputPerMTokUsd: 0.6 },
  o3: { inputPerMTokUsd: 2, cachedInputPerMTokUsd: 0.5, outputPerMTokUsd: 8 },
  'o3-pro': { inputPerMTokUsd: 20, cachedInputPerMTokUsd: null, outputPerMTokUsd: 80 },
  // Not on the current page: earlier per-model pages, legacy cache multipliers.
  'gpt-5-codex': { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  'codex-mini-latest': { inputPerMTokUsd: 1.5, outputPerMTokUsd: 6 },
  'gpt-4-turbo': { inputPerMTokUsd: 10, outputPerMTokUsd: 30 },
  o1: { inputPerMTokUsd: 15, outputPerMTokUsd: 60 },
  'o1-mini': { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 },
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
export const MODEL_PRICING_AS_OF = '2026-11-04';

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
   * Prompt-cache read tokens (`cache_read_input_tokens`). Billed at the
   * model's cached-input rate (else {@link CACHE_READ_INPUT_MULTIPLIER}x the
   * input rate). Defaults to 0.
   */
  cacheReadTokens?: number;
  /**
   * The counts are **one provider request**, so a model's long-context tier
   * applies when its prompt (input + cache read + cache write) exceeds the
   * threshold. Leave unset for aggregates (a session or task total), which
   * cannot be split back into requests and are billed at the standard rates.
   */
  requestScoped?: boolean;
}

/** A finite, non-negative number, or 0 when the value is absent/invalid-as-zero. */
function nonNegativeOrNull(value: number | undefined): number | null {
  if (value === undefined) {
    return 0;
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The per-token rates that apply to one priced usage. */
interface AppliedRates {
  input: number;
  output: number;
  /** `undefined`: no rate, so non-zero tokens of this kind are unpriceable. */
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
}

function cacheRate(
  explicit: number | null | undefined,
  inputRate: number,
  multiplier: number,
  legacyEligible: boolean,
): number | undefined {
  if (explicit === null) return undefined;
  if (explicit !== undefined) return explicit;
  return legacyEligible ? inputRate * multiplier : undefined;
}

function appliedRates(
  model: string,
  price: ModelPrice,
  promptTokens: number,
  requestScoped: boolean,
): AppliedRates {
  // Anthropic, and OpenAI rows without an explicit cache rate, keep the
  // legacy multipliers; any other provider has no cache pricing here.
  const legacyEligible = isAnthropicModel(model) || isOpenAIModel(model);
  const long =
    requestScoped && price.longContext && promptTokens > price.longContext.thresholdInputTokens
      ? price.longContext
      : undefined;
  if (long) {
    return {
      input: long.inputPerMTokUsd,
      output: long.outputPerMTokUsd,
      cacheRead: cacheRate(long.cachedInputPerMTokUsd, long.inputPerMTokUsd, CACHE_READ_INPUT_MULTIPLIER, false),
      // Long-context cache writes share the TTL ambiguity: never priced.
      cacheWrite: undefined,
    };
  }
  return {
    input: price.inputPerMTokUsd,
    output: price.outputPerMTokUsd,
    cacheRead: cacheRate(price.cachedInputPerMTokUsd, price.inputPerMTokUsd, CACHE_READ_INPUT_MULTIPLIER, legacyEligible),
    cacheWrite: cacheRate(price.cacheWritePerMTokUsd, price.inputPerMTokUsd, CACHE_WRITE_INPUT_MULTIPLIER, legacyEligible),
  };
}

/**
 * Compute `actual_cost_usd` from token counts and the resolved model. Cache
 * reads and writes are billed at the model's own rates when the table has them
 * (OpenAI), else at the {@link CACHE_WRITE_INPUT_MULTIPLIER} /
 * {@link CACHE_READ_INPUT_MULTIPLIER} multipliers (Anthropic, and OpenAI rows
 * the current page no longer lists). A `requestScoped` usage whose prompt
 * exceeds the model's long-context threshold uses the long-context rates.
 * Returns `undefined` — never a fabricated value — when the model is unknown,
 * when any supplied token count is not a finite, non-negative number, or when
 * non-zero cache tokens are supplied with no rate for them (Gemini, OpenAI
 * models without a cached rate, TTL-dependent cache writes). Adapters should
 * pass a measured charge for those.
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

  const rates = appliedRates(
    input.model,
    price,
    inputTokens + cacheReadTokens + cacheCreationTokens,
    input.requestScoped === true,
  );
  if (
    (cacheReadTokens > 0 && rates.cacheRead === undefined) ||
    (cacheCreationTokens > 0 && rates.cacheWrite === undefined)
  ) {
    return undefined;
  }

  const cost =
    (inputTokens / 1_000_000) * rates.input +
    (cacheCreationTokens / 1_000_000) * (rates.cacheWrite ?? 0) +
    (cacheReadTokens / 1_000_000) * (rates.cacheRead ?? 0) +
    (outputTokens / 1_000_000) * rates.output;
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

function isOpenAIModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (OPENAI_MODEL_PRICING[normalized]) {
    return true;
  }
  return Boolean(OPENAI_MODEL_PRICING[stripKnownSnapshotSuffixes(normalized)]);
}
