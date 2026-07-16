#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ANTHROPIC_MODELS,
  type ContributionAcceptedResponse,
  type ContributionRequest,
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
  OPENAI_MODELS,
  type RouteResponse,
  SDK_VERSION,
  loadPluginConfig,
  mapRecommendation,
  resolveModelPrice,
  runHokusaiLoop,
  type HokusaiLoopClient,
  type ModelCapability,
  type ModelDefinition,
  type RedactionConfig,
  type RunHokusaiLoopResult,
} from '@hokusai/core';
import { createAiderHostAdapter, type AiderProcessRunner } from './aider-adapter.js';
import { buildAiderArgs, AiderBinaryNotFoundError } from './aider-runner.js';

export const CLI_EXIT_CODES = {
  success: 0,
  error: 1,
  usage: 2,
} as const;

type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];

interface WritableLike {
  write(chunk: string): unknown;
}

export interface RunAiderOptions {
  taskText: string;
  repoPath: string;
  model?: string | undefined;
  aiderPath?: string | undefined;
  aiderArgs?: string[] | undefined;
  dryRun?: boolean | undefined;
  maxCostUsd?: number | undefined;
  apiBaseUrl?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdout?: WritableLike | undefined;
  stderr?: WritableLike | undefined;
  clock?: (() => Date) | undefined;
  client?: HokusaiLoopClient | undefined;
  runProcess?: AiderProcessRunner | undefined;
}

export interface RunAiderResult {
  dryRun: boolean;
  exitCode: CliExitCode;
  resolvedModel: string;
  routeId: string;
  taskId: string;
  completionResult?: 'success' | 'failure' | undefined;
  actualCostUsd?: number | undefined;
  fidelityTier?: string | undefined;
}

export interface RunCliOptions {
  argv?: string[] | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  stdout?: WritableLike | undefined;
  stderr?: WritableLike | undefined;
  clock?: (() => Date) | undefined;
  client?: HokusaiLoopClient | undefined;
  runProcess?: AiderProcessRunner | undefined;
}

interface ParsedCliArgs {
  taskText: string;
  repoPath: string;
  model?: string | undefined;
  aiderPath?: string | undefined;
  aiderArgs: string[];
  dryRun: boolean;
  maxCostUsd?: number | undefined;
  apiBaseUrl?: string | undefined;
}

interface RoutePreviewResult {
  routeId: string;
  resolvedModel: string;
  allowedModels: string[];
  promptPreview: string;
  redactionCount: number;
}

const BUILT_IN_AIDER_MODELS = [...OPENAI_MODELS, ...ANTHROPIC_MODELS].filter(
  (model) =>
    model.available !== false && resolveModelPrice(model.id) !== undefined,
);
const BUILT_IN_AIDER_REGISTRY = new InMemoryModelRegistry(BUILT_IN_AIDER_MODELS);
const DEFAULT_REDACTION_SALT = 'hokusai-aider';

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function writeLine(stream: WritableLike, line: string): void {
  stream.write(`${line}\n`);
}

function usageMessage(): string {
  return [
    'Usage: hokusai-aider "task text" --repo <path> [options] [-- aider args...]',
    '',
    'Options:',
    '  --model <id>          Constrain routing and execution to a single model.',
    '  --repo <path>         Repository directory to run Aider in. Required.',
    '  --aider-path <path>   Alternate Aider binary or script path.',
    '  --max-cost-usd <n>    Max budget recorded on the contribution row.',
    '  --api-base-url <url>  Override HOKUSAI_API_BASE_URL for this run.',
    '  --dry-run             Route only; do not launch Aider or submit a row.',
  ].join('\n');
}

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`${flag} must be a finite, non-negative number.`);
  }
  return parsed;
}

