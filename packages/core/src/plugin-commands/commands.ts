import { rm } from 'node:fs/promises';
import {
  DEFAULT_REDACTION_CONFIG,
  FilePluginConfigStore,
  FsLocalStore,
  HokusaiDispatchBuilder,
  HokusaiNetworkError,
  ModelMappingError,
  buildOutcomeReport,
  canReportOutcome,
  canRoute,
  defaultPluginConfigPath,
  hashPayload,
  isConsentGranted,
  listSupportedModelIds,
  loadPluginConfig,
  mapRecommendation,
  preview,
  redact,
  resolveConsent,
  validateRouteRequest,
  type AdapterResult,
  type ConsentConfig,
  type ConsentSettings,
  type HarnessRecommendation,
  type ModelRegistry,
  type OutcomeReport,
  type OutcomeResponse,
  type PayloadHashRecord,
  type RedactionConfig,
  type RetentionPolicy,
  type RouteResponse,
  type SubmissionAuditEntry,
  type TaskPacket,
} from '../index.js';
import {
  buildDefaultRecommendation,
  buildPayloadPreview,
  displayTaskRecommendation,
  toModelSelection,
  type HarnessProfile,
} from './harness-profile.js';
import { recordOnboardingFunnelSignal } from '../onboarding-funnel.js';
import type {
  ClearResult,
  DecisionPreview,
  DeclineRecommendationInput,
  DeclineRecommendationResult,
  DoctorResult,
  LatestRoutingDecision,
  PayloadPreviewResult,
  PreviewReportOutcomeResult,
  PrivacyResultWarnings,
  ReportOutcomeInputWithTaskId,
  ReportOutcomeResult,
  ReportingStatusResult,
  RouteInputBase,
  RouteResult,
  RoutingDecisionSummary,
  SharedCommandOptions,
} from './types.js';

const ROUTING_REASON_LIMIT = 120;
const DEBUG_PREVIEW_LIMIT = 1000;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_RETENTION_MAX_RECORDS = 200;

async function recordCommandFunnelSignal(input: {
  enabled: boolean;
  options?: SharedCommandOptions | undefined;
  stage: Parameters<typeof recordOnboardingFunnelSignal>[0]['stage'];
  store: FsLocalStore;
  harness: string;
}): Promise<void> {
  try {
    await recordOnboardingFunnelSignal({
      client: input.options?.apiClient,
      enabled: input.enabled,
      harness: input.harness,
      now: (input.options?.clock ?? (() => new Date()))(),
      stage: input.stage,
      store: input.store,
    });
  } catch {
    // Funnel telemetry must never change command behavior.
  }
}

function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value };
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

function toStoredCorrelationId(correlationId: string): string {
  return correlationId.replace(/[:.]/g, '_');
}

function truncateForStorage(
  value: string,
  maxLength = ROUTING_REASON_LIMIT,
): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function redactForStorage(input: string, config: RedactionConfig): string {
  return truncateForStorage(redact(input, config).output);
}

