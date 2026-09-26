/**
 * Per-event pricing resolution: given one event's usage and cost evidence,
 * decide `actual_cost_usd`, `estimated_cost_usd`, and the provenance stamps
 * (`pricing_source`, `price_table`, `pricing_revision`, `cost_source`).
 *
 * Precedence for the estimate: caller-supplied estimate > host price override
 * > built-in table > none. A provider-reported charge (`actualCostUsd`) is
 * orthogonal — it is recorded alongside whatever estimate resolves, and wins
 * as the resolved cost downstream.
 *
 * No code path here ever produces `0` as a stand-in for "unknown": an
 * unpriceable event gets `estimatedCostUsd: null` plus a diagnostic, and a
 * zero only appears when a price table or the provider actually said zero.
 *
 * @module pricing-resolver
 */

import {
  ANTHROPIC_MODEL_PRICING,
  GOOGLE_MODEL_PRICING,
  MODEL_PRICING_AS_OF,
  OPENAI_MODEL_PRICING,
  computeActualCostUsd,
  normalizeModelId,
  resolveModelPrice,
  type ModelPrice,
  type TaskCostBasis,
  type TaskCostDiagnosticCode,
  type TaskCostEventSource,
  type TaskCostHarness,
  type TaskCostPriceTable,
  type TaskCostPricingSource,
  type TaskCostTokenUsage,
} from '@hokusai/core';
import { priceTokens, toMicroUsd } from './money.js';

/** Explicit host override for a model's pricing. Beats the built-in table. */
export interface HostPriceOverride {
  /** Model id as the caller supplies it. Matched via `normalizeModelId` on both sides. */
  model: string;
  /** USD per 1,000,000 input tokens. Finite, >= 0. */
  inputPerMTokUsd: number;
  /** USD per 1,000,000 output tokens. Finite, >= 0. */
  outputPerMTokUsd: number;
  /**
   * Multiplier on `inputPerMTokUsd` for cache-write tokens. When absent and an
   * event carries non-zero cache-write tokens, the event is left unpriced
   * (with a `no_pricing_data` diagnostic) rather than silently undercounted.
   */
  cacheWriteMultiplier?: number;
  /** Multiplier on `inputPerMTokUsd` for cache-read tokens; same rule as writes. */
  cacheReadMultiplier?: number;
  /**
   * Revision / as-of date stamped as `pricing_revision` on rows priced from
   * this override. Must match the contract's version pattern when set.
   */
  asOf?: string;
  /** Label for the event's `price_table`. Defaults to `'override'`. */
  priceTable?: TaskCostPriceTable;
}

export interface EventPricingContext {
  overrides?: readonly HostPriceOverride[];
  /**
   * Revision stamped on rows priced from the built-in table (defaults to
   * `MODEL_PRICING_AS_OF` there). For override- or caller-priced rows it is
   * only used as an explicit fallback, never defaulted.
   */
  pricingRevision?: string;
}

export interface EventPricingRequest {
  observedModel: string;
  usage: TaskCostTokenUsage;
  /** Provider-reported charge; `0` is a known-zero charge, `null`/absent is missing. */
  actualCostUsd?: number | null;
  costBasis?: TaskCostBasis;
  harness?: TaskCostHarness;
  /**
   * Caller-supplied estimate. When present (including an explicit `null`) the
   * engine trusts it verbatim and skips its own pricing.
   */
  estimatedCostUsd?: number | null;
  pricingSource?: 'local_estimate' | 'openrouter_api';
  priceTable?: TaskCostPriceTable;
}

export interface ResolvedEventPricing {
  actualCostUsd: number | null;
  estimatedCostUsd: number | null;
  pricingSource: TaskCostPricingSource;
  priceTable?: TaskCostPriceTable;
  pricingRevision?: string;
  costSource: TaskCostEventSource;
  diagnostics: readonly TaskCostDiagnosticCode[];
}

/**
 * Validate one override and return its normalized lookup key. Throws
 * `TypeError` naming the model so a bad host configuration fails fast at
 * engine construction instead of mispricing events later.
 */
