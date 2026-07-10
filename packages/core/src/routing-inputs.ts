/**
 * Typed routing inputs for the Model 30 technical task router.
 *
 * Candidate pools are typed arrays on the dispatch payload. They used to be CSV
 * strings smuggled through `task.metadata` (`Record<string, string>`), which the
 * router could not distinguish from a genuinely single-model harness. That path
 * still works, but it is deprecated and reported through `deprecations`.
 *
 * See `documentation/api-reference/model-30-routing-contract.md` in
 * hokusai-data-pipeline for the authoritative server contract.
 */

import {
  parseRoutingObjective,
  routingObjectiveToApiValue,
  type RoutingObjectiveApiValue,
} from './routing-objective.js';
import type { HokusaiFieldError } from './schemas.js';

/** The three router roles that can carry their own candidate pool. */
export const ROUTING_ROLES = ['planner', 'coder', 'reviewer'] as const;

export type RoutingRole = (typeof ROUTING_ROLES)[number];

/**
 * Whether a route call is allowed to send a pool the router cannot rank.
 *
 * `ranking` (the default) requires every constrained role to offer at least two
 * models. `non-ranking` is the explicit opt-in for single-model harnesses: the
 * request is sent and the server records the row as `non_ranking` telemetry,
 * excluded from ranking and from the Model 30 training set.
 */
export type RoutingMode = 'ranking' | 'non-ranking';

/**
 * Server-side classification of a request's candidate pools, mirroring the
 * fidelity tiers the contribution endpoint assigns.
 */
export type RoutingPoolFidelity =
  | 'ranking'
  | 'partially_ranking'
  | 'non_ranking';

export interface RoutingCandidatePools {
  /** General candidate pool. Roles without their own pool fall back to this. */
  availableModels?: string[] | undefined;
  availablePlannerModels?: string[] | undefined;
  availableCoderModels?: string[] | undefined;
  availableReviewerModels?: string[] | undefined;
}

/** Typed routing inputs carried on a dispatch payload. */
export interface RouteRoutingInput extends RoutingCandidatePools {
  preferredModels?: string[] | undefined;
  objective?: RoutingObjectiveApiValue | undefined;
  maxCostUsd?: number | undefined;
  maxLatencySeconds?: number | undefined;
  prioritizeQuality?: boolean | undefined;
  prioritizeSpeed?: boolean | undefined;
}

const ROLE_POOL_FIELDS: Record<RoutingRole, keyof RoutingCandidatePools> = {
  planner: 'availablePlannerModels',
  coder: 'availableCoderModels',
  reviewer: 'availableReviewerModels',
};

/** Metadata keys the deprecated CSV path reads, in typed-field order. */
const CSV_METADATA_KEYS: Record<keyof RoutingCandidatePools, string> = {
  availableModels: 'available_models',
  availablePlannerModels: 'available_planner_models',
  availableCoderModels: 'available_coder_models',
  availableReviewerModels: 'available_reviewer_models',
};

