import { rm } from 'node:fs/promises';
import {
  DEFAULT_REDACTION_CONFIG,
  FilePluginConfigStore,
  FsLocalStore,
  HokusaiNetworkError,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
  ModelMappingError,
  buildHandoffInstructions,
  buildOutcomeReport,
  canReportOutcome,
  canRoute,
  defaultPluginConfigPath,
  hashPayload,
  isConsentGranted,
  loadPluginConfig,
  mapRecommendation,
  preview,
  redact,
  resolveConsent,
  validateRouteRequest,
  type AdapterResult,
  type ConsentConfig,
  type ConsentSettings,
  type HarnessPayloadPreview,
  type HarnessRecommendation,
  type HokusaiClient,
  type HokusaiDispatchPayload,
  type HandoffInstructions,
  type OutcomeReport,
  type OutcomeReportInput,
  type OutcomeResponse,
  type PayloadHashRecord,
  type RetentionPolicy,
  type RouteResponse,
  type SubmissionAuditEntry,
  type ModelRegistry,
  type ModelSelection,
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
  correlationId: string;
  routingDecisionId: string;
  handoff: HandoffInstructions;
  route?: RouteResponse;
}

export type RouteResult = AdapterResult<RouteSuccess>;

export interface DeclineRecommendationInput {
  correlationId: string;
  reason?: string;
}

export interface DeclineRecommendationResult {
  correlationId: string;
  status: 'declined';
}

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

export interface LatestRoutingDecision {
  correlationId: string;
  taskId: string;
  createdAt: string;
}

export interface ReportOutcomeResult {
  report: OutcomeReport;
  response?: OutcomeResponse;
  submitted: boolean;
}

export interface OutcomeReportPreview {
  lines: string[];
  payload: OutcomeReport;
}

export interface PreviewReportOutcomeResult {
  report: OutcomeReport;
  preview: OutcomeReportPreview;
}

export interface RoutingDecisionSummary {
  correlationId: string;
  taskId: string;
  createdAt: string;
  recommendedModelId?: string;
  alternatives: string[];
  reasonPreview?: string;
  status?: string;
  reasonHash?: string;
  payloadHash?: PayloadHashRecord;
}

export interface DecisionPreview extends RoutingDecisionSummary {
  decisionAt?: string;
  declinedAt?: string;
  debugRedactedPayloadPreview?: string;
}

export interface ClearResult {
  scope: 'all' | 'records' | 'audit';
  correlationsCleared: number;
  payloadHashesCleared: number;
  auditEntriesCleared: number;
  configCleared: boolean;
}

export interface ReportingStatusResult {
  enabled: boolean;
  source: 'env' | 'stored' | 'default';
}

export interface PrivacyResultWarnings {
  warnings?: string[];
}

export interface RecommendationDisplay {
  lines: string[];
  model: string;
  provider: string;
}

const ROUTING_REASON_LIMIT = 120;
const DEBUG_PREVIEW_LIMIT = 1000;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_RETENTION_MAX_RECORDS = 200;

function toStoredCorrelationId(correlationId: string): string {
  return correlationId.replace(/[:.]/g, '_');
}

function truncateForStorage(value: string, maxLength = ROUTING_REASON_LIMIT): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function redactForStorage(
  input: string,
  config: ClaudeCodeBuilderOptions['redactionConfig'],
): string {
  return truncateForStorage(redact(input, config).output);
}

function buildDebugPreview(
  input: string,
  config: ClaudeCodeBuilderOptions['redactionConfig'],
): string {
  return preview(input, config).willSend.slice(0, DEBUG_PREVIEW_LIMIT);
}

function toAuditId(correlationId: string, suffix: string): string {
  return `${toStoredCorrelationId(correlationId)}-${suffix}`;
}

function parseAlternativeIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function toWarningMessage(rawValue: string): string {
  return `Ignoring invalid HOKUSAI_RETENTION_DAYS value: ${rawValue}. Using default 7 day retention.`;
}

function resolveRetentionPolicyWithWarnings(
  env: NodeJS.ProcessEnv = process.env,
): { policy: RetentionPolicy; warnings: string[] } {
  const rawValue = env.HOKUSAI_RETENTION_DAYS;
  const defaults: RetentionPolicy = {
    maxAgeMs: DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    maxRecords: DEFAULT_RETENTION_MAX_RECORDS,
  };

  if (rawValue === undefined) {
    return { policy: defaults, warnings: [] };
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      policy: defaults,
      warnings: [toWarningMessage(rawValue)],
    };
  }

  return {
    policy: {
      maxAgeMs: parsed * 24 * 60 * 60 * 1000,
      maxRecords: DEFAULT_RETENTION_MAX_RECORDS,
    },
    warnings: [],
  };
}