export function validateHostPriceOverride(override: HostPriceOverride): string {
  const label = `price override for model "${override.model}"`;
  if (
    typeof override.model !== 'string' ||
    override.model.trim().length === 0
  ) {
    throw new TypeError('price override model must be a non-empty string');
  }
  for (const [field, value] of [
    ['inputPerMTokUsd', override.inputPerMTokUsd],
    ['outputPerMTokUsd', override.outputPerMTokUsd],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(
        `${label}: ${field} must be a finite non-negative number`,
      );
    }
  }
  for (const [field, value] of [
    ['cacheWriteMultiplier', override.cacheWriteMultiplier],
    ['cacheReadMultiplier', override.cacheReadMultiplier],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    ) {
      throw new TypeError(
        `${label}: ${field} must be a finite non-negative number`,
      );
    }
  }
  return normalizeModelId(override.model);
}

/**
 * Build the normalized-model index for a set of overrides. Two overrides that
 * normalize to the same model id are ambiguous and throw `TypeError`.
 */
export function buildOverrideIndex(
  overrides: readonly HostPriceOverride[],
): ReadonlyMap<string, HostPriceOverride> {
  const index = new Map<string, HostPriceOverride>();
  for (const override of overrides) {
    const key = validateHostPriceOverride(override);
    if (index.has(key)) {
      throw new TypeError(
        `duplicate price override for model "${override.model}" (normalizes to "${key}")`,
      );
    }
    index.set(key, override);
  }
  return index;
}

/**
 * Which built-in table a resolved price came from. `MODEL_PRICING` is the
 * spread of the three provider tables, so the resolved `ModelPrice` object is
 * reference-identical to exactly one table's row.
 */
function builtInPriceTable(price: ModelPrice): TaskCostPriceTable {
  if (Object.values(ANTHROPIC_MODEL_PRICING).includes(price))
    return 'anthropic';
  if (Object.values(OPENAI_MODEL_PRICING).includes(price)) return 'openai';
  if (Object.values(GOOGLE_MODEL_PRICING).includes(price)) return 'google';
  /* v8 ignore next 2 -- unreachable while MODEL_PRICING is the union of the three tables */
  return 'external';
}

/**
 * The output tokens to bill. Codex reports reasoning tokens separately and
 * bills them as output; Claude Code's thinking tokens are already inside
 * `output_tokens`. Mirrors the rule the golden fixtures were priced with.
 */
function billableOutputTokens(
  usage: TaskCostTokenUsage,
  harness: TaskCostHarness | undefined,
): number | null {
  if (usage.output_tokens === null) return null;
  return harness === 'codex'
    ? usage.output_tokens + (usage.reasoning_tokens ?? 0)
    : usage.output_tokens;
}

interface EstimateResolution {
  estimated: number | null;
  pricingSource: TaskCostPricingSource;
  priceTable?: TaskCostPriceTable;
  pricingRevision?: string;
  diagnostics: TaskCostDiagnosticCode[];
}

function priceWithOverride(
  override: HostPriceOverride,
  usage: TaskCostTokenUsage,
  inputTokens: number,
  outputTokens: number,
  ctx: EventPricingContext,
): EstimateResolution {
  const provenance = {
    pricingSource: 'local_estimate' as const,
    priceTable: override.priceTable ?? ('override' as const),
    ...((override.asOf ?? ctx.pricingRevision)
      ? { pricingRevision: override.asOf ?? ctx.pricingRevision }
      : {}),
  };

  // A missing cache counter means "not reported"; like `computeActualCostUsd`
  // we bill it as zero. A *reported* non-zero cache counter with no configured
  // multiplier cannot be priced honestly, so the whole estimate stays null.
  const cacheWrite = usage.cache_write_tokens ?? 0;
  const cacheRead = usage.cache_read_tokens ?? 0;
  if (
    (cacheWrite > 0 && override.cacheWriteMultiplier === undefined) ||
    (cacheRead > 0 && override.cacheReadMultiplier === undefined)
  ) {
    return {
      estimated: null,
      pricingSource: 'none',
      diagnostics: ['no_pricing_data'],
    };
  }

  const pico =
    priceTokens(inputTokens, override.inputPerMTokUsd) +
    priceTokens(outputTokens, override.outputPerMTokUsd) +
    priceTokens(
      cacheWrite,
      override.inputPerMTokUsd * (override.cacheWriteMultiplier ?? 0),
    ) +
    priceTokens(
      cacheRead,
      override.inputPerMTokUsd * (override.cacheReadMultiplier ?? 0),
    );
  return { estimated: toMicroUsd(pico), ...provenance, diagnostics: [] };
}

