import { rm } from 'node:fs/promises';
import {
  DEFAULT_REDACTION_CONFIG,
  FsLocalStore,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
  ModelMappingError,
  buildOutcomeReport,
  canReportOutcome,
  canRoute,
  isConsentGranted,
  mapRecommendation,
  resolveConsent,
  validateRouteRequest,
  type AdapterResult,
  type ConsentConfig,
  type ConsentSettings,
  type HarnessPayloadPreview,
  type HarnessRecommendation,
  type HokusaiClient,
  type HokusaiDispatchPayload,
  type OutcomeReport,
  type OutcomeReportInput,
  type OutcomeResponse,
  type RouteResponse,
  type ModelRegistry,
} from '@hokusai/core';
import {
  getClaudeCodeStateFilePath,
  resolveClaudeCodeConfigPath,
} from './config-path.js';
import {
  buildClaudeCodeTaskPacket,
  previewClaudeCodeTaskPacket,
  type ClaudeCodeBuilderOptions,
  type ClaudeCodeTaskInput,
} from './task-packet.js';

export interface RouteInput extends ClaudeCodeTaskInput {
  taskId?: string;
  modelId?: string;
  metadata?: Record<string, string>;
}

export interface RouteSuccess {
  recommendation: HarnessRecommendation;
  payload: HokusaiDispatchPayload;
  preview: HarnessPayloadPreview;
  route?: RouteResponse;
}

export type RouteResult = AdapterResult<RouteSuccess>;

export interface DoctorResult {
  configDir: string;
  configPresent: boolean;
  needsSetup: boolean;
  consent: {
    routingEnabled: boolean;
    outcomeReportingEnabled: boolean;
    grantedScopes: ConsentConfig['grantedScopes'];
  };
  connectivity: 'unchecked' | 'configured';
}

export interface PayloadPreviewResult {
  packet: ReturnType<typeof buildClaudeCodeTaskPacket>['packet'];
  preview: ReturnType<typeof previewClaudeCodeTaskPacket>;
  harnessPreview: HarnessPayloadPreview;
}

export interface ReportOutcomeInput extends OutcomeReportInput {
  taskId: string;
}

export interface ReportOutcomeResult {
  report: OutcomeReport;
  response?: OutcomeResponse;
  submitted: boolean;
}

export interface RecommendationDisplay {
  lines: string[];
  model: string;
  provider: string;
}

export interface ClaudeCodeCommandOptions {
  apiClient?: HokusaiClient;
  configPath?: string;
  consent?: ConsentConfig;
  redactionConfig?: ClaudeCodeBuilderOptions['redactionConfig'];
  registry?: ModelRegistry;
  settings?: Partial<ConsentSettings>;
  clock?: () => Date;
}

const DEFAULT_CONSENT: ConsentConfig = {
  subjectId: 'claude-code',
  grantedScopes: ['task-execution', 'telemetry', 'local-storage'],
};

function ok<T>(value: T): AdapterResult<T> {
  return {
    ok: true,
    value,
  };
}

function fail(
  code: string,
  message: string,
  details?: Record<string, string | string[]>,
): AdapterResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function resolveRegistry(registry?: ModelRegistry): ModelRegistry {
  return registry ?? new InMemoryModelRegistry([]);
}

function resolveCommandContext(options?: ClaudeCodeCommandOptions): {
  builderOptions: ClaudeCodeBuilderOptions;
  consent: ConsentConfig;
  configDir: string;
  registry: ModelRegistry;
  settings: ConsentSettings;
} {
  const consent = options?.consent ?? DEFAULT_CONSENT;
  const config = resolveClaudeCodeConfigPath(
    options?.configPath ? { override: options.configPath } : undefined,
  );
  const settings = resolveConsent({
    routingEnabled:
      options?.settings?.routingEnabled ??
      isConsentGranted(consent, 'task-execution'),
    outcomeReportingEnabled:
      options?.settings?.outcomeReportingEnabled ??
      isConsentGranted(consent, 'telemetry'),
  });

  return {
    builderOptions: {
      redactionConfig: options?.redactionConfig ?? DEFAULT_REDACTION_CONFIG,
      ...(options?.clock ? { clock: options.clock } : {}),
    },
    consent,
    configDir: config.dir,
    registry: resolveRegistry(options?.registry),
    settings,
  };
}