export function resolveRetentionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RetentionPolicy {
  return resolveRetentionPolicyWithWarnings(env).policy;
}

async function pruneStoreForPrivacy(
  store: FsLocalStore,
  env?: NodeJS.ProcessEnv,
  clock?: () => Date,
): Promise<PrivacyResultWarnings> {
  const { policy, warnings } = resolveRetentionPolicyWithWarnings(env);
  if (warnings.length > 0) {
    process.stderr.write(`${warnings.join('\n')}\n`);
  }

  await store.pruneExpired((clock ?? (() => new Date()))().getTime(), policy);
  return warnings.length === 0 ? {} : { warnings };
}

function maybeWarnings(warnings: string[]): PrivacyResultWarnings {
  return warnings.length === 0 ? {} : { warnings };
}

function findPayloadHashRecord(
  payloadHashes: PayloadHashRecord[],
  hash: string | undefined,
): PayloadHashRecord | undefined {
  if (!hash) {
    return undefined;
  }

  return payloadHashes.find((record) => record.hash === hash);
}

function toRoutingDecisionSummary(
  record: NonNullable<Awaited<ReturnType<FsLocalStore['getCorrelation']>>>,
  payloadHashes: PayloadHashRecord[],
): RoutingDecisionSummary {
  const payloadHashRecord = findPayloadHashRecord(
    payloadHashes,
    record.metadata?.payloadHash,
  );

  return {
    correlationId: record.metadata?.originalCorrelationId ?? record.correlationId,
    taskId: record.metadata?.taskId ?? record.packetHash,
    createdAt: new Date(record.createdAt).toISOString(),
    ...(record.metadata?.recommendedModelId
      ? { recommendedModelId: record.metadata.recommendedModelId }
      : {}),
    alternatives: parseAlternativeIds(record.metadata?.recommendedAlternativeIds),
    ...(record.metadata?.reasonPreview
      ? { reasonPreview: record.metadata.reasonPreview }
      : {}),
    ...(record.metadata?.status ? { status: record.metadata.status } : {}),
    ...(record.metadata?.reasonHash ? { reasonHash: record.metadata.reasonHash } : {}),
    ...(payloadHashRecord ? { payloadHash: payloadHashRecord } : {}),
  };
}

async function findStoredCorrelationRecord(
  store: FsLocalStore,
  correlationId: string,
): Promise<{
  storedCorrelationId: string;
  record: Awaited<ReturnType<FsLocalStore['getCorrelation']>>;
}> {
  const storedCorrelationId = toStoredCorrelationId(correlationId);
  const direct = await store.getCorrelation(storedCorrelationId);
  if (direct) {
    return {
      storedCorrelationId,
      record: direct,
    };
  }

  const records = await store.listCorrelations();
  const byOriginal = records.find(
    (entry) => entry.metadata?.originalCorrelationId === correlationId,
  );

  return {
    storedCorrelationId: byOriginal?.correlationId ?? storedCorrelationId,
    record: byOriginal,
  };
}

export interface ClaudeCodeCommandOptions {
  apiClient?: HokusaiClient;
  configPath?: string;
  consent?: ConsentConfig;
  env?: NodeJS.ProcessEnv;
  redactionConfig?: ClaudeCodeBuilderOptions['redactionConfig'];
  registry?: ModelRegistry;
  settings?: Partial<ConsentSettings>;
  clock?: () => Date;
  dryRun?: boolean;
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
        model: {
          id: candidate.id,
          provider: candidate.provider,
          capabilities: candidate.capabilities,
        },
      })),
  };
}

function toSelection(model: ModelSelection): ModelSelection {
  return {
    id: model.id,
    provider: model.provider,
    capabilities: model.capabilities,
  };
}

