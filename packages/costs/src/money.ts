/**
 * Exact money arithmetic for host-override pricing.
 *
 * `computeActualCostUsd` (the built-in table path) keeps its float arithmetic
 * untouched for backward compatibility. Override pricing instead multiplies
 * token counts by per-million-token rates in BigInt pico-USD (10^-12 USD), so
 * token counts up to and beyond `Number.MAX_SAFE_INTEGER` price exactly, then
 * rounds once at the end.
 *
 * Unit ladder: 1 USD = 10^6 micro-USD = 10^9 nano-USD = 10^12 pico-USD.
 * A per-MTok rate expressed in pico-USD-per-token is `rate × 10^12 / 10^6 =
 * rate × 10^6`, which stays integral for any realistic price (rates are quoted
 * to at most micro-USD-per-MTok precision).
 *
 * @module money
 */

const PICO_PER_TOKEN_SCALE = 1_000_000; // rate USD/MTok -> pico-USD/token
const PICO_PER_NANO = 1000n;
const PICO_PER_MICRO = 1_000_000n;

/**
 * Convert a USD-per-million-token rate to pico-USD per token. The float rate
 * is scaled while still a Number (exact for realistic rates) and rounded once,
 * so no float→BigInt drift accumulates per token.
 */
function rateToPicoPerToken(ratePerMTokUsd: number): bigint {
  return BigInt(Math.round(ratePerMTokUsd * PICO_PER_TOKEN_SCALE));
}

/**
 * Price `tokens` at `ratePerMTokUsd`, exactly, as pico-USD.
 *
 * Non-finite or negative inputs yield `0n` as a belt-and-braces guard; the
 * engine validates token counts and override rates before ever calling this.
 */
export function priceTokens(tokens: number, ratePerMTokUsd: number): bigint {
  if (!Number.isFinite(tokens) || tokens < 0 || !Number.isInteger(tokens))
    return 0n;
  if (!Number.isFinite(ratePerMTokUsd) || ratePerMTokUsd < 0) return 0n;
  return BigInt(tokens) * rateToPicoPerToken(ratePerMTokUsd);
}

/** Round a non-negative pico-USD total half-up at `unit` pico-USD, in BigInt. */
function roundPicoTo(pico: bigint, unit: bigint): bigint {
  return (pico + unit / 2n) / unit;
}

/**
 * Reduce a pico-USD total to a Number rounded at nano-USD (9 decimals) — the
 * contract's summary precision. Rounding happens in BigInt space so totals
 * beyond 2^53 pico-USD do not pick up float noise before the final division.
 */
export function toNanoUsd(picoTotal: bigint): number {
  return Number(roundPicoTo(picoTotal, PICO_PER_NANO)) / 1e9;
}

/**
 * Reduce a pico-USD total to a Number rounded at micro-USD (6 decimals) — the
 * same precision `computeActualCostUsd` rounds to, so override-priced events
 * are indistinguishable from table-priced ones downstream.
 */
export function toMicroUsd(picoTotal: bigint): number {
  return Number(roundPicoTo(picoTotal, PICO_PER_MICRO)) / 1e6;
}
