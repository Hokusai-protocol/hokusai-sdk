import {
  HokusaiClient,
  buildOutcomeContributionPrompt,
  createFsStore,
  executeRouteCommand,
  latestRouteCommand,
  previewOutcomeCommand,
  privacyStatusCommand,
  recordOnboardingFunnelSignal,
  submitOutcomeCommand,
  type FetchTransport,
  type HarnessCommandResult,
  type OutcomeContributionPrompt,
  type LatestRouteCommandValue,
  type PreviewOutcomeCommandValue,
  type PrivacyStatusCommandValue,
  type RouteCommandValue,
  type SubmitOutcomeCommandValue,
} from '@hokusai/core';
import {
  createCodexHarnessProfile,
  getApiBaseUrl,
  getApiKey,
  getRetentionDays,
  hasOutcomeOptIn,
  resolveCodexConfigDir,
} from './config.js';
import { createAllowlistedOpenAiRegistry } from './registry.js';

export interface CodexPluginCommandOptions {
  client?: HokusaiClient | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  clock?: (() => Date) | undefined;
  transport?: FetchTransport | undefined;
}

export interface CodexRouteInput {
  task: string;
  taskId?: string;
  currentModel?: string;
  metadata?: Record<string, string>;
  /**
   * Budget ceiling in USD for the routed work.
   *
   * The server scores the eventual outcome against this. A contribution row with
   * an actual cost but no budget cannot be scored, so it is filed as `partial` —
   * telemetry that trains nothing and earns nothing. Route with a budget and
   * report with `actualCostUsd` to be training-eligible.
   */
  maxCostUsd?: number;
}

export interface CodexOutcomeInput {
  correlationId?: string;
  recommendedModel?: string;
  actualModel: string;
  recommendationAccepted: boolean;
  completionStatus:
    | 'succeeded'
    | 'failed'
    | 'abandoned'
    | 'overridden'
    | 'partial';
  latencyBucket: 'low' | 'medium' | 'high';
  costBucket: 'low' | 'medium' | 'high';
  tokenBucket: 'low' | 'medium' | 'high';
  userRating?: number;
  notes?: string;
  approve?: boolean;
  /**
   * What the run actually cost, in USD. The server scores it against the route's
   * budget; without it the contribution is filed as telemetry and earns nothing.
   */
  actualCostUsd?: number;
  wallClockSeconds?: number;
}

/**
 * `buildRouteContextProjection` reads the budget from `max_cost_usd`, so that is
 * where it has to land for the contribution row to carry a `budget_usd`.
 */
function routeMetadata(
  input: CodexRouteInput,
): Record<string, string> | undefined {
  if (input.maxCostUsd === undefined) {
    return input.metadata;
  }

  return {
    ...input.metadata,
    max_cost_usd: String(input.maxCostUsd),
  };
}

export interface CodexOutcomePromptInput {
  event?: unknown;
  actualModel?: string;
}

function createClient(
  options: CodexPluginCommandOptions,
): HokusaiClient | undefined {
  if (options.client) {
    return options.client;
  }

  const apiKey = getApiKey(options.env);
  if (!apiKey) {
    return undefined;
  }

  const baseUrl = getApiBaseUrl(options.env);

  return new HokusaiClient({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(options.transport ? { transport: options.transport } : {}),
  });
}

function createTaskId(taskId: string | undefined, clock?: () => Date): string {
  if (taskId?.trim()) {
    return taskId.trim();
  }

  return `codex-${(clock ?? (() => new Date()))().toISOString()}`;
}

function createProfileForEnv(env?: NodeJS.ProcessEnv) {
  const allowlist = env?.HOKUSAI_MODEL_ALLOWLIST?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return createCodexHarnessProfile(
    allowlist && allowlist.length > 0
      ? { registry: createAllowlistedOpenAiRegistry(allowlist) }
      : undefined,
  );
}

async function recordCodexFunnelSignal(input: {
  client?: HokusaiClient | undefined;
  enabled: boolean;
  env?: NodeJS.ProcessEnv | undefined;
  clock?: (() => Date) | undefined;
  stage: Parameters<typeof recordOnboardingFunnelSignal>[0]['stage'];
}): Promise<void> {
  try {
    await recordOnboardingFunnelSignal({
      client: input.client,
      enabled: input.enabled,
      harness: 'codex',
      now: (input.clock ?? (() => new Date()))(),
      stage: input.stage,
      store: createFsStore(resolveCodexConfigDir(input.env)),
    });
  } catch {
    // Funnel telemetry must never change command behavior.
  }
}