function buildRecommendationFromRoute(
  route: RouteResponse,
  registry: ModelRegistry,
): HarnessRecommendation | undefined {
  if (!route.recommendation) {
    return undefined;
  }

  const mapped = mapRecommendation(route.recommendation, {
    registry,
    allowedProviders: ['anthropic'],
    requireAvailable: true,
  });

  return {
    model: toSelection(mapped),
    reason:
      route.recommendation.reason ??
      'Recommended by the Hokusai router for this Claude Code task.',
    ...(route.recommendation.confidence === undefined
      ? {}
      : { confidence: route.recommendation.confidence }),
    ...(route.recommendation.alternatives?.length
      ? {
          alternatives: route.recommendation.alternatives.map((alternative) => ({
            model: toSelection(
              mapRecommendation(alternative, {
                registry,
                allowedProviders: ['anthropic'],
                requireAvailable: true,
              }),
            ),
            ...(alternative.reason === undefined
              ? {}
              : { reason: alternative.reason }),
            ...(alternative.confidence === undefined
              ? {}
              : { confidence: alternative.confidence }),
          })),
        }
      : {}),
  };
}

function buildPreview(payload: HokusaiDispatchPayload): HarnessPayloadPreview {
  return {
    summary: `Task ${payload.task.id} (model: ${payload.model.id})`,
    promptPreview: payload.prompt,
    redactionCount: payload.redactions.length,
  };
}

function summarizeCount(
  label: string,
  value: { status: string; failures?: number } | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const suffix =
    value.failures === undefined ? '' : ` (${value.failures} failures)`;
  return `${label}: ${value.status}${suffix}`;
}

