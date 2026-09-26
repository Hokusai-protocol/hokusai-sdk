/**
 * Allow-list projections for source records.
 *
 * Adapters keep only numeric counters, session/turn identifiers, model
 * strings, and observation timestamps. Any other field a provider might ship
 * (prompts, tool arguments, response text, paths, account ids) has no code
 * path to reach a `TaskCostEventV1`, so a future provider format shift cannot
 * leak new payloads by accident.
 *
 * @module sources/sanitize
 */

/** Non-empty string helper; returns `undefined` for any other value. */
export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Finite non-negative integer helper; returns `null` for any other value. */
export function readNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Finite non-negative float helper; returns `null` otherwise. */
export function readNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * ISO-8601 UTC timestamp helper. Accepts a string or an epoch-millisecond
 * number; returns `undefined` otherwise.
 */
export function readTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
}