function takeValue(
  argv: string[],
  index: number,
  arg: string,
  flag: string,
): { value: string; nextIndex: number } {
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1).trim();
    if (value.length === 0) {
      throw new UsageError(`${flag} requires a value.`);
    }
    return { value, nextIndex: index };
  }

  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value.`);
  }

  return { value, nextIndex: index + 1 };
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const taskParts: string[] = [];
  const aiderArgs: string[] = [];
  let repoPath: string | undefined;
  let model: string | undefined;
  let aiderPath: string | undefined;
  let maxCostUsd: number | undefined;
  let apiBaseUrl: string | undefined;
  let dryRun = false;
  let passThrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';

    if (passThrough) {
      aiderArgs.push(arg);
      continue;
    }

    if (arg === '--') {
      passThrough = true;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--model' || arg.startsWith('--model=')) {
      const next = takeValue(argv, index, arg, '--model');
      model = next.value;
      index = next.nextIndex;
      continue;
    }

    if (arg === '--repo' || arg.startsWith('--repo=')) {
      const next = takeValue(argv, index, arg, '--repo');
      repoPath = next.value;
      index = next.nextIndex;
      continue;
    }

    if (arg === '--aider-path' || arg.startsWith('--aider-path=')) {
      const next = takeValue(argv, index, arg, '--aider-path');
      aiderPath = next.value;
      index = next.nextIndex;
      continue;
    }

    if (arg === '--max-cost-usd' || arg.startsWith('--max-cost-usd=')) {
      const next = takeValue(argv, index, arg, '--max-cost-usd');
      maxCostUsd = parseNumber(next.value, '--max-cost-usd');
      index = next.nextIndex;
      continue;
    }

    if (arg === '--api-base-url' || arg.startsWith('--api-base-url=')) {
      const next = takeValue(argv, index, arg, '--api-base-url');
      apiBaseUrl = next.value;
      index = next.nextIndex;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option: ${arg}`);
    }

    taskParts.push(arg);
  }

  const taskText = taskParts.join(' ').trim();
  if (taskText.length === 0) {
    throw new UsageError('A task message is required.');
  }
  if (!repoPath) {
    throw new UsageError('--repo <path> is required.');
  }

  const normalizedModel = normalizeString(model);
  const normalizedAiderPath = normalizeString(aiderPath);
  const normalizedApiBaseUrl = normalizeString(apiBaseUrl);

  return {
    taskText,
    repoPath,
    ...(normalizedModel ? { model: normalizedModel } : {}),
    ...(normalizedAiderPath ? { aiderPath: normalizedAiderPath } : {}),
    aiderArgs,
    dryRun,
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    ...(normalizedApiBaseUrl ? { apiBaseUrl: normalizedApiBaseUrl } : {}),
  };
}

async function validateRepoPath(repoPath: string): Promise<string> {
  const resolvedPath = path.resolve(repoPath);
  const stats = await stat(resolvedPath).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new UsageError(
      `--repo must point to an existing directory. Received: ${repoPath}`,
    );
  }

  return resolvedPath;
}

function inferProvider(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  const prefix = normalized.split('/')[0];

  if (prefix && prefix !== normalized) {
    return prefix;
  }
  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4') ||
    normalized.startsWith('codex')
  ) {
    return 'openai';
  }
  if (normalized.startsWith('claude-')) {
    return 'anthropic';
  }
  if (normalized.startsWith('gemini-')) {
    return 'google';
  }
  if (normalized.startsWith('deepseek-')) {
    return 'deepseek';
  }
  if (normalized.startsWith('qwen-')) {
    return 'qwen';
  }

  return 'custom';
}

function inferFamily(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  const tail = normalized.split('/').at(-1) ?? normalized;
  const family = tail.split(/[-.]/)[0]?.trim();
  return family && family.length > 0 ? family : 'custom';
}

function inferCapabilities(modelId: string): ModelCapability[] {
  const normalized = modelId.trim().toLowerCase();
  const capabilities: ModelCapability[] = ['tool-use'];

  if (
    normalized.includes('gpt-5') ||
    normalized.includes('claude') ||
    normalized.includes('opus') ||
    normalized.includes('sonnet') ||
    normalized.includes('haiku') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4') ||
    normalized.includes('reason')
  ) {
    capabilities.unshift('reasoning');
  }

  return capabilities;
}

function createSyntheticModel(modelId: string): ModelDefinition {
  return {
    id: modelId.trim(),
    provider: inferProvider(modelId),
    family: inferFamily(modelId),
    capabilities: inferCapabilities(modelId),
    available: true,
  };
}