function buildOutcomePreviewLines(report: OutcomeReport): string[] {
  const lines = [
    'Outcome report preview:',
    `Schema version: ${report.schemaVersion}`,
    `Correlation id: ${report.correlationId}`,
    `Recommended model: ${report.recommendedModel}`,
    `Actual model: ${report.actualModel}`,
    `Recommendation accepted: ${report.recommendationAccepted ? 'yes' : 'no'}`,
    `Completion status: ${report.completionStatus}`,
    `Latency bucket: ${report.latencyBucket}`,
    `Cost bucket: ${report.costBucket}`,
    `Token bucket: ${report.tokenBucket}`,
  ];

  if (report.userRating !== undefined) {
    lines.push(`User rating: ${report.userRating}/5`);
  }

  const buildSummary = summarizeCount('Build summary', report.build);
  if (buildSummary) {
    lines.push(buildSummary);
  }

  const testSummary = summarizeCount('Test summary', report.test);
  if (testSummary) {
    lines.push(testSummary);
  }

  if (report.notes) {
    lines.push(`Notes: ${report.notes}`);
  }

  if (report.extensions) {
    lines.push(
      `Extensions: ${report.extensions.version} (${Object.keys(report.extensions.data).length} fields)`,
    );
  }

  lines.push(
    'Excluded by default: raw code, raw prompts, terminal logs, and customer data.',
  );

  return lines;
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

  const currentModelId = selectedModelId;
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
        const found = records.find((record) => record.metadata?.taskId === taskId);
        if (!found) {
          return undefined;
        }
        return {
          taskId,
          correlationId: found.metadata?.originalCorrelationId ?? found.correlationId,
          createdAt: new Date(found.createdAt).toISOString(),
        };
      },
      async set(record) {
        await store.putCorrelation({
          correlationId: record.correlationId.replace(/[:.]/g, '_'),
          packetHash: record.taskId,
          createdAt: Date.parse(record.createdAt),
          metadata: {
            taskId: record.taskId,
            originalCorrelationId: record.correlationId,
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

  const timestamp = (options?.clock ?? (() => new Date()))().getTime();
  const correlationId = payload.correlation.correlationId;
  const payloadHash = hashPayload(
    payload,
    context.builderOptions.redactionConfig.salt,
  );
  await store.putPayloadHash({
    hash: payloadHash,
    algorithm: 'sha-256-hmac',
    createdAt: timestamp,
  });

  let route: RouteResponse | undefined;
  if (options?.apiClient) {
    try {
      route = (await options.apiClient.route(payload)) as RouteResponse;
      const routeRecommendation = buildRecommendationFromRoute(
        route,
        context.registry,
      );
      if (routeRecommendation) {
        recommendation = routeRecommendation;
      }
    } catch (error) {
      await store.appendAudit({
        id: toAuditId(correlationId, 'route'),
        kind: 'routing',
        correlationId,
        status: 'failed',
        timestamp,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof ModelMappingError) {
        return fail(error.code, error.message, {
          suggestions: error.suggestions,
        });
      }

      if (error instanceof HokusaiNetworkError) {
        return fail('NETWORK_ERROR', error.message, {
          requestId: error.requestId,
        });
      }

      throw error;
    }
  } else {
    await store.appendAudit({
      id: toAuditId(correlationId, 'route'),
      kind: 'routing',
      correlationId,
      status: 'skipped',
      timestamp,
    });
  }

  const handoff = buildHandoffInstructions({
    recommendation,
    currentModelId,
    harness: 'claude-code',
  });
  const storedCorrelation = await findStoredCorrelationRecord(store, correlationId);
  if (storedCorrelation.record) {
    await store.putCorrelation({
      ...storedCorrelation.record,
      metadata: {
        ...storedCorrelation.record.metadata,
        recommendedModelId: recommendation.model.id,
        recommendedAlternativeIds: JSON.stringify(
          recommendation.alternatives?.map((entry) => entry.model.id) ?? [],
        ),
        reasonHash: hashPayload(
          recommendation.reason,
          context.builderOptions.redactionConfig.salt,
        ),
        reasonPreview: redactForStorage(
          recommendation.reason,
          context.builderOptions.redactionConfig,
        ),
        payloadHash,
        status: 'pending',
        decisionAt: (options?.clock ?? (() => new Date()))().toISOString(),
        ...(options?.env?.HOKUSAI_DEBUG === '1' || process.env.HOKUSAI_DEBUG === '1'
          ? {
              debugRedactedPayloadPreview: buildDebugPreview(
                payload.prompt,
                context.builderOptions.redactionConfig,
              ),
            }
          : {}),
      },
    });
  }

  if (options?.apiClient) {
    await store.appendAudit({
      id: toAuditId(correlationId, 'route'),
      kind: 'routing',
      correlationId,
      status: 'submitted',
      timestamp,
    });
  }

  return ok({
    recommendation,
    payload,
    preview: buildPreview(payload),
    correlationId,
    routingDecisionId: correlationId,
    handoff,
    ...(route ? { route } : {}),
  });
}

export async function declineRecommendation(
  input: DeclineRecommendationInput,
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<DeclineRecommendationResult>> {
  if (typeof input.correlationId !== 'string' || input.correlationId.trim().length === 0) {
    return fail(
      'UNKNOWN_CORRELATION',
      'A correlation id is required to decline a recommendation.',
    );
  }

  const context = resolveCommandContext(options);
  const store = new FsLocalStore(context.configDir);
  const resolved = await findStoredCorrelationRecord(store, input.correlationId.trim());

  if (!resolved.record) {
    return fail(
      'UNKNOWN_CORRELATION',
      `No stored routing decision matches correlation id ${input.correlationId.trim()}.`,
    );
  }

  await store.putCorrelation({
    ...resolved.record,
    metadata: {
      ...resolved.record.metadata,
      status: 'declined',
      declinedAt: (options?.clock ?? (() => new Date()))().toISOString(),
      ...(input.reason?.trim()
        ? {
            declineReason: redactForStorage(
              input.reason.trim(),
              context.builderOptions.redactionConfig,
            ),
          }
        : {}),
    },
  });

  return ok({
    correlationId:
      resolved.record.metadata?.originalCorrelationId ??
      input.correlationId.trim(),
    status: 'declined',
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

export async function findLatestRoutingDecision(input: {
  configDir: string;
}): Promise<LatestRoutingDecision | undefined> {
  const store = new FsLocalStore(input.configDir);
  const records = await store.listCorrelations();
  const latest = records.reduce<typeof records[number] | undefined>(
    (currentLatest, record) => {
      if (!currentLatest || record.createdAt > currentLatest.createdAt) {
        return record;
      }

      return currentLatest;
    },
    undefined,
  );

  if (!latest) {
    return undefined;
  }

  return {
    correlationId: latest.metadata?.originalCorrelationId ?? latest.correlationId,
    taskId: latest.metadata?.taskId ?? latest.packetHash,
    createdAt: new Date(latest.createdAt).toISOString(),
  };
}

export function previewReportOutcome(
  input: ReportOutcomeInput,
  options?: ClaudeCodeCommandOptions,
): AdapterResult<PreviewReportOutcomeResult> {
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

  return ok({
    report,
    preview: {
      lines: buildOutcomePreviewLines(report),
      payload: report,
    },
  });
}

export async function reportTaskOutcome(
  input: ReportOutcomeInput,
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<ReportOutcomeResult>> {
  const preview = previewReportOutcome(input, options);
  if (!preview.ok) {
    return preview;
  }

  const context = resolveCommandContext(options);
  const store = new FsLocalStore(context.configDir);
  const timestamp = (options?.clock ?? (() => new Date()))().getTime();
  await store.putPayloadHash({
    hash: hashPayload(
      preview.value.report,
      context.builderOptions.redactionConfig.salt,
    ),
    algorithm: 'sha-256-hmac',
    createdAt: timestamp,
  });

  let response: OutcomeResponse | undefined;
  if (options?.dryRun) {
    await store.appendAudit({
      id: toAuditId(input.correlationId, 'outcome'),
      kind: 'outcome',
      correlationId: input.correlationId,
      status: 'skipped',
      timestamp,
      error: 'dry-run',
    });
  } else if (options?.apiClient) {
    try {
      response = (await options.apiClient.reportOutcome(
        preview.value.report,
      )) as OutcomeResponse;
      await store.appendAudit({
        id: toAuditId(input.correlationId, 'outcome'),
        kind: 'outcome',
        correlationId: input.correlationId,
        status: 'submitted',
        timestamp,
      });
    } catch (error) {
      await store.appendAudit({
        id: toAuditId(input.correlationId, 'outcome'),
        kind: 'outcome',
        correlationId: input.correlationId,
        status: 'failed',
        timestamp,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof HokusaiNetworkError) {
        return fail('NETWORK_ERROR', error.message, {
          requestId: error.requestId,
        });
      }

      throw error;
    }
  } else {
    await store.appendAudit({
      id: toAuditId(input.correlationId, 'outcome'),
      kind: 'outcome',
      correlationId: input.correlationId,
      status: 'skipped',
      timestamp,
    });
  }

  return ok({
    report: preview.value.report,
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

export async function listRoutingDecisions(
  input: { limit?: number } = {},
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<{ decisions: RoutingDecisionSummary[] } & PrivacyResultWarnings>> {
  const context = resolveCommandContext(options);
  const store = new FsLocalStore(context.configDir);
  const { warnings = [] } = await pruneStoreForPrivacy(
    store,
    options?.env ?? process.env,
    options?.clock,
  );
  const [records, payloadHashes] = await Promise.all([
    store.listCorrelations(),
    store.listPayloadHashes(),
  ]);
  const limit =
    input.limit !== undefined ? Math.max(0, input.limit) : records.length;

  return ok({
    decisions: records
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((record) => toRoutingDecisionSummary(record, payloadHashes)),
    ...maybeWarnings(warnings),
  });
}

export async function previewStoredDecision(
  input: { correlationId: string; debug?: boolean },
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<DecisionPreview & PrivacyResultWarnings>> {
  if (typeof input.correlationId !== 'string' || input.correlationId.trim().length === 0) {
    return fail('UNKNOWN_CORRELATION', 'A correlation id is required.');
  }

  const context = resolveCommandContext(options);
  const store = new FsLocalStore(context.configDir);
  const { warnings = [] } = await pruneStoreForPrivacy(
    store,
    options?.env ?? process.env,
    options?.clock,
  );
  const resolved = await findStoredCorrelationRecord(store, input.correlationId.trim());

  if (!resolved.record) {
    return fail(
      'UNKNOWN_CORRELATION',
      `No record found for correlation id: ${input.correlationId.trim()}`,
    );
  }

  const payloadHashes = await store.listPayloadHashes();
  const summary = toRoutingDecisionSummary(resolved.record, payloadHashes);

  return ok({
    ...summary,
    ...(resolved.record.metadata?.decisionAt
      ? { decisionAt: resolved.record.metadata.decisionAt }
      : {}),
    ...(resolved.record.metadata?.declinedAt
      ? { declinedAt: resolved.record.metadata.declinedAt }
      : {}),
    ...(input.debug && resolved.record.metadata?.debugRedactedPayloadPreview
      ? {
          debugRedactedPayloadPreview:
            resolved.record.metadata.debugRedactedPayloadPreview,
        }
      : {}),
    ...maybeWarnings(warnings),
  });
}

export async function listSubmissionAudit(
  input: { limit?: number } = {},
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<{ entries: SubmissionAuditEntry[] } & PrivacyResultWarnings>> {
  const context = resolveCommandContext(options);
  const store = new FsLocalStore(context.configDir);
  const { warnings = [] } = await pruneStoreForPrivacy(
    store,
    options?.env ?? process.env,
    options?.clock,
  );
  const entries = await store.listAudit();
  const limit =
    input.limit !== undefined ? Math.max(0, input.limit) : entries.length;

  return ok({
    entries: entries
      .slice()
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit),
    ...maybeWarnings(warnings),
  });
}

export async function clearPrivacyState(
  input: {
    scope: 'all' | 'records' | 'audit';
    configDir?: string;
  },
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<ClearResult>> {
  const configDir =
    input.configDir ??
    resolveClaudeCodeConfigPath(
      options?.configPath ? { override: options.configPath } : undefined,
    ).dir;
  const store = new FsLocalStore(configDir);

  if (input.scope === 'all') {
    const [correlations, payloadHashes, auditEntries] = await Promise.all([
      store.listCorrelations(),
      store.listPayloadHashes(),
      store.listAudit(),
    ]);

    await clearClaudeCodeLocalState({
      ...options,
      configPath: configDir,
    });

    return ok({
      scope: 'all',
      correlationsCleared: correlations.length,
      payloadHashesCleared: payloadHashes.length,
      auditEntriesCleared: auditEntries.length,
      configCleared: true,
    });
  }

  if (input.scope === 'records') {
    const [correlations, payloadHashes] = await Promise.all([
      store.listCorrelations(),
      store.listPayloadHashes(),
    ]);
    await Promise.all([store.clearCorrelations(), store.clearPayloadHashes()]);
    return ok({
      scope: 'records',
      correlationsCleared: correlations.length,
      payloadHashesCleared: payloadHashes.length,
      auditEntriesCleared: 0,
      configCleared: false,
    });
  }

  const auditEntries = await store.listAudit();
  await store.clearAudit();
  return ok({
    scope: 'audit',
    correlationsCleared: 0,
    payloadHashesCleared: 0,
    auditEntriesCleared: auditEntries.length,
    configCleared: false,
  });
}

export async function setReportingEnabled(
  input: { enabled: boolean; configPath?: string },
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<{ enabled: boolean }>> {
  const configDir = resolveClaudeCodeConfigPath(
    options?.configPath ? { override: options.configPath } : undefined,
  ).dir;
  const pluginConfigPath = input.configPath ?? defaultPluginConfigPath(configDir);
  const store = new FilePluginConfigStore(pluginConfigPath);
  const existing = (await store.read()) ?? {};

  await store.write({
    ...existing,
    outcomeSubmissionEnabled: input.enabled,
  });

  return ok({ enabled: input.enabled });
}

export async function getReportingStatus(
  options?: ClaudeCodeCommandOptions,
): Promise<AdapterResult<ReportingStatusResult>> {
  const configDir = resolveClaudeCodeConfigPath(
    options?.configPath ? { override: options.configPath } : undefined,
  ).dir;
  const store = new FilePluginConfigStore(defaultPluginConfigPath(configDir));
  const stored = await store.read();
  const config = await loadPluginConfig({
    env: options?.env ?? process.env,
    store,
  });

  return ok({
    enabled: config.outcomeSubmissionEnabled,
    source:
      (options?.env ?? process.env).HOKUSAI_OUTCOME_OPT_IN !== undefined
        ? 'env'
        : stored?.outcomeSubmissionEnabled !== undefined
          ? 'stored'
          : 'default',
  });
}

export function displayTaskRecommendation(
  recommendation: HarnessRecommendation,
): RecommendationDisplay {
  const lines = [
    `Recommended model: ${recommendation.model.id}`,
    `Provider: ${recommendation.model.provider}`,
    `Reason: ${recommendation.reason}`,
  ];

  if (recommendation.confidence !== undefined) {
    lines.push(`Confidence: ${Math.round(recommendation.confidence * 100)}%`);
  }

  if (recommendation.alternatives && recommendation.alternatives.length > 0) {
    lines.push(
      `Alternatives: ${recommendation.alternatives.map((entry) => entry.model.id).join(', ')}`,
    );
    for (const alternative of recommendation.alternatives) {
      const parts = [alternative.model.id];
      if (alternative.reason) {
        parts.push(alternative.reason);
      }
      if (alternative.confidence !== undefined) {
        parts.push(`${Math.round(alternative.confidence * 100)}%`);
      }
      lines.push(`- ${parts.join(' - ')}`);
    }
  }

  return {
    lines,
    model: recommendation.model.id,
    provider: recommendation.model.provider,
  };
}

export function displayHandoff(handoff: HandoffInstructions): string[] {
  if (handoff.instructions.length === 0) {
    return ['Switch in Claude Code: no switch needed.'];
  }

  return [`Switch in Claude Code: ${handoff.copyableCommand ?? handoff.slashCommand}`];
}
