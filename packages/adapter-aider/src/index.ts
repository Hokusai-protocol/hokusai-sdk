import { randomUUID } from 'node:crypto';
import {
  DEFAULT_REDACTION_CONFIG,
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
  ModelMappingError,
  SDK_VERSION,
  buildHarnessOutcomeRow,
  deriveTaskDescriptor,
  mapRecommendation,
  resolveActualCostUsd,
  validateContributionRow,
  type ContributionAcceptedResponse,
  type ContributionRequest,
  type HarnessOutcomeRowV1,
  type ModelDefinition,
  type RouteRequest,
  type RouteResponse,
} from '@hokusai/core';
import {
  summarizeAiderOutput,
  type AiderAccountingSummary,
} from './accounting.js';
import { runAider, type AiderRunOptions, type AiderRunResult } from './aider-runner.js';
import {
  DEFAULT_AIDER_MODEL_ID,
  DEFAULT_AIDER_MODEL_POOL,
  buildAiderCandidatePool,
  normalizeExtraModelId,
} from './models.js';

export {
  DEFAULT_AIDER_MODEL_ID,
  DEFAULT_AIDER_MODEL_POOL,
  buildAiderCandidatePool,
  normalizeExtraModelId,
  runAider,
  summarizeAiderOutput,
};
export type { AiderAccountingSummary, AiderRunOptions, AiderRunResult };

export const AIDER_HARNESS_NAME = 'aider';

/**
 * Minimum surface the Aider wrapper needs from a Hokusai client. Structurally
 * compatible with `HokusaiClient` — `route()` may return a dry-run
 * validation-success envelope, so the wrapper narrows to `RouteResponse` before
 * touching it. Tests inject a fake that returns `RouteResponse` directly.
 */
export interface AiderLoopClient {
  route(request: RouteRequest): Promise<unknown>;
  submitContribution(request: ContributionRequest): Promise<unknown>;
}

function narrowRouteResponse(value: unknown): RouteResponse {
  if (
    value &&
    typeof value === 'object' &&
    'routeId' in value &&
    typeof (value as Record<string, unknown>).routeId === 'string'
  ) {
    return value as RouteResponse;
  }
  throw new Error(
    'Hokusai client did not return a real RouteResponse. Dry-run mode is not supported by runAiderLoop.',
  );
}

function narrowContributionResponse(
  value: unknown,
): ContributionAcceptedResponse {
  if (value && typeof value === 'object' && 'accepted' in value) {
    return value as ContributionAcceptedResponse;
  }
  throw new Error(
    'Hokusai client returned an unexpected contribution response shape.',
  );
}

export interface RunAiderLoopOptions {
  /** Task text handed to Aider via `--message`. */
  taskText: string;
  /** Hokusai client to route and submit through. */
  client: AiderLoopClient;
  /** Full model catalog offered to the router. Falls back to the built-in pool. */
  modelPool?: ModelDefinition[];
  /** Extra model ids to append to the built-in pool when no pool is supplied. */
  extraModelIds?: string[];
  /** Budget in USD, becomes `budget_usd` on the row when supplied. */
  budgetUsd?: number;
  /** Optional preferred fallback model. Must belong to the pool. */
  preferredModel?: string;
  /** Task id used both for correlation and the contribution row. */
  taskId?: string;
  /** Idempotency key for the contribution submission. */
  idempotencyKey?: string;
  /** Consent subject id. Defaults to `hokusai-aider`. */
  consentSubjectId?: string;
  /** Aider binary and cwd. */
  aiderBin?: string;
  cwd?: string;
  /** Extra argv passed through to Aider after the wrapper defaults. */
  extraAiderArgs?: string[];
  /** Environment forwarded to Aider. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Whether Aider stdout/stderr should also stream to the parent. Defaults to true. */
  streamToParent?: boolean;
  /** Progress log for the human running the wrapper. Defaults to no-op. */
  log?: (line: string) => void;
  /** Injectable runner for tests. */
  runner?: (options: AiderRunOptions) => Promise<AiderRunResult>;
  /** Injectable ISO clock for the observed_at field. */
  clock?: () => Date;
}