function resolveConfiguredEntries(
  requestedModel: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): string[] {
  if (requestedModel) {
    return [requestedModel];
  }

  const rawAllowlist = env?.HOKUSAI_MODEL_ALLOWLIST;
  if (rawAllowlist) {
    const parsed = rawAllowlist
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  return BUILT_IN_AIDER_MODELS.map((model) => model.id);
}

function buildRunnableModels(
  requestedModel: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): ModelDefinition[] {
  const models: ModelDefinition[] = [];
  const seen = new Set<string>();

  for (const entry of resolveConfiguredEntries(requestedModel, env)) {
    const resolved = BUILT_IN_AIDER_REGISTRY.resolve(entry);
    const model = resolved ?? createSyntheticModel(entry);
    const key = model.id.trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    models.push(model);
  }

  return models.length > 0 ? models : [...BUILT_IN_AIDER_MODELS];
}

function redactTaskForPreview(taskText: string): string {
  return `<redacted task text; ${taskText.length} chars>`;
}

function resolveRedactionConfig(env: NodeJS.ProcessEnv | undefined): RedactionConfig {
  const configuredSalt = env?.HOKUSAI_REDACTION_SALT?.trim();

  return {
    salt:
      configuredSalt && configuredSalt.length > 0
        ? configuredSalt
        : DEFAULT_REDACTION_SALT,
  };
}

function createClient(
  options: RunAiderOptions,
  apiKey: string,
  apiBaseUrl: string,
): HokusaiLoopClient {
  if (options.client) {
    return options.client;
  }

  const client = new HokusaiClient({
    apiKey,
    baseUrl: apiBaseUrl,
  });

  return {
    route(request) {
      return client.route(request) as Promise<RouteResponse>;
    },
    submitContribution(request: ContributionRequest) {
      return client.submitContribution(
        request,
      ) as Promise<ContributionAcceptedResponse>;
    },
  };
}

async function routeWithoutSubmission(input: {
  adapter: ReturnType<typeof createAiderHostAdapter>;
  client: HokusaiLoopClient;
  redactionConfig: RedactionConfig;
  clock: () => Date;
}): Promise<RoutePreviewResult> {
  const context = await input.adapter.collectTaskContext();
  const runnableModels = await input.adapter.discoverRunnableModels(context);
  const allowedModels = runnableModels.map((model) => model.id);
  const defaultModel = allowedModels[0];

  if (!defaultModel) {
    throw new Error('Aider wrapper must expose at least one runnable model.');
  }

  const registry = new InMemoryModelRegistry(runnableModels);
  const dispatchBuilder = new HokusaiDispatchBuilder({
    consent: {
      subjectId: 'aider',
      grantedScopes: ['task-execution'],
    },
    modelRegistry: registry,
    redactionConfig: input.redactionConfig,
    clock: input.clock,
  });

  const payload = await dispatchBuilder.prepareDispatch(context.task, defaultModel);
  const preview = await input.adapter.previewRedactedPayload(payload);
  const route = await input.client.route(payload);
  const recommended = route.recommendation?.model ?? defaultModel;
  const mapped = mapRecommendation(
    { model: recommended },
    { registry, requireAvailable: true },
  );

  return {
    routeId: route.routeId,
    resolvedModel: mapped.id,
    allowedModels,
    promptPreview: preview.promptPreview,
    redactionCount: preview.redactionCount,
  };
}

function formatPlannedArgs(
  resolvedModel: string,
  taskText: string,
  aiderArgs: string[],
): string[] {
  return buildAiderArgs({
    model: resolvedModel,
    task: redactTaskForPreview(taskText),
    extraArgs: aiderArgs,
  });
}

export async function runAider(
  options: RunAiderOptions,
): Promise<RunAiderResult> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const clock = options.clock ?? (() => new Date());
  const repoPath = await validateRepoPath(options.repoPath);
  const config = await loadPluginConfig({
    env,
    overrides: {
      ...(options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {}),
    },
  });

  if (!config.apiKey) {
    throw new UsageError(
      'HOKUSAI_API_KEY is required for routing and contribution submission.',
    );
  }

  const runnableModels = buildRunnableModels(options.model, env);
  const taskId = `aider-${clock().getTime()}`;
  const redactionConfig = resolveRedactionConfig(env);
  const adapter = createAiderHostAdapter({
    taskId,
    taskText: options.taskText,
    repoPath,
    runnableModels,
    ...(options.aiderPath ? { aiderPath: options.aiderPath } : {}),
    ...(options.aiderArgs ? { aiderArgs: options.aiderArgs } : {}),
    env,
    onStdout(chunk) {
      stdout.write(chunk);
    },
    onStderr(chunk) {
      stderr.write(chunk);
    },
    onStatus(line) {
      writeLine(stderr, `[hokusai-aider] ${line}`);
    },
    ...(options.runProcess ? { runProcess: options.runProcess } : {}),
  });
  const client = createClient(options, config.apiKey, config.apiBaseUrl);

  if (options.dryRun) {
    const preview = await routeWithoutSubmission({
      adapter,
      client,
      redactionConfig,
      clock,
    });
    const output = {
      dryRun: true,
      routeId: preview.routeId,
      resolvedModel: preview.resolvedModel,
      promptPreview: preview.promptPreview,
      redactionCount: preview.redactionCount,
      wouldRun: {
        binary: options.aiderPath?.trim() || 'aider',
        cwd: repoPath,
        args: formatPlannedArgs(
          preview.resolvedModel,
          options.taskText,
          options.aiderArgs ?? [],
        ),
      },
      plannedRow: {
        schemaVersion: 'harness_outcome_row/v1',
        harness: 'aider',
        task_id: taskId,
        selected_model: preview.resolvedModel,
        allowed_models: preview.allowedModels,
        ...(options.maxCostUsd !== undefined
          ? { budget_usd: options.maxCostUsd }
          : {}),
        actual_cost_usd: 'unavailable until Aider runs',
        wall_clock_seconds: 'unavailable until Aider runs',
      },
    };

    writeLine(stdout, JSON.stringify(output, null, 2));

    return {
      dryRun: true,
      exitCode: CLI_EXIT_CODES.success,
      resolvedModel: preview.resolvedModel,
      routeId: preview.routeId,
      taskId,
    };
  }

  const loop = await runHokusaiLoop({
    adapter,
    client,
    redactionConfig,
    idempotencyKey: `${taskId}:${clock().toISOString()}`,
    harnessName: 'aider',
    sdkVersion: SDK_VERSION,
    ...(options.maxCostUsd !== undefined
      ? { budgetUsd: options.maxCostUsd }
      : {}),
    log(line: string) {
      writeLine(stderr, `[hokusai-aider] ${line}`);
    },
    clock,
  });

  writeLine(stderr, `[hokusai-aider] Contribution accepted: ${String(loop.response.accepted)}`);
  writeLine(
    stderr,
    `[hokusai-aider] Fidelity tier: ${loop.fidelityTier ?? '(not reported by this API)'}`,
  );

  return toRunAiderResult(taskId, loop);
}

