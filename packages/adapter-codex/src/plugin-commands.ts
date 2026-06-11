import {
  HokusaiClient,
  createFsStore,
  executeRouteCommand,
  latestRouteCommand,
  previewOutcomeCommand,
  privacyStatusCommand,
  submitOutcomeCommand,
  type FetchTransport,
  type HarnessCommandResult,
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
  hasRoutingConsent,
  resolveCodexConfigDir,
} from './config.js';

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
}

export interface CodexOutcomeInput {
  correlationId?: string;
  recommendedModel?: string;
  actualModel: string;
  recommendationAccepted: boolean;
  completionStatus: 'succeeded' | 'failed' | 'abandoned' | 'overridden' | 'partial';
  latencyBucket: 'low' | 'medium' | 'high';
  costBucket: 'low' | 'medium' | 'high';
  tokenBucket: 'low' | 'medium' | 'high';
  userRating?: number;
  notes?: string;
  approve?: boolean;
}

function createClient(options: CodexPluginCommandOptions): HokusaiClient | undefined {
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

export async function routeTaskWithCodex(
  input: CodexRouteInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<RouteCommandValue>> {
  const store = createFsStore(resolveCodexConfigDir(options.env));
  const profile = createCodexHarnessProfile();
  const apiKey = getApiKey(options.env);
  const client = createClient(options);

  return executeRouteCommand({
    ...(apiKey ? { apiKey } : {}),
    ...(client ? { client } : {}),
    consentGranted: hasRoutingConsent(options.env),
    ...(input.currentModel ? { currentModelId: input.currentModel } : {}),
    taskId: createTaskId(input.taskId, options.clock),
    taskText: input.task,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    store,
    profile,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

export async function previewRoutePayloadWithCodex(
  input: CodexRouteInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<RouteCommandValue>> {
  const store = createFsStore(resolveCodexConfigDir(options.env));
  const profile = createCodexHarnessProfile();

  return executeRouteCommand({
    consentGranted: true,
    ...(input.currentModel ? { currentModelId: input.currentModel } : {}),
    taskId: createTaskId(input.taskId, options.clock),
    taskText: input.task,
    ...(input.metadata ? { metadata: input.metadata } : {}),
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
      ...(input.userRating === undefined ? {} : { userRating: input.userRating }),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.recommendedModel ? { recommendedModel: input.recommendedModel } : {}),
    },
    profile: createCodexHarnessProfile(),
    store: createFsStore(resolveCodexConfigDir(options.env)),
  });
}

export async function submitOutcomeWithCodex(
  input: CodexOutcomeInput,
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<SubmitOutcomeCommandValue>> {
  const apiKey = getApiKey(options.env);
  const client = createClient(options);
  return submitOutcomeCommand({
    ...(apiKey ? { apiKey } : {}),
    ...(client ? { client } : {}),
    outcomeOptIn: hasOutcomeOptIn(options.env),
    ...(input.approve === undefined ? {} : { approve: input.approve }),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    currentModelId: input.actualModel,
    input: {
      actualModel: input.actualModel,
      recommendationAccepted: input.recommendationAccepted,
      completionStatus: input.completionStatus,
      latencyBucket: input.latencyBucket,
      costBucket: input.costBucket,
      tokenBucket: input.tokenBucket,
      ...(input.userRating === undefined ? {} : { userRating: input.userRating }),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.recommendedModel ? { recommendedModel: input.recommendedModel } : {}),
    },
    profile: createCodexHarnessProfile(),
    store: createFsStore(resolveCodexConfigDir(options.env)),
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

export async function latestRouteWithCodex(
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<LatestRouteCommandValue>> {
  return latestRouteCommand(createFsStore(resolveCodexConfigDir(options.env)));
}

export async function privacyStatusWithCodex(
  options: CodexPluginCommandOptions = {},
): Promise<HarnessCommandResult<PrivacyStatusCommandValue>> {
  return privacyStatusCommand({
    ...(getApiKey(options.env) ? { apiKey: getApiKey(options.env) } : {}),
    routingConsentGranted: hasRoutingConsent(options.env),
    outcomeOptInGranted: hasOutcomeOptIn(options.env),
    store: createFsStore(resolveCodexConfigDir(options.env)),
    storageDir: resolveCodexConfigDir(options.env),
    retentionDays: getRetentionDays(options.env),
  });
}
