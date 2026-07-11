/**
 * `@hokusai/router` — the front-door façade over `@hokusai/core`.
 *
 * The homepage promises a two-call API:
 *
 * ```ts
 * import { route } from '@hokusai/router';
 *
 * const { model, reasoning } = await route({ task, context });
 * const result = await models[model].run(task);
 * await route.reportOutcome({ status: 'succeeded', latency, cost, tokens });
 * ```
 *
 * This package makes that real. `route` is a zero-config callable that reads
 * `HOKUSAI_API_KEY` from the environment and ranks across the default model
 * pool; `route.reportOutcome` submits the outcome that trains the router.
 *
 * The façade owns the wiring the common case should not have to: the
 * `HokusaiClient`, the `HokusaiDispatchBuilder`, the consent snapshot, and the
 * model registry. Advanced users can still `createRouter(...)` with explicit
 * options — or drop to `@hokusai/core` directly.
 *
 * Candidate pools are typed (never CSV metadata), and a singleton pool is not
 * swallowed: `route` propagates the same `HokusaiValidationError` core raises,
 * unless the caller opts into `routingMode: 'non-ranking'`.
 */

import {
  ANTHROPIC_MODELS,
  DEFAULT_REDACTION_CONFIG,
  DEFAULT_ROUTING_OBJECTIVE,
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
  OPENAI_MODELS,
  buildOutcomeReport,
  routingObjectiveToApiValue,
  type CoarseBucket,
  type CompletionStatus,
  type ConsentConfig,
  type HokusaiTaskInput,
  type ModelDefinition,
  type OutcomeResponse,
  type RouteResponse,
  type RouteRoutingInput,
  type RoutingMode,
  type RoutingObjective,
} from '@hokusai/core';

/** A model this router may recommend: a full definition or just its id. */
export type RouterModel = string | ModelDefinition;

export interface RouterOptions {
  /** API key. Defaults to `process.env.HOKUSAI_API_KEY` at first use. */
  apiKey?: string;
  /** API base URL. Defaults to the core client's default. */
  baseUrl?: string;
  /**
   * The candidate pool the router ranks across. Defaults to the built-in
   * Anthropic models. Bare id strings are resolved against the built-in
   * catalog, or treated as opaque external models when unknown.
   */
  availableModels?: RouterModel[];
  /** Default routing objective. Defaults to `reliability`. */
  objective?: RoutingObjective;
  /** Consent subject id recorded on dispatched payloads. */
  subjectId?: string;
  /**
   * Inject a preconfigured client. Use this for offline/mocked runs and tests;
   * when set, `apiKey`/`baseUrl` are ignored.
   */
  client?: HokusaiClient;
  /** Router model version to target (e.g. a newer registry model). */
  routeModelId?: string;
  /** Receives deprecation and non-ranking notices. Defaults to `console.warn`. */
  onWarning?: (message: string) => void;
}

export interface RouteInput {
  /** The task to route: raw text, or a structured task with an id/metadata. */
  task: string | HokusaiTaskInput;
  /** Opaque categorical context forwarded to the router (never raw secrets). */
  context?: Record<string, string>;
  /** Per-call candidate pool override (ids). Falls back to the router default. */
  availableModels?: string[];
  /** Per-call objective override. */
  objective?: RoutingObjective;
  /** Models the caller would prefer, all else equal. */
  preferredModels?: string[];
  /** Budget ceiling in USD for the routed work. */
  maxCostUsd?: number;
  /** Latency ceiling in seconds. */
  maxLatencySeconds?: number;
  /**
   * `ranking` (default) rejects a candidate pool the router cannot rank.
   * `non-ranking` sends it anyway as telemetry. See `@hokusai/core`.
   */
  routingMode?: RoutingMode;
}

export interface RouteAlternative {
  model: string;
  reason?: string | undefined;
  confidence?: number | undefined;
}

export interface RouteResult {
  /** The recommended model id. */
  model: string;
  /** Why the router chose it, when the API supplies a rationale. */
  reasoning?: string | undefined;
  confidence?: number | undefined;
  /** Runner-up models, best first. */
  alternatives: RouteAlternative[];
  /** Server route id for this decision. */
  routeId: string;
  /** Correlation id tying this route to its later outcome report. */
  correlationId: string;
}

export interface ReportOutcomeInput {
  /** Which route this outcome is for. Defaults to the most recent `route()`. */
  correlationId?: string;
  /** The model actually run. Defaults to the recommended model. */
  model?: string;
  /** Whether the recommendation was accepted. Defaults to `true`. */
  accepted?: boolean;
  /** How the task ended. */
  status: CompletionStatus;
  /** Coarse latency bucket. */
  latency: CoarseBucket;
  /** Coarse cost bucket. */
  cost: CoarseBucket;
  /** Coarse token bucket. */
  tokens: CoarseBucket;
  /** Optional free-text notes (redacted before submission). */
  notes?: string;
}

/** The callable `route` surface: `route(input)` plus `route.reportOutcome(...)`. */
export interface Router {
  (input: RouteInput): Promise<RouteResult>;
  reportOutcome(input: ReportOutcomeInput): Promise<OutcomeResponse>;
}

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouterError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const BUILT_IN_MODELS: ModelDefinition[] = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
];

function resolveModels(models: RouterModel[]): ModelDefinition[] {
  const byId = new Map(BUILT_IN_MODELS.map((model) => [model.id, model]));
  const resolved: ModelDefinition[] = [];
  const seen = new Set<string>();

  for (const entry of models) {
    if (typeof entry !== 'string') {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        resolved.push(entry);
      }
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    resolved.push(
      byId.get(trimmed) ?? {
        id: trimmed,
        provider: 'external',
        family: 'external',
        capabilities: [],
      },
    );
  }

  if (resolved.length === 0) {
    throw new RouterError('availableModels must contain at least one model.');
  }

  return resolved;
}