export async function routeTaskWithCodex(
  input: CodexRouteInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<RouteCommandValue>> {
  const store = createFsStore(resolveCodexConfigDir(options.env));
  const profile = createProfileForEnv(options.env);
  const apiKey = getApiKey(options.env);
  const client = createClient(options);

  const result = await executeRouteCommand({
    ...(apiKey ? { apiKey } : {}),
    ...(client ? { client } : {}),
    consentGranted: true,
    ...(input.currentModel ? { currentModelId: input.currentModel } : {}),
    taskId: createTaskId(input.taskId, options.clock),
    taskText: input.task,
    ...(routeMetadata(input) ? { metadata: routeMetadata(input) } : {}),
    store,
    profile,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  if (result.ok) {
    await recordCodexFunnelSignal({
      client,
      enabled: hasOutcomeOptIn(options.env),
      env: options.env,
      clock: options.clock,
      stage: 'first_route',
    });
  }

  return result;
}

export async function previewRoutePayloadWithCodex(
  input: CodexRouteInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<RouteCommandValue>> {
  const store = createFsStore(resolveCodexConfigDir(options.env));
  const profile = createProfileForEnv(options.env);

  return executeRouteCommand({
    consentGranted: true,
    ...(input.currentModel ? { currentModelId: input.currentModel } : {}),
    taskId: createTaskId(input.taskId, options.clock),
    taskText: input.task,
    ...(routeMetadata(input) ? { metadata: routeMetadata(input) } : {}),
    store,
    profile,
    ...(options.clock ? { clock: options.clock } : {}),
    previewOnly: true,
  });
}

export async function previewOutcomeWithCodex(
  input: CodexOutcomeInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<PreviewOutcomeCommandValue>> {
  return previewOutcomeCommand({
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    currentModelId: input.actualModel,
    input: {
      actualModel: input.actualModel,
      recommendationAccepted: input.recommendationAccepted,
      completionStatus: input.completionStatus,
      latencyBucket: input.latencyBucket,
      costBucket: input.costBucket,
      tokenBucket: input.tokenBucket,
      ...(input.userRating === undefined
        ? {}
        : { userRating: input.userRating }),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.recommendedModel
        ? { recommendedModel: input.recommendedModel }
        : {}),
    },
    profile: createProfileForEnv(options.env),
    store: createFsStore(resolveCodexConfigDir(options.env)),
  });
}

export async function submitOutcomeWithCodex(
  input: CodexOutcomeInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<SubmitOutcomeCommandValue>> {
  const apiKey = getApiKey(options.env);
  const client = createClient(options);
  const result = await submitOutcomeCommand({
    ...(apiKey ? { apiKey } : {}),
    ...(client ? { client } : {}),
    outcomeOptIn: hasOutcomeOptIn(options.env),
    ...(input.approve === undefined ? {} : { approve: input.approve }),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.actualCostUsd === undefined
      ? {}
      : { actualCostUsd: input.actualCostUsd }),
    ...(input.wallClockSeconds === undefined
      ? {}
      : { wallClockSeconds: input.wallClockSeconds }),
    currentModelId: input.actualModel,
    input: {
      actualModel: input.actualModel,
      recommendationAccepted: input.recommendationAccepted,
      completionStatus: input.completionStatus,
      latencyBucket: input.latencyBucket,
      costBucket: input.costBucket,
      tokenBucket: input.tokenBucket,
      ...(input.userRating === undefined
        ? {}
        : { userRating: input.userRating }),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.recommendedModel
        ? { recommendedModel: input.recommendedModel }
        : {}),
    },
    profile: createProfileForEnv(options.env),
    store: createFsStore(resolveCodexConfigDir(options.env)),
    ...(options.clock ? { clock: options.clock } : {}),
  });
  if (result.ok && result.value.submitted) {
    await recordCodexFunnelSignal({
      client,
      enabled: hasOutcomeOptIn(options.env),
      env: options.env,
      clock: options.clock,
      stage: 'first_contribution',
    });
  }

  return result;
}

export async function latestRouteWithCodex(
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<LatestRouteCommandValue>> {
  return latestRouteCommand(createFsStore(resolveCodexConfigDir(options.env)));
}

export async function promptOutcomeContributionWithCodex(
  input: CodexOutcomePromptInput = {},
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<OutcomeContributionPrompt>> {
  const latest = await latestRouteWithCodex(options);
  const latestRoute = latest.ok
    ? {
        correlationId: latest.value.correlationId,
        taskId: latest.value.taskId,
        createdAt: latest.value.createdAt,
        ...(latest.value.recommendedModel
          ? { recommendedModelId: latest.value.recommendedModel }
          : {}),
      }
    : undefined;
  const actualModel = input.actualModel ?? options.env?.HOKUSAI_ACTUAL_MODEL;

  return {
    ok: true,
    value: buildOutcomeContributionPrompt({
      event: input.event,
      ...(latestRoute ? { latestRoute } : {}),
      outcomeOptIn: hasOutcomeOptIn(options.env),
      reportCommand: '$hokusai-report',
      ...(actualModel ? { actualModel } : {}),
    }),
  };
}

export async function privacyStatusWithCodex(
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<PrivacyStatusCommandValue>> {
  const result = await privacyStatusCommand({
    ...(getApiKey(options.env) ? { apiKey: getApiKey(options.env) } : {}),
    outcomeOptInGranted: hasOutcomeOptIn(options.env),
    store: createFsStore(resolveCodexConfigDir(options.env)),
    storageDir: resolveCodexConfigDir(options.env),
    retentionDays: getRetentionDays(options.env),
  });
  if (result.ok && result.value.doctor.status === 'ok') {
    await recordCodexFunnelSignal({
      client: createClient(options),
      enabled: hasOutcomeOptIn(options.env),
      env: options.env,
      clock: options.clock,
      stage: 'doctor_pass',
    });
  }

  return result;
}