export interface RunAiderLoopResult {
  routeId: string;
  allowedModels: string[];
  selectedModel: string;
  aider: AiderRunResult;
  accounting: AiderAccountingSummary;
  actualCostUsd: number | undefined;
  costOmittedReason?: string;
  row: HarnessOutcomeRowV1;
  response: ContributionAcceptedResponse;
  fidelityTier?: string;
}

function noop(): void {
  /* silent */
}

function firstDefaultOrHead(pool: ModelDefinition[]): ModelDefinition {
  const first = pool.find((model) => model.default) ?? pool[0];
  if (!first) {
    throw new Error('Aider candidate pool must contain at least one model.');
  }
  return first;
}

function selectDispatchModel(
  pool: ModelDefinition[],
  preferred: string | undefined,
): ModelDefinition {
  if (preferred) {
    const match = pool.find(
      (model) =>
        model.id === preferred ||
        (model.aliases ?? []).includes(preferred),
    );
    if (match) {
      return match;
    }
  }
  const defaultMatch = pool.find((model) => model.id === DEFAULT_AIDER_MODEL_ID);
  return defaultMatch ?? firstDefaultOrHead(pool);
}

/**
 * Run the full Aider proof-point loop:
 *   1. build a candidate pool
 *   2. prepare a redacted dispatch payload via `HokusaiDispatchBuilder`
 *   3. route through the Hokusai client
 *   4. map the recommendation strictly (no silent substitution)
 *   5. spawn Aider with the mapped model
 *   6. parse token/cost lines and derive `actual_cost_usd` when eligible
 *   7. submit exactly one `harness_outcome_row/v1`
 */