function toRunAiderResult(
  taskId: string,
  loop: RunHokusaiLoopResult,
): RunAiderResult {
  return {
    dryRun: false,
    exitCode:
      loop.row.completion_result === 'success'
        ? CLI_EXIT_CODES.success
        : CLI_EXIT_CODES.error,
    resolvedModel: loop.selectedModel,
    routeId: loop.routeId,
    taskId,
    completionResult: loop.row.completion_result,
    ...(loop.actualCostUsd !== undefined
      ? { actualCostUsd: loop.actualCostUsd }
      : {}),
    ...(loop.fidelityTier !== undefined
      ? { fidelityTier: loop.fidelityTier }
      : {}),
  };
}

function renderConfigError(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'fieldErrors' in error &&
    Array.isArray((error as { fieldErrors: unknown[] }).fieldErrors)
  ) {
    const details = (error as { fieldErrors: Array<{ message?: string }> }).fieldErrors
      .map((fieldError) => fieldError.message)
      .filter((message): message is string => Boolean(message));

    if (details.length > 0) {
      return details.join('\n');
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export async function runCli(options: RunCliOptions = {}): Promise<CliExitCode> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const parsed = parseCliArgs(options.argv ?? process.argv.slice(2));
    const result = await runAider({
      ...parsed,
      env: options.env,
      stdout,
      stderr,
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.client ? { client: options.client } : {}),
      ...(options.runProcess ? { runProcess: options.runProcess } : {}),
    });

    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      writeLine(stderr, error.message);
      writeLine(stderr, usageMessage());
      return CLI_EXIT_CODES.usage;
    }

    if (error instanceof AiderBinaryNotFoundError) {
      writeLine(stderr, error.message);
      return CLI_EXIT_CODES.error;
    }

    const message = renderConfigError(error);
    writeLine(stderr, message);
    return CLI_EXIT_CODES.error;
  }
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isEntrypoint) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export type { CliExitCode };
