/**
 * User-facing routing objective.
 *
 * These are the plain words a user picks (via `--objective`, `HOKUSAI_OBJECTIVE`,
 * or persisted config). They map to the backend router's `objective` enum. The
 * default is `reliability` — every route sends `highest_reliability` unless the
 * user overrides it.
 */
export type RoutingObjective = 'speed' | 'cost' | 'reliability';

/** The objective applied when the user does not choose one. */
export const DEFAULT_ROUTING_OBJECTIVE: RoutingObjective = 'reliability';

/** Every accepted objective, in display order. */
export const ROUTING_OBJECTIVES: readonly RoutingObjective[] = [
  'speed',
  'cost',
  'reliability',
];

/** Backend router objective enum (see TechnicalTaskRouterInputs.routing.objective). */
export type RoutingObjectiveApiValue =
  | 'fastest_completion'
  | 'lowest_cost'
  | 'highest_reliability';

const ALIASES: Record<string, RoutingObjective> = {
  speed: 'speed',
  fast: 'speed',
  fastest: 'speed',
  latency: 'speed',
  // backend enum, accepted for power users
  fastest_completion: 'speed',
  cost: 'cost',
  cheap: 'cost',
  cheapest: 'cost',
  lowest_cost: 'cost',
  reliability: 'reliability',
  reliable: 'reliability',
  quality: 'reliability',
  highest_reliability: 'reliability',
};

const API_VALUES: Record<RoutingObjective, RoutingObjectiveApiValue> = {
  speed: 'fastest_completion',
  cost: 'lowest_cost',
  reliability: 'highest_reliability',
};

/**
 * Parse a user-supplied objective (word or backend enum, case-insensitive).
 * Returns `undefined` for unrecognized input so callers can surface a clear error.
 */
export function parseRoutingObjective(
  value: string | undefined | null,
): RoutingObjective | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return ALIASES[value.trim().toLowerCase()];
}

/** Map a user-facing objective to the backend router enum value. */
export function routingObjectiveToApiValue(
  objective: RoutingObjective,
): RoutingObjectiveApiValue {
  return API_VALUES[objective];
}