function toTaskId(input: RouteInput, clock?: () => Date): string {
  return input.taskId ?? `claude-code-${(clock ?? (() => new Date()))().getTime()}`;
}

function toPrompt(packet: ReturnType<typeof buildClaudeCodeTaskPacket>['packet']): string {
  return JSON.stringify(packet, null, 2);
}

function buildRecommendation(
  modelId: string,
  registry: ModelRegistry,
): HarnessRecommendation {
  const mapped = mapRecommendation(
    { model: modelId },
    {
      registry,
      allowedProviders: ['anthropic'],
      requireAvailable: true,
    },
  );

  return {
    model: {
      id: mapped.id,
      provider: mapped.provider,
      capabilities: mapped.capabilities,
    },
    reason: 'Claude Code routes through the shared Anthropic-backed SDK model registry.',
    alternatives: registry
      .listAvailable()
      .filter((candidate) => candidate.provider === 'anthropic')
      .filter((candidate) => candidate.id !== mapped.id)
      .map((candidate) => ({
        id: candidate.id,
        provider: candidate.provider,
        capabilities: candidate.capabilities,
      })),
  };
}

function buildPreview(payload: HokusaiDispatchPayload): HarnessPayloadPreview {
  return {
    summary: `Task ${payload.task.id} (model: ${payload.model.id})`,
    promptPreview: payload.prompt,
    redactionCount: payload.redactions.length,
  };
}