function normalizePool(value: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

function parseCsvPool(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const entries = normalizePool(value.split(','));
  return entries.length > 0 ? entries : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseObjective(value: unknown): RoutingObjectiveApiValue | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const objective = parseRoutingObjective(value);
  return objective ? routingObjectiveToApiValue(objective) : undefined;
}

/**
 * The pool the router will actually consider for `role`: the role-specific pool
 * when present, otherwise the general pool. `undefined` means unconstrained.
 */
export function effectiveRolePool(
  pools: RoutingCandidatePools,
  role: RoutingRole,
): string[] | undefined {
  return pools[ROLE_POOL_FIELDS[role]] ?? pools.availableModels;
}

/**
 * Classify candidate pools the way the server does.
 *
 * Omitting every pool means unconstrained global ranking. A constrained role
 * with two or more unique models is ranking-eligible; one with exactly one model
 * is not. All-singleton is `non_ranking`; a mix is `partially_ranking`.
 */
export function classifyRoutingPools(
  pools: RoutingCandidatePools,
): RoutingPoolFidelity {
  const constrained = ROUTING_ROLES.map((role) =>
    effectiveRolePool(pools, role),
  ).filter((pool): pool is string[] => pool !== undefined);

  if (constrained.length === 0) {
    return 'ranking';
  }

  const singletons = constrained.filter(
    (pool) => normalizePool(pool).length < 2,
  );

  if (singletons.length === 0) {
    return 'ranking';
  }

  return singletons.length === constrained.length
    ? 'non_ranking'
    : 'partially_ranking';
}

/** Roles whose effective pool holds fewer than two unique models. */
export function singletonRoles(pools: RoutingCandidatePools): RoutingRole[] {
  return ROUTING_ROLES.filter((role) => {
    const pool = effectiveRolePool(pools, role);
    return pool !== undefined && normalizePool(pool).length < 2;
  });
}

/**
 * Schema-level validation. Explicit empty arrays are rejected by the server, so
 * reject them here rather than sending a request that cannot succeed. Omitting a
 * pool entirely is the way to say "unconstrained".
 */
export function validateRoutingInput(
  routing: RouteRoutingInput | undefined,
  path = 'routing',
): HokusaiFieldError[] {
  if (routing === undefined) {
    return [];
  }

  const errors: HokusaiFieldError[] = [];
  const poolFields: Array<keyof RoutingCandidatePools | 'preferredModels'> = [
    'availableModels',
    'availablePlannerModels',
    'availableCoderModels',
    'availableReviewerModels',
    'preferredModels',
  ];

  for (const field of poolFields) {
    const value = routing[field];
    if (value === undefined) {
      continue;
    }

    if (!Array.isArray(value)) {
      errors.push({
        path: `${path}.${field}`,
        message: 'Expected an array of model ids.',
        code: 'invalid_type',
      });
      continue;
    }

    if (normalizePool(value).length === 0) {
      errors.push({
        path: `${path}.${field}`,
        message:
          'Candidate pool must not be empty. Omit the field to leave the pool unconstrained.',
        code: 'invalid_value',
      });
    }
  }

  return errors;
}

export interface ResolvedRoutingInput {
  routing: RouteRoutingInput;
  fidelity: RoutingPoolFidelity;
  /** Human-readable notices for CSV metadata keys that were honoured. */
  deprecations: string[];
}

export interface ResolveRoutingInputOptions {
  /** Typed routing inputs from the dispatch payload. Highest precedence. */
  routing?: RouteRoutingInput | undefined;
  /** Deprecated CSV metadata carried on the task. */
  metadata?: Record<string, string> | undefined;
  /**
   * Pool used when neither a typed field nor CSV metadata supplies one —
   * normally every model the harness registry offers.
   */
  fallbackModels: string[];
}

/**
 * Resolve the effective routing input. Precedence per field: typed payload
 * field, then deprecated CSV metadata, then the registry-derived fallback.
 *
 * Only `availableModels` takes the fallback. Role pools are left undefined so
 * the server applies its own documented fallback to `availableModels`, which
 * keeps the request honest about what the harness actually constrained.
 */
export function resolveRoutingInput(
  options: ResolveRoutingInputOptions,
): ResolvedRoutingInput {
  const typed = options.routing ?? {};
  const metadata = options.metadata ?? {};
  const deprecations: string[] = [];

  const fromCsv = (
    field: keyof RoutingCandidatePools,
  ): string[] | undefined => {
    const key = CSV_METADATA_KEYS[field];
    const parsed = parseCsvPool(metadata[key]);
    if (parsed) {
      deprecations.push(
        `task.metadata.${key} is deprecated; set routing.${field} on the dispatch payload instead.`,
      );
    }
    return parsed;
  };

  const resolvePool = (
    field: keyof RoutingCandidatePools,
  ): string[] | undefined => {
    const typedValue = typed[field];
    if (typedValue !== undefined) {
      return normalizePool(typedValue);
    }
    return fromCsv(field);
  };

  const availableModels =
    resolvePool('availableModels') ?? normalizePool(options.fallbackModels);

  const pools: RoutingCandidatePools = {
    availableModels,
    availablePlannerModels: resolvePool('availablePlannerModels'),
    availableCoderModels: resolvePool('availableCoderModels'),
    availableReviewerModels: resolvePool('availableReviewerModels'),
  };

  const preferredModels =
    typed.preferredModels !== undefined
      ? normalizePool(typed.preferredModels)
      : parseCsvPool(metadata.preferred_models);

  const routing: RouteRoutingInput = {
    ...pools,
    preferredModels,
    objective: typed.objective ?? parseObjective(metadata.objective),
    maxCostUsd: typed.maxCostUsd ?? parseNumber(metadata.max_cost_usd),
    maxLatencySeconds:
      typed.maxLatencySeconds ?? parseNumber(metadata.max_latency_seconds),
    prioritizeQuality:
      typed.prioritizeQuality ?? parseBoolean(metadata.prioritize_quality),
    prioritizeSpeed:
      typed.prioritizeSpeed ?? parseBoolean(metadata.prioritize_speed),
  };

  return {
    routing,
    fidelity: classifyRoutingPools(pools),
    deprecations,
  };
}