function buildDebugPreview(input: string, config: RedactionConfig): string {
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
    return { policy: defaults, warnings: [toWarningMessage(rawValue)] };
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
    correlationId:
      record.metadata?.originalCorrelationId ?? record.correlationId,
    taskId: record.metadata?.taskId ?? record.packetHash,
    createdAt: new Date(record.createdAt).toISOString(),
    ...(record.metadata?.recommendedModelId
      ? { recommendedModelId: record.metadata.recommendedModelId }
      : {}),
    alternatives: parseAlternativeIds(
      record.metadata?.recommendedAlternativeIds,
    ),
    ...(record.metadata?.reasonPreview
      ? { reasonPreview: record.metadata.reasonPreview }
      : {}),
    ...(record.metadata?.status ? { status: record.metadata.status } : {}),
    ...(record.metadata?.reasonHash
      ? { reasonHash: record.metadata.reasonHash }
      : {}),
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
    return { storedCorrelationId, record: direct };
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

function applyProfileConstraints(
  packet: TaskPacket,
  profile: HarnessProfile<
    RouteInputBase,
    unknown,
    unknown,
    SharedCommandOptions
  >,
  registry: ModelRegistry,
): TaskPacket {
  const providerConstraints =
    profile.modelCatalog.providerConstraintLabels ??
    profile.modelCatalog.allowedProviders;
  const modelConstraints =
    profile.modelCatalog.modelConstraintLabels ??
    profile.modelCatalog.allowedModels ??
    listSupportedModelIds(registry, {
      ...(profile.modelCatalog.allowedProviders
        ? { allowedProviders: profile.modelCatalog.allowedProviders }
        : {}),
      ...(profile.modelCatalog.requireAvailable === undefined
        ? {}
        : { requireAvailable: profile.modelCatalog.requireAvailable }),
    });

  return {
    ...packet,
    ...(providerConstraints && providerConstraints.length > 0
      ? { providerConstraints: [...providerConstraints] }
      : {}),
    ...(modelConstraints && modelConstraints.length > 0
      ? { modelConstraints: [...modelConstraints] }
      : {}),
  };
}

function buildRecommendationFromRoute(
  route: RouteResponse,
  profile: HarnessProfile<
    RouteInputBase,
    unknown,
    unknown,
    SharedCommandOptions
  >,
  registry: ModelRegistry,
): HarnessRecommendation | undefined {
  if (!route.recommendation) {
    return undefined;
  }

  const mapped = mapRecommendation(route.recommendation, {
    registry,
    ...(profile.modelCatalog.allowedProviders
      ? { allowedProviders: profile.modelCatalog.allowedProviders }
      : {}),
    requireAvailable: profile.modelCatalog.requireAvailable ?? true,
  });

  return {
    model: toModelSelection(mapped),
    reason: route.recommendation.reason ?? profile.routeRecommendationReason,
    ...(route.recommendation.confidence === undefined
      ? {}
      : { confidence: route.recommendation.confidence }),
    ...(route.recommendation.alternatives?.length
      ? {
          alternatives: route.recommendation.alternatives.map(
            (alternative) => ({
              model: toModelSelection(
                mapRecommendation(alternative, {
                  registry,
                  ...(profile.modelCatalog.allowedProviders
                    ? {
                        allowedProviders: profile.modelCatalog.allowedProviders,
                      }
                    : {}),
                  requireAvailable:
                    profile.modelCatalog.requireAvailable ?? true,
                }),
              ),
              ...(alternative.reason === undefined
                ? {}
                : { reason: alternative.reason }),
              ...(alternative.confidence === undefined
                ? {}
                : { confidence: alternative.confidence }),
            }),
          ),
        }
      : {}),
  };
}

function resolveCommandContext<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(
  profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>,
  options?: TOptions,
): {
  builderOptions: TBuilderOptions;
  consent: ConsentConfig;
  configDir: string;
  registry: ModelRegistry;
  settings: ConsentSettings;
} {
  const consent = options?.consent ?? {
    subjectId: profile.defaultSubjectId,
    grantedScopes: ['task-execution', 'telemetry', 'local-storage'],
  };
  const config = profile.resolveConfigPath(
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
    builderOptions: profile.createBuilderOptions(options),
    consent,
    configDir: config.dir,
    registry: options?.registry ?? profile.modelCatalog.registry,
    settings,
  };
}

export function createRouteTask<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function routeTask(
    input: TRouteInput,
    options?: TOptions,
  ): Promise<RouteResult> {
    if (
      typeof input.taskText !== 'string' ||
      input.taskText.trim().length === 0
    ) {
      return fail(
        'INVALID_TASK',
        'Expected "taskText" to be a non-empty string.',
      );
    }

    const context = resolveCommandContext(profile, options);
    if (!canRoute(context.settings)) {
      return fail(
        'ROUTING_DISABLED',
        'Routing is disabled by the current consent settings.',
      );
    }

    const selectedModelId = input.modelId ?? context.registry.getDefault()?.id;
    if (!selectedModelId) {
      return fail(
        'UNKNOWN_MODEL',
        `No ${profile.harnessLabel} model is configured for routing.`,
      );
    }

    let recommendation: HarnessRecommendation;
    try {
      const mapped = mapRecommendation(
        { model: selectedModelId },
        {
          registry: context.registry,
          ...(profile.modelCatalog.allowedProviders
            ? { allowedProviders: profile.modelCatalog.allowedProviders }
            : {}),
          requireAvailable: profile.modelCatalog.requireAvailable ?? true,
        },
      );
      recommendation = buildDefaultRecommendation(
        profile,
        mapped,
        context.registry,
      );
    } catch (error) {
      if (error instanceof ModelMappingError) {
        return fail(error.code, error.message, {
          suggestions: error.suggestions,
        });
      }
      throw error;
    }

    const packetResult = profile.buildTaskPacket(input, context.builderOptions);
    packetResult.packet = applyProfileConstraints(
      packetResult.packet,
      profile,
      context.registry,
    );

    const store = new FsLocalStore(context.configDir);
    const taskId = profile.toTaskId(input, options?.clock);
    const payload = await new HokusaiDispatchBuilder({
      consent: context.consent,
      modelRegistry: context.registry,
      storage: {
        async get(lookupTaskId) {
          const records = await store.listCorrelations();
          const found = records.find(
            (record) => record.metadata?.taskId === lookupTaskId,
          );
          if (!found) {
            return undefined;
          }
          return {
            taskId: lookupTaskId,
            correlationId:
              found.metadata?.originalCorrelationId ?? found.correlationId,
            createdAt: new Date(found.createdAt).toISOString(),
          };
        },
        async set(record) {
          await store.putCorrelation({
            correlationId: toStoredCorrelationId(record.correlationId),
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
        id: taskId,
        prompt: profile.toPrompt(packetResult.packet),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      recommendation.model.id,
    );

    const validationErrors = validateRouteRequest(payload);
    if (validationErrors.length > 0) {
      return fail(
        'ROUTE_VALIDATION_FAILED',
        'Route payload validation failed.',
        {
          fieldErrors: validationErrors.map(
            (fieldError) => `${fieldError.path}: ${fieldError.message}`,
          ),
        },
      );
    }

    const timestamp = (options?.clock ?? (() => new Date()))().getTime();
    const correlationId = payload.correlation.correlationId;
    const payloadHash = hashPayload(
      payload,
      (
        (context.builderOptions as { redactionConfig?: { salt: string } })
          .redactionConfig ?? DEFAULT_REDACTION_CONFIG
      ).salt,
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
          profile,
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

    const currentModelId = selectedModelId;
    const handoff = profile.buildHandoff({
      recommendation,
      currentModelId,
    });
    const storedCorrelation = await findStoredCorrelationRecord(
      store,
      correlationId,
    );
    if (storedCorrelation.record) {
      const redactionConfig =
        (context.builderOptions as { redactionConfig?: RedactionConfig })
          .redactionConfig ?? DEFAULT_REDACTION_CONFIG;
      await store.putCorrelation({
        ...storedCorrelation.record,
        metadata: {
          ...storedCorrelation.record.metadata,
          recommendedModelId: recommendation.model.id,
          // Persist the server inference log id (returned as routeId) so
          // outcomes can be submitted against it later.
          ...(route?.routeId ? { inferenceLogId: route.routeId } : {}),
          recommendedAlternativeIds: JSON.stringify(
            recommendation.alternatives?.map((entry) => entry.model.id) ?? [],
          ),
          reasonHash: hashPayload(recommendation.reason, redactionConfig.salt),
          reasonPreview: redactForStorage(
            recommendation.reason,
            redactionConfig,
          ),
          payloadHash,
          status: 'pending',
          decisionAt: (options?.clock ?? (() => new Date()))().toISOString(),
          ...(options?.env?.HOKUSAI_DEBUG === '1' ||
          process.env.HOKUSAI_DEBUG === '1'
            ? {
                debugRedactedPayloadPreview: buildDebugPreview(
                  payload.prompt,
                  redactionConfig,
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
      await recordCommandFunnelSignal({
        enabled: canReportOutcome(context.settings),
        options,
        stage: 'first_route',
        store,
        harness: profile.harness,
      });
    }

    return ok({
      recommendation,
      payload,
      preview: buildPayloadPreview(payload),
      correlationId,
      routingDecisionId: correlationId,
      handoff,
      ...(route ? { route } : {}),
    });
  };
}

export function createDeclineRecommendation<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function declineRecommendation(
    input: DeclineRecommendationInput,
    options?: TOptions,
  ): Promise<AdapterResult<DeclineRecommendationResult>> {
    if (
      typeof input.correlationId !== 'string' ||
      input.correlationId.trim().length === 0
    ) {
      return fail(
        'UNKNOWN_CORRELATION',
        'A correlation id is required to decline a recommendation.',
      );
    }

    const context = resolveCommandContext(profile, options);
    const store = new FsLocalStore(context.configDir);
    const resolved = await findStoredCorrelationRecord(
      store,
      input.correlationId.trim(),
    );

    if (!resolved.record) {
      return fail(
        'UNKNOWN_CORRELATION',
        `No stored routing decision matches correlation id ${input.correlationId.trim()}.`,
      );
    }

    const redactionConfig =
      (context.builderOptions as { redactionConfig?: RedactionConfig })
        .redactionConfig ?? DEFAULT_REDACTION_CONFIG;
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
                redactionConfig,
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
  };
}

export function createRunDoctor<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return function runDoctor(options?: TOptions): DoctorResult {
    const config = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : undefined,
    );
    const consent = options?.consent ?? {
      subjectId: profile.defaultSubjectId,
      grantedScopes: ['task-execution', 'telemetry', 'local-storage'],
    };
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
  };
}

export function createPreviewTaskPayload<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return function previewTaskPayload(
    input: TRouteInput,
    options?: TOptions,
  ): PayloadPreviewResult<TPreview> {
    const context = resolveCommandContext(profile, options);
    const packet = applyProfileConstraints(
      profile.buildTaskPacket(input, context.builderOptions).packet,
      profile,
      context.registry,
    );
    const previewResult = profile.previewTaskPacket(
      input,
      context.builderOptions,
    );
    const taskId = profile.toTaskId(input, options?.clock);
    const harnessPreview = buildPayloadPreview({
      task: { id: taskId, prompt: profile.toPrompt(packet) },
      prompt: packet.userIntent,
      consent: {
        subjectId: context.consent.subjectId,
        grantedScopes: [...context.consent.grantedScopes],
      },
      model: {
        id:
          input.modelId ??
          context.registry.getDefault()?.id ??
          'unconfigured-model',
        provider:
          context.registry.get(
            input.modelId ?? context.registry.getDefault()?.id ?? '',
          )?.provider ??
          profile.modelCatalog.allowedProviders?.[0] ??
          'unknown',
        capabilities:
          context.registry.get(
            input.modelId ?? context.registry.getDefault()?.id ?? '',
          )?.capabilities ?? [],
      },
      correlation: {
        taskId,
        correlationId: 'preview-only',
        createdAt: new Date(0).toISOString(),
      },
      redactions: profile
        .buildTaskPacket(input, context.builderOptions)
        .redactionSummary.map((entry) => ({
          label: entry.category,
          count: entry.count,
          category: entry.category,
          placeholder: `<redacted:${entry.category}>`,
        })),
      createdAt: new Date(0).toISOString(),
    });

    return {
      packet,
      preview: previewResult,
      harnessPreview,
    };
  };
}

export async function findLatestRoutingDecision(input: {
  configDir: string;
}): Promise<LatestRoutingDecision | undefined> {
  const store = new FsLocalStore(input.configDir);
  const records = await store.listCorrelations();
  const latest = records.reduce<(typeof records)[number] | undefined>(
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
    correlationId:
      latest.metadata?.originalCorrelationId ?? latest.correlationId,
    taskId: latest.metadata?.taskId ?? latest.packetHash,
    createdAt: new Date(latest.createdAt).toISOString(),
    ...(latest.metadata?.recommendedModelId
      ? { recommendedModelId: latest.metadata.recommendedModelId }
      : {}),
    ...(latest.metadata?.inferenceLogId
      ? { inferenceLogId: latest.metadata.inferenceLogId }
      : {}),
  };
}

export function createPreviewReportOutcome<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return function previewReportOutcome(
    input: ReportOutcomeInputWithTaskId,
    options?: TOptions,
  ): AdapterResult<PreviewReportOutcomeResult> {
    const context = resolveCommandContext(profile, options);
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
        const validationErrors =
          (error as { errors?: Array<{ path: string; message: string }> })
            .errors ?? [];
        return fail('OUTCOME_VALIDATION_FAILED', error.message, {
          fieldErrors: validationErrors.map(
            (validationError) =>
              `${validationError.path}: ${validationError.message}`,
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
  };
}

export function createReportTaskOutcome<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  const previewReportOutcome = createPreviewReportOutcome(profile);

  return async function reportTaskOutcome(
    input: ReportOutcomeInputWithTaskId,
    options?: TOptions,
  ): Promise<AdapterResult<ReportOutcomeResult>> {
    const previewResult = previewReportOutcome(input, options);
    if (!previewResult.ok) {
      return previewResult;
    }

    const context = resolveCommandContext(profile, options);
    const store = new FsLocalStore(context.configDir);
    const timestamp = (options?.clock ?? (() => new Date()))().getTime();
    const redactionConfig =
      (context.builderOptions as { redactionConfig?: RedactionConfig })
        .redactionConfig ?? DEFAULT_REDACTION_CONFIG;
    await store.putPayloadHash({
      hash: hashPayload(previewResult.value.report, redactionConfig.salt),
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
          previewResult.value.report,
        )) as OutcomeResponse;
        await store.appendAudit({
          id: toAuditId(input.correlationId, 'outcome'),
          kind: 'outcome',
          correlationId: input.correlationId,
          status: 'submitted',
          timestamp,
        });
        await recordCommandFunnelSignal({
          enabled: canReportOutcome(context.settings),
          options,
          stage: 'first_contribution',
          store,
          harness: profile.harness,
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
      report: previewResult.value.report,
      ...(response ? { response } : {}),
      submitted: Boolean(response),
    });
  };
}

export function createClearLocalState<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function clearLocalState(
    options?: TOptions,
  ): Promise<AdapterResult<{ ok: true }>> {
    const config = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : undefined,
    );
    const store = new FsLocalStore(config.dir);

    await store.clear();
    if (profile.getStateFilePath) {
      await rm(profile.getStateFilePath(config.dir), { force: true });
    }
    await rm(config.dir, { recursive: true, force: true });

    return ok({ ok: true });
  };
}

export function createListRoutingDecisions<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function listRoutingDecisions(
    input: { limit?: number } = {},
    options?: TOptions,
  ): Promise<
    AdapterResult<
      { decisions: RoutingDecisionSummary[] } & PrivacyResultWarnings
    >
  > {
    const context = resolveCommandContext(profile, options);
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
  };
}

export function createPreviewStoredDecision<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function previewStoredDecision(
    input: { correlationId: string; debug?: boolean },
    options?: TOptions,
  ): Promise<AdapterResult<DecisionPreview & PrivacyResultWarnings>> {
    if (
      typeof input.correlationId !== 'string' ||
      input.correlationId.trim().length === 0
    ) {
      return fail('UNKNOWN_CORRELATION', 'A correlation id is required.');
    }

    const context = resolveCommandContext(profile, options);
    const store = new FsLocalStore(context.configDir);
    const { warnings = [] } = await pruneStoreForPrivacy(
      store,
      options?.env ?? process.env,
      options?.clock,
    );
    const resolved = await findStoredCorrelationRecord(
      store,
      input.correlationId.trim(),
    );

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
  };
}

export function createListSubmissionAudit<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function listSubmissionAudit(
    input: { limit?: number } = {},
    options?: TOptions,
  ): Promise<
    AdapterResult<{ entries: SubmissionAuditEntry[] } & PrivacyResultWarnings>
  > {
    const context = resolveCommandContext(profile, options);
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
  };
}

export function createClearPrivacyState<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  const clearLocalState = createClearLocalState(profile);

  return async function clearPrivacyState(
    input: { scope: 'all' | 'records' | 'audit'; configDir?: string },
    options?: TOptions,
  ): Promise<AdapterResult<ClearResult>> {
    const configDir =
      input.configDir ??
      profile.resolveConfigPath(
        options?.configPath ? { override: options.configPath } : undefined,
      ).dir;
    const store = new FsLocalStore(configDir);

    if (input.scope === 'all') {
      const [correlations, payloadHashes, auditEntries] = await Promise.all([
        store.listCorrelations(),
        store.listPayloadHashes(),
        store.listAudit(),
      ]);

      await clearLocalState({
        ...(options ?? {}),
        configPath: configDir,
      } as TOptions);

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
      await Promise.all([
        store.clearCorrelations(),
        store.clearPayloadHashes(),
      ]);
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
  };
}

export function createSetReportingEnabled<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function setReportingEnabled(
    input: { enabled: boolean; configPath?: string },
    options?: TOptions,
  ): Promise<AdapterResult<{ enabled: boolean }>> {
    const configDir = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : undefined,
    ).dir;
    const pluginConfigPath =
      input.configPath ?? defaultPluginConfigPath(configDir);
    const store = new FilePluginConfigStore(pluginConfigPath);
    const existing = (await store.read()) ?? {};

    await store.write({
      ...existing,
      outcomeSubmissionEnabled: input.enabled,
    });

    return ok({ enabled: input.enabled });
  };
}

export function createGetReportingStatus<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>) {
  return async function getReportingStatus(
    options?: TOptions,
  ): Promise<AdapterResult<ReportingStatusResult>> {
    const configDir = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : undefined,
    ).dir;
    const store = new FilePluginConfigStore(defaultPluginConfigPath(configDir));
    const stored = await store.read();
    const config = await loadPluginConfig({
      env: options?.env ?? process.env,
      store,
      registry: profile.modelCatalog.registry,
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
  };
}

export { displayTaskRecommendation, pruneStoreForPrivacy };