export async function runAiderLoop(
  options: RunAiderLoopOptions,
): Promise<RunAiderLoopResult> {
  const log = options.log ?? noop;
  const clock = options.clock ?? (() => new Date());
  const runner = options.runner ?? runAider;

  const taskText = options.taskText.trim();
  if (!taskText) {
    throw new Error('taskText must be a non-empty string.');
  }

  const pool =
    options.modelPool ??
    buildAiderCandidatePool(options.extraModelIds ?? []);
  if (pool.length === 0) {
    throw new Error('Aider candidate pool must contain at least one model.');
  }
  const allowedModels = pool.map((model) => model.id);
  log(`[1/6] candidate pool: ${allowedModels.length} models`);

  const registry = new InMemoryModelRegistry(pool);
  const dispatchModel = selectDispatchModel(pool, options.preferredModel);
  const taskId = options.taskId ?? `aider-${randomUUID()}`;

  const dispatchBuilder = new HokusaiDispatchBuilder({
    consent: {
      subjectId: options.consentSubjectId ?? AIDER_HARNESS_NAME,
      grantedScopes: ['task-execution'],
    },
    modelRegistry: registry,
    redactionConfig: DEFAULT_REDACTION_CONFIG,
    clock,
  });

  log('[2/6] preparing redacted dispatch payload');
  const dispatchPayload = await dispatchBuilder.prepareDispatch(
    { id: taskId, prompt: taskText },
    dispatchModel.id,
  );

  log('[3/6] routing');
  const routeRaw = await options.client.route(dispatchPayload);
  const route = narrowRouteResponse(routeRaw);
  const routeId = route.routeId;
  log(`        route_id: ${routeId}`);

  const recommended =
    route.recommendation?.model.trim() ?? dispatchModel.id;
  let mapped: ModelDefinition;
  try {
    mapped = mapRecommendation(
      { model: recommended },
      { registry, requireAvailable: false },
    );
  } catch (error) {
    if (error instanceof ModelMappingError) {
      throw new Error(
        `Router recommended model "${recommended}" is not in the candidate pool. ` +
          `Extend the pool with --available-model or omit the recommendation.`,
      );
    }
    throw error;
  }
  log(`[4/6] selected model: ${mapped.id}`);

  log('[5/6] launching aider');
  const aider = await runner({
    ...(options.aiderBin ? { bin: options.aiderBin } : {}),
    model: mapped.id,
    message: taskText,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.extraAiderArgs ? { extraArgs: options.extraAiderArgs } : {}),
    ...(options.streamToParent !== undefined
      ? { streamToParent: options.streamToParent }
      : {}),
  });

  if (aider.missing) {
    throw new Error(
      `Could not find the "aider" executable at "${aider.bin}". ` +
        `Install Aider (https://aider.chat) and ensure it is on PATH.`,
    );
  }
  if (aider.notExecutable) {
    throw new Error(
      `The "aider" binary at "${aider.bin}" is not executable. ` +
        `Check its file permissions.`,
    );
  }

  const accounting = summarizeAiderOutput(
    `${aider.stdout}\n${aider.stderr}`,
  );
  const completionResult: 'success' | 'failure' =
    aider.exitCode === 0 ? 'success' : 'failure';
  const observedAt = clock().toISOString();

  const cost = resolveEligibleCost({
    modelId: mapped.id,
    accounting,
    completionResult,
  });
  if (cost.reason) {
    log(`        actual_cost_usd: (omitted — ${cost.reason})`);
  } else {
    log(`        actual_cost_usd: $${cost.value?.toFixed(6) ?? '?'}`);
  }

  log('[6/6] submitting contribution row');
  const derived = deriveTaskDescriptor({ taskText });
  const descriptor =
    Object.keys(derived).length > 0 ? derived : { task_type: 'unknown' };

  const row = buildHarnessOutcomeRow({
    inferenceLogId: routeId,
    taskDescriptor: descriptor,
    allowedModels,
    selectedModels: { coder: mapped.id, reviewer: mapped.id },
    completionResult,
    ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
    ...(cost.value !== undefined ? { actualCostUsd: cost.value } : {}),
    wallClockSeconds: aider.wallClockSeconds,
    harness: AIDER_HARNESS_NAME,
    sdkVersion: SDK_VERSION,
    taskId,
    observedAt,
  });
  // Defensive: buildHarnessOutcomeRow already validated, but this guards against
  // any future accidental field addition upstream.
  validateContributionRow(row);

  const idempotencyKey =
    options.idempotencyKey?.trim() && options.idempotencyKey.trim().length > 0
      ? options.idempotencyKey.trim()
      : `${taskId}:${routeId}`;

  const submissionRaw = await options.client.submitContribution({
    rows: [row],
    metadata: { idempotency_key: idempotencyKey },
  });
  const response = narrowContributionResponse(submissionRaw);
  const fidelityTier = response.rowFidelityTiers?.[0];
  log(`        fidelity tier: ${fidelityTier ?? '(not reported)'}`);

  const result: RunAiderLoopResult = {
    routeId,
    allowedModels,
    selectedModel: mapped.id,
    aider,
    accounting,
    actualCostUsd: cost.value,
    row,
    response,
    ...(cost.reason ? { costOmittedReason: cost.reason } : {}),
    ...(fidelityTier ? { fidelityTier } : {}),
  };
  return result;
}

function resolveEligibleCost(input: {
  modelId: string;
  accounting: AiderAccountingSummary;
  completionResult: 'success' | 'failure';
}): { value: number | undefined; reason?: string } {
  if (input.completionResult === 'failure') {
    return { value: undefined, reason: 'aider run failed' };
  }
  const explicit = input.accounting.sessionCostUsd;
  const inputTokens = input.accounting.inputTokens;
  const outputTokens = input.accounting.outputTokens;
  const resolved = resolveActualCostUsd({
    model: input.modelId,
    ...(explicit !== undefined ? { explicitActualCostUsd: explicit } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  });
  if (resolved === undefined) {
    if (explicit === undefined && inputTokens === undefined) {
      return { value: undefined, reason: 'no cost or token data parsed' };
    }
    return { value: undefined, reason: 'model is not priced' };
  }
  return { value: resolved };
}

export interface CreateAiderClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Convenience factory: build a `HokusaiClient` for the wrapper. Env vars take
 * precedence over `options` so `HOKUSAI_API_KEY` and `HOKUSAI_API_BASE_URL`
 * work in one-shot invocations without any config plumbing.
 */
export function createAiderHokusaiClient(
  options: CreateAiderClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): HokusaiClient {
  const apiKey = env.HOKUSAI_API_KEY ?? options.apiKey;
  const baseUrl = env.HOKUSAI_API_BASE_URL ?? options.baseUrl;
  return new HokusaiClient({
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
}