export async function routeTask(
  input: RouteInput,
  options?: ClaudeCodeCommandOptions,
): Promise<RouteResult> {
  if (typeof input.taskText !== 'string' || input.taskText.trim().length === 0) {
    return fail('INVALID_TASK', 'Expected "taskText" to be a non-empty string.');
  }

  const context = resolveCommandContext(options);
  if (!canRoute(context.settings)) {
    return fail('ROUTING_DISABLED', 'Routing is disabled by the current consent settings.');
  }

  const selectedModelId =
    input.modelId ?? context.registry.getDefault()?.id;
  if (!selectedModelId) {
    return fail('UNKNOWN_MODEL', 'No Claude Code model is configured for routing.');
  }

  let recommendation: HarnessRecommendation;
  try {
    recommendation = buildRecommendation(selectedModelId, context.registry);
  } catch (error) {
    if (error instanceof ModelMappingError) {
      return fail(error.code, error.message, {
        suggestions: error.suggestions,
      });
    }

    throw error;
  }

  const packetResult = buildClaudeCodeTaskPacket(input, context.builderOptions);
  const store = new FsLocalStore(context.configDir);
  const payload = await new HokusaiDispatchBuilder({
    consent: context.consent,
    modelRegistry: context.registry,
    storage: {
      async get(taskId) {
        const records = await store.listCorrelations();
        return records.find((record) => record.metadata?.taskId === taskId)
          ? {
              taskId,
              correlationId: records.find((record) => record.metadata?.taskId === taskId)?.correlationId ?? '',
              createdAt: new Date(
                records.find((record) => record.metadata?.taskId === taskId)?.createdAt ?? Date.now(),
              ).toISOString(),
            }
          : undefined;
      },
      async set(record) {
        await store.putCorrelation({
          correlationId: record.correlationId.replace(/[:.]/g, '_'),
          packetHash: record.taskId,
          createdAt: Date.parse(record.createdAt),
          metadata: {
            taskId: record.taskId,
          },
        });
      },
    },
    ...(options?.clock ? { clock: options.clock } : {}),
  }).prepareDispatch(
    {
      id: toTaskId(input, options?.clock),
      prompt: toPrompt(packetResult.packet),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    recommendation.model.id,
  );

  const validationErrors = validateRouteRequest(payload);
  if (validationErrors.length > 0) {
    return fail('ROUTE_VALIDATION_FAILED', 'Route payload validation failed.', {
      fieldErrors: validationErrors.map((fieldError) => `${fieldError.path}: ${fieldError.message}`),
    });
  }

  let route: RouteResponse | undefined;
  if (options?.apiClient) {
    route = (await options.apiClient.route(payload)) as RouteResponse;
  }

  return ok({
    recommendation,
    payload,
    preview: buildPreview(payload),
    ...(route ? { route } : {}),
  });
}

export function runDoctor(
  options?: ClaudeCodeCommandOptions,
): DoctorResult {
  const config = resolveClaudeCodeConfigPath(
    options?.configPath ? { override: options.configPath } : undefined,
  );
  const consent = options?.consent ?? DEFAULT_CONSENT;
  const settings = resolveConsent({
    routingEnabled:
      options?.settings?.routingEnabled ??
      isConsentGranted(consent, 'task-execution'),
    outcomeReportingEnabled:
      options?.settings?.outcomeReportingEnabled ??
      isConsentGranted(consent, 'telemetry'),
  });

  return {
    configDir: config.dir,
    configPresent: config.exists,
    needsSetup: !config.exists,
    consent: {
      routingEnabled: canRoute(settings),
      outcomeReportingEnabled: canReportOutcome(settings),
      grantedScopes: [...consent.grantedScopes],
    },
    connectivity: options?.apiClient ? 'configured' : 'unchecked',
  };
}

export function previewTaskPayload(
  input: RouteInput,
  options?: ClaudeCodeCommandOptions,
): PayloadPreviewResult {
  const context = resolveCommandContext(options);
  const packet = buildClaudeCodeTaskPacket(input, context.builderOptions).packet;
  const preview = previewClaudeCodeTaskPacket(input, context.builderOptions);
  const harnessPreview = buildPreview({
    task: {
      id: toTaskId(input, options?.clock),
      prompt: toPrompt(packet),
    },
    prompt: preview.willSend.userIntent,
    consent: {
      subjectId: context.consent.subjectId,
      grantedScopes: [...context.consent.grantedScopes],
    },
    model: {
      id: input.modelId ?? context.registry.getDefault()?.id ?? 'unconfigured-model',
      provider: 'anthropic',
      capabilities: [],
    },
    correlation: {
      taskId: toTaskId(input, options?.clock),
      correlationId: 'preview-only',
      createdAt: new Date(0).toISOString(),
    },
    redactions: preview.redactionSummary.map((entry) => ({
      label: entry.category,
      count: entry.count,
      category: entry.category,
      placeholder: `<redacted:${entry.category}>`,
    })),
    createdAt: new Date(0).toISOString(),
  });

  return {
    packet,
    preview,
    harnessPreview,
  };
}

export async function reportTaskOutcome(
  input: ReportOutcomeInput,
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<ReportOutcomeResult>> {
  const context = resolveCommandContext(options);
  if (!canReportOutcome(context.settings)) {
    return fail(
      'OUTCOME_REPORTING_DISABLED',
      'Outcome reporting is disabled by the current consent settings.',
    );
  }

  let report: OutcomeReport;
  const { taskId, ...reportInput } = input;
  void taskId;
  try {
    report = buildOutcomeReport(reportInput);
  } catch (error) {
    if (error instanceof Error && 'errors' in error) {
      const validationErrors = (error as { errors?: Array<{ path: string; message: string }> }).errors ?? [];
      return fail('OUTCOME_VALIDATION_FAILED', error.message, {
        fieldErrors: validationErrors.map(
          (validationError) => `${validationError.path}: ${validationError.message}`,
        ),
      });
    }

    throw error;
  }

  let response: OutcomeResponse | undefined;
  if (options?.apiClient) {
    response = (await options.apiClient.reportOutcome(report)) as OutcomeResponse;
  }

  return ok({
    report,
    ...(response ? { response } : {}),
    submitted: Boolean(response),
  });
}

export async function clearClaudeCodeLocalState(
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<{ ok: true }>> {
  const config = resolveClaudeCodeConfigPath(
    options?.configPath ? { override: options.configPath } : undefined,
  );
  const store = new FsLocalStore(config.dir);

  await store.clear();
  await rm(getClaudeCodeStateFilePath(config.dir), { force: true });
  await rm(config.dir, { recursive: true, force: true });

  return ok({ ok: true });
}

export function displayTaskRecommendation(
  recommendation: HarnessRecommendation,
): RecommendationDisplay {
  const lines = [
    `Recommended model: ${recommendation.model.id}`,
    `Provider: ${recommendation.model.provider}`,
    `Reason: ${recommendation.reason}`,
  ];

  if (recommendation.alternatives && recommendation.alternatives.length > 0) {
    lines.push(
      `Alternatives: ${recommendation.alternatives.map((model) => model.id).join(', ')}`,
    );
  }

  return {
    lines,
    model: recommendation.model.id,
    provider: recommendation.model.provider,
  };
}