function normalizeTask(task: string | HokusaiTaskInput): HokusaiTaskInput {
  if (typeof task === 'string') {
    const prompt = task.trim();
    if (!prompt) {
      throw new RouterError('task must be a non-empty string.');
    }
    return { id: createTaskId(), prompt };
  }

  if (!task.prompt || task.prompt.trim().length === 0) {
    throw new RouterError('task.prompt must be a non-empty string.');
  }
  return { ...task, id: task.id ?? createTaskId() };
}

function createTaskId(): string {
  const cryptoObject = Reflect.get(globalThis, 'crypto') as
    | { randomUUID?: () => string }
    | undefined;
  const suffix = cryptoObject?.randomUUID?.() ?? `${Date.now()}`;
  return `router-task-${suffix}`;
}

/**
 * Build a router with explicit options. Prefer the default `route` export for
 * the common case; use this to inject a client (offline/tests), pin a model
 * pool, or set a default objective.
 */
export function createRouter(options: RouterOptions = {}): Router {
  const models = resolveModels(options.availableModels ?? ANTHROPIC_MODELS);
  const registry = new InMemoryModelRegistry(models);
  const seedModel = registry.getDefault();
  if (!seedModel) {
    throw new RouterError('availableModels must contain at least one model.');
  }

  const subjectId = options.subjectId ?? 'hokusai-router';
  const consent: ConsentConfig = {
    subjectId,
    grantedScopes: ['task-execution', 'telemetry'],
  };

  const dispatchBuilder = new HokusaiDispatchBuilder({
    consent,
    modelRegistry: registry,
    redactionConfig: DEFAULT_REDACTION_CONFIG,
  });

  const client =
    options.client ??
    new HokusaiClient({
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.routeModelId !== undefined
        ? { routeModelId: options.routeModelId }
        : {}),
    });

  const defaultObjective = options.objective ?? DEFAULT_ROUTING_OBJECTIVE;

  let lastCorrelationId: string | undefined;
  let lastRecommendedModel: string | undefined;

  const router = async (input: RouteInput): Promise<RouteResult> => {
    const task = normalizeTask(input.task);
    if (input.context) {
      task.metadata = { ...input.context, ...(task.metadata ?? {}) };
    }

    const objective = input.objective ?? defaultObjective;
    const routing: RouteRoutingInput = {
      objective: routingObjectiveToApiValue(objective),
      ...(input.availableModels
        ? { availableModels: input.availableModels }
        : {}),
      ...(input.preferredModels
        ? { preferredModels: input.preferredModels }
        : {}),
      ...(input.maxCostUsd !== undefined
        ? { maxCostUsd: input.maxCostUsd }
        : {}),
      ...(input.maxLatencySeconds !== undefined
        ? { maxLatencySeconds: input.maxLatencySeconds }
        : {}),
    };

    const payload = await dispatchBuilder.prepareDispatch(
      task,
      seedModel.id,
      'task-execution',
      routing,
    );

    const response = (await client.route(payload, {
      ...(input.routingMode ? { routingMode: input.routingMode } : {}),
      onWarning: options.onWarning ?? defaultWarning,
    })) as RouteResponse;

    const recommendation = response.recommendation;
    if (!recommendation) {
      throw new RouterError(
        'Router response did not include a recommendation.',
      );
    }

    lastCorrelationId = payload.correlation.correlationId;
    lastRecommendedModel = recommendation.model;

    return {
      model: recommendation.model,
      reasoning: recommendation.reason,
      confidence: recommendation.confidence,
      alternatives: (recommendation.alternatives ?? []).map((alternative) => ({
        model: alternative.model,
        reason: alternative.reason,
        confidence: alternative.confidence,
      })),
      routeId: response.routeId,
      correlationId: payload.correlation.correlationId,
    };
  };

  const reportOutcome = async (
    input: ReportOutcomeInput,
  ): Promise<OutcomeResponse> => {
    const correlationId = input.correlationId ?? lastCorrelationId;
    if (!correlationId) {
      throw new RouterError(
        'reportOutcome needs a correlationId. Call route() first, or pass one explicitly.',
      );
    }

    const recommendedModel = lastRecommendedModel ?? input.model;
    if (!recommendedModel) {
      throw new RouterError(
        'reportOutcome needs a model. Call route() first, or pass `model` explicitly.',
      );
    }

    const report = buildOutcomeReport({
      correlationId,
      recommendedModel,
      actualModel: input.model ?? recommendedModel,
      recommendationAccepted: input.accepted ?? true,
      completionStatus: input.status,
      latencyBucket: input.latency,
      costBucket: input.cost,
      tokenBucket: input.tokens,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });

    return (await client.reportOutcome(report)) as OutcomeResponse;
  };

  return Object.assign(router, { reportOutcome });
}

function defaultWarning(message: string): void {
  console.warn(`[hokusai] ${message}`);
}

let defaultRouter: Router | undefined;

function getDefaultRouter(): Router {
  defaultRouter ??= createRouter();
  return defaultRouter;
}

/**
 * The zero-config router. Reads `HOKUSAI_API_KEY` from the environment on first
 * use and ranks across the default Anthropic model pool. For explicit
 * configuration or offline/mocked runs, use {@link createRouter}.
 */
export const route: Router = Object.assign(
  (input: RouteInput): Promise<RouteResult> => getDefaultRouter()(input),
  {
    reportOutcome: (input: ReportOutcomeInput): Promise<OutcomeResponse> =>
      getDefaultRouter().reportOutcome(input),
  },
);