function priceWithBuiltInTable(
  model: string,
  usage: TaskCostTokenUsage,
  inputTokens: number,
  outputTokens: number,
  ctx: EventPricingContext,
): EstimateResolution {
  const price = resolveModelPrice(model);
  if (price === undefined) {
    // Usage was complete enough to price but no price exists anywhere.
    return {
      estimated: null,
      pricingSource: 'none',
      diagnostics: ['unpriced_model'],
    };
  }
  const estimated = computeActualCostUsd({
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens: usage.cache_write_tokens ?? 0,
    cacheReadTokens: usage.cache_read_tokens ?? 0,
  });
  if (estimated === undefined) {
    // The model is priced but this usage is not (non-Anthropic cache tokens,
    // whose cache rates the table does not represent).
    return {
      estimated: null,
      pricingSource: 'none',
      diagnostics: ['no_pricing_data'],
    };
  }
  return {
    estimated,
    pricingSource: 'local_estimate',
    priceTable: builtInPriceTable(price),
    pricingRevision: ctx.pricingRevision ?? MODEL_PRICING_AS_OF,
    diagnostics: [],
  };
}

function resolveEstimate(
  req: EventPricingRequest,
  ctx: EventPricingContext,
): EstimateResolution {
  // Branch 1 — the caller pre-computed its own estimate (or explicitly said
  // "no estimate" with null). Trust it; provenance comes from the caller.
  if (req.estimatedCostUsd !== undefined) {
    if (req.estimatedCostUsd === null) {
      return { estimated: null, pricingSource: 'none', diagnostics: [] };
    }
    return {
      estimated: req.estimatedCostUsd,
      pricingSource: req.pricingSource ?? 'local_estimate',
      priceTable: req.priceTable ?? 'external',
      ...(ctx.pricingRevision !== undefined
        ? { pricingRevision: ctx.pricingRevision }
        : {}),
      diagnostics: [],
    };
  }

  // Pricing needs both input and output counts; a gap stays a gap (the
  // reducer reports `missing_token_usage` for it).
  const inputTokens = req.usage.input_tokens;
  const outputTokens = billableOutputTokens(req.usage, req.harness);
  if (inputTokens === null || outputTokens === null) {
    return { estimated: null, pricingSource: 'none', diagnostics: [] };
  }

  // Branch 2 — explicit host override beats the built-in table.
  const override = buildOverrideIndex(ctx.overrides ?? []).get(
    normalizeModelId(req.observedModel),
  );
  if (override !== undefined) {
    return priceWithOverride(
      override,
      req.usage,
      inputTokens,
      outputTokens,
      ctx,
    );
  }

  // Branch 3/4 — built-in table, or nothing.
  return priceWithBuiltInTable(
    req.observedModel,
    req.usage,
    inputTokens,
    outputTokens,
    ctx,
  );
}

/**
 * Resolve one event's pricing. Pure; never throws for malformed cost inputs —
 * a non-finite or negative provider charge degrades to `null` with an
 * `invalid_token_usage` diagnostic so the event is kept (its usage is still
 * real) without fabricating a charge.
 */
export function resolveEventPrice(
  req: EventPricingRequest,
  ctx: EventPricingContext = {},
): ResolvedEventPricing {
  const diagnostics: TaskCostDiagnosticCode[] = [];

  let actual: number | null = null;
  if (req.actualCostUsd !== undefined && req.actualCostUsd !== null) {
    if (Number.isFinite(req.actualCostUsd) && req.actualCostUsd >= 0) {
      actual = req.actualCostUsd;
    } else {
      diagnostics.push('invalid_token_usage');
    }
  }

  const estimate = resolveEstimate(req, ctx);
  diagnostics.push(...estimate.diagnostics);

  return {
    actualCostUsd: actual,
    estimatedCostUsd: estimate.estimated,
    pricingSource:
      estimate.estimated === null ? 'none' : estimate.pricingSource,
    ...(estimate.priceTable !== undefined && estimate.estimated !== null
      ? { priceTable: estimate.priceTable }
      : {}),
    ...(estimate.pricingRevision !== undefined && estimate.estimated !== null
      ? { pricingRevision: estimate.pricingRevision }
      : {}),
    costSource:
      actual !== null
        ? 'provider_reported'
        : estimate.estimated !== null
          ? 'local_estimate'
          : 'none',
    diagnostics,
  };
}
