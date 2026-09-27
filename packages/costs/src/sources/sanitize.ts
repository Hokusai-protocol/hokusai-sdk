/**
 * Allow-list projection helpers. Every value an adapter lifts out of a raw
 * source row passes through one of these; anything that fails the shape check
 * becomes `null` (missing) rather than being coerced or copied verbatim.
 * Prompts, transcript text, paths, and identity fields are never read at all
 * — the parsers only ever access the allow-listed keys.
 *
 * @module sources/sanitize
 */

/**
 * Identifier/version/model shapes mirror the `@hokusai/core` task-cost
 * validator patterns (which are not exported). Drift fails loudly: a value
 * accepted here but rejected by the contract makes the engine reject the
 * whole event, never mis-attribute it.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** Narrow to a plain object, else `null`. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A contract-safe identifier, else `null`. */
export function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

/** A contract-safe model id, else `null`. */
export function modelOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !MODEL_PATTERN.test(value)) return null;
  if (value.includes('..') || value.includes('//')) return null;
  return value;
}

/** A contract-safe version string, else `null`. */
export function versionOrNull(value: unknown): string | null {
  return typeof value === 'string' && VERSION_PATTERN.test(value)
    ? value
    : null;
}

/** A non-negative integer token count, else `null`. */
export function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** A finite non-negative USD amount, else `null`. */
export function usdOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Whether a raw field was present at all (as opposed to malformed). */
export function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export interface NormalizedTimestamp {
  /** Canonical ISO-8601 UTC form accepted by the contract validators. */
  iso: string;
  /** Epoch milliseconds, for boundary-window comparison. */
  ms: number;
}

/** Parse and canonicalize a timestamp, else `null`. */
export function timestampOrNull(value: unknown): NormalizedTimestamp | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
  return { iso, ms };
}
