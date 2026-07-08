import {
  HokusaiDispatchBuilder,
  HokusaiNetworkError,
  HokusaiValidationError,
} from './client.js';
import { DEFAULT_REDACTION_CONFIG, hashPayload } from './anonymization.js';
import { buildHandoffInstructions } from './handoff.js';
import {
  listSupportedModelIds,
  mapRecommendation,
  ModelMappingError,
} from './model-registry.js';
import { buildOutcomeReport } from './outcome.js';
import {
  validateRouteRequest,
  type HokusaiDispatchPayload,
  type OutcomeReportInput,
  type OutcomeResponse,
  type RouteResponse,
} from './schemas.js';
import {
  FsLocalStore,
  type LocalStore,
  type PayloadHashRecord,
  type SubmissionAuditEntry,
} from './storage.js';
import type {
  HarnessPayloadPreview,
  HarnessRecommendation,
} from './adapter.js';
import type { ConsentScope } from './consent.js';
import type {
  HarnessCommandError,
  HarnessCommandResult,
  HarnessRoutingProfile,
} from "./harness-profile.js";
import type { HokusaiClient } from './client.js';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_RETENTION_MAX_RECORDS = 200;

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

export interface ExecuteRouteCommandInput {
  apiKey?: string | undefined;
  client?: HokusaiClient | undefined;
  consentGranted: boolean;
  currentModelId?: string | undefined;
  taskId: string;
  taskText: string;
  metadata?: Record<string, string> | undefined;
  clock?: (() => Date) | undefined;
  previewOnly?: boolean | undefined;
  store: LocalStore;
  profile: HarnessRoutingProfile;
}

export interface RouteCommandValue {
  recommendation: HarnessRecommendation;
  alternatives: string[];
  correlationId: string;
  handoff: string;
  payload: HokusaiDispatchPayload;
  preview: HarnessPayloadPreview;
  route?: RouteResponse;
}

export interface PreviewOutcomeCommandInput {
  correlationId?: string | undefined;
  currentModelId?: string | undefined;
  input: Omit<OutcomeReportInput, 'correlationId' | 'recommendedModel'> &
    Partial<Pick<OutcomeReportInput, 'recommendedModel'>>;
  profile: HarnessRoutingProfile;
  store: LocalStore;
}

export interface PreviewOutcomeCommandValue {
  correlationId: string;
  report: ReturnType<HarnessRoutingProfile['buildOutcomeReport']>;
  resolvedRecommendedModel: string;
  previewLines: string[];
}

export interface SubmitOutcomeCommandInput extends PreviewOutcomeCommandInput {
  apiKey?: string | undefined;
  client?: HokusaiClient | undefined;
  outcomeOptIn: boolean;
  approve?: boolean | undefined;
  clock?: (() => Date) | undefined;
}

export interface SubmitOutcomeCommandValue extends PreviewOutcomeCommandValue {
  submitted: boolean;
  response?: OutcomeResponse;
}

export interface LatestRouteCommandValue {
  correlationId: string;
  taskId: string;
  createdAt: string;
  recommendedModel?: string;
  alternatives: string[];
}

export interface PrivacyStatusCommandValue {
  apiKeyConfigured: boolean;
  routingConsentGranted: boolean;
  outcomeOptInGranted: boolean;
  retentionDays: number;
  maxRecords: number;
  storageDir?: string;
  storedRoutes: number;
  storedPayloadHashes: number;
  auditEntries: number;
  warnings: string[];
  doctor: {
    status: 'ok' | 'action_required';
    checks: Array<{
      name: string;
      status: 'ok' | 'action_required';
      message: string;
      remediation?: string;
    }>;
  };
}

function ok<T>(value: T): HarnessCommandResult<T> {
  return { ok: true, value };
}

function fail<T>(
  code: HarnessCommandError['code'],
  message: string,
  remediation: string,
  details?: HarnessCommandError['details'],
): HarnessCommandResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      remediation,
      ...(details ? { details } : {}),
    },
  };
}

function getNow(clock?: () => Date): Date {
  return (clock ?? (() => new Date()))();
}

function createStoreBridge(store: LocalStore) {
  return {
    async get(taskId: string) {
      const records = await store.listCorrelations();
      const record = records.find((entry) => entry.metadata?.taskId === taskId);
      if (!record) {
        return undefined;
      }
      return {
        taskId,
        correlationId: record.metadata?.originalCorrelationId ?? record.correlationId,
        createdAt: new Date(record.createdAt).toISOString(),
      };
    },
    async set(record: { taskId: string; correlationId: string; createdAt: string }) {
      await store.putCorrelation({
        correlationId: normalizeCorrelationId(record.correlationId),
        packetHash: record.taskId,
        createdAt: Date.parse(record.createdAt),
        metadata: {
          taskId: record.taskId,
          originalCorrelationId: record.correlationId,
        },
      });
    },
  };
}

function normalizeCorrelationId(correlationId: string): string {
  return correlationId.replace(/[:.]/g, '_');
}

function toPayloadHashRecord(
  payload: unknown,
  clock?: () => Date,
): PayloadHashRecord {
  return {
    hash: hashPayload(payload, DEFAULT_REDACTION_CONFIG.salt),
    algorithm: 'sha-256-hmac',
    createdAt: getNow(clock).getTime(),
  };
}

function appendAudit(
  store: LocalStore,
  entry: SubmissionAuditEntry,
): Promise<void> {
  return store.appendAudit(entry);
}

function resolveDefaultRecommendation(
  profile: HarnessRoutingProfile,
  currentModelId?: string,
): HarnessRecommendation {
  const selectedModelId =
    currentModelId?.trim() ||
    profile.defaultModelId ||
    profile.registry.getDefault()?.id;

  if (!selectedModelId) {
    throw new ModelMappingError(
      'UNKNOWN_MODEL',
      `No ${profile.harnessName} model is configured for routing.`,
      profile.registry.listAvailable().map((model) => model.id),
    );
  }

  const mapped = mapRecommendation(
    { model: selectedModelId },
    {
      registry: profile.registry,
      allowedProviders: profile.allowedProviders,
      requireAvailable: true,
    },
  );

  return {
    model: {
      id: mapped.id,
      provider: mapped.provider,
      capabilities: mapped.capabilities,
    },
    reason: `${profile.harnessName} defaults to ${mapped.provider} models that are supported locally.`,
    confidence: 0.5,
    alternatives: profile.registry
      .listAvailable()
      .filter((model) => profile.allowedProviders.includes(model.provider))
      .filter((model) => model.id !== mapped.id)
      .map((model) => ({
        model: {
          id: model.id,
          provider: model.provider,
          capabilities: model.capabilities,
        },
      })),
  };
}

function mapRouteRecommendation(
  profile: HarnessRoutingProfile,
  route: RouteResponse,
  fallback: HarnessRecommendation,
): HarnessRecommendation {
  if (!route.recommendation) {
    return fallback;
  }

  const mapped = mapRecommendation(route.recommendation, {
    registry: profile.registry,
    allowedProviders: profile.allowedProviders,
    requireAvailable: true,
  });

  const recommendation: HarnessRecommendation = {
    model: {
      id: mapped.id,
      provider: mapped.provider,
      capabilities: mapped.capabilities,
    },
    reason:
      route.recommendation.reason ??
      `Recommended by the Hokusai router for ${profile.harnessName}.`,
    ...(route.recommendation.confidence === undefined
      ? {}
      : { confidence: route.recommendation.confidence }),
    alternatives: (route.recommendation.alternatives ?? [])
      .flatMap((alternative) => {
        try {
          const mappedAlternative = mapRecommendation(alternative, {
            registry: profile.registry,
            allowedProviders: profile.allowedProviders,
            requireAvailable: true,
          });
          if (mappedAlternative.id === mapped.id) {
            return [];
          }
          return [
            {
              model: {
                id: mappedAlternative.id,
                provider: mappedAlternative.provider,
                capabilities: mappedAlternative.capabilities,
              },
              ...(alternative.reason ? { reason: alternative.reason } : {}),
              ...(alternative.confidence === undefined
                ? {}
                : { confidence: alternative.confidence }),
            },
          ];
        } catch {
          return [];
        }
      }),
  };

  return profile.mapRouteResponse
    ? profile.mapRouteResponse({ route, recommendation })
    : recommendation;
}

function toValidationFailure(
  error: HokusaiValidationError | ModelMappingError,
): HarnessCommandResult<never> {
  if (error instanceof ModelMappingError) {
    return fail(
      'E_UNSUPPORTED_MODEL',
      error.message,
      'Use one of the supported models returned in the suggestions list.',
      { suggestions: error.suggestions },
    );
  }

  return fail(
    'E_VALIDATION',
    error.message,
    'Fix the invalid input fields and try again.',
    {
      fieldErrors: error.fieldErrors.map(
        (fieldError) => `${fieldError.path}: ${fieldError.message}`,
      ),
    },
  );
}

export async function executeRouteCommand(
  input: ExecuteRouteCommandInput,
): Promise<HarnessCommandResult<RouteCommandValue>> {
  const taskText = input.taskText.trim();
  if (!taskText) {
    return fail(
      'E_INVALID_INPUT',
      'Task text must be a non-empty string.',
      'Pass a concrete task description to Hokusai.',
    );
  }

  if (!input.previewOnly) {
    if (!input.apiKey?.trim()) {
      return fail(
        'E_MISSING_API_KEY',
        'HOKUSAI_API_KEY is not configured.',
        'Set HOKUSAI_API_KEY in the environment before routing.',
      );
    }
  }

  let recommendation: HarnessRecommendation;
  try {
    recommendation = resolveDefaultRecommendation(
      input.profile,
      input.currentModelId,
    );
  } catch (error) {
    if (error instanceof ModelMappingError) {
      return toValidationFailure(error);
    }
    throw error;
  }

  const taskInput: Parameters<HarnessRoutingProfile['buildTask']>[0] = {
    taskText,
    taskId: input.taskId,
    providerConstraints: [...input.profile.allowedProviders],
    modelConstraints: listSupportedModelIds(input.profile.registry, {
      allowedProviders: input.profile.allowedProviders,
      requireAvailable: true,
    }),
  };
  if (input.metadata) {
    taskInput.metadata = input.metadata;
  }
  if (input.currentModelId) {
    taskInput.currentModelId = input.currentModelId;
  }
  const task = input.profile.buildTask(taskInput);

  const grantedScopes: ConsentScope[] = ['task-execution', 'local-storage'];
  const builderOptions = {
    consent: {
      subjectId: input.profile.subjectId,
      grantedScopes,
    },
    modelRegistry: input.profile.registry,
    redactionConfig: DEFAULT_REDACTION_CONFIG,
  };
  const dispatchBuilderOptions = input.previewOnly
    ? builderOptions
    : {
        ...builderOptions,
        storage: createStoreBridge(input.store),
      };
  const payload = await new HokusaiDispatchBuilder(
    input.clock
      ? {
          ...dispatchBuilderOptions,
          clock: input.clock,
        }
      : dispatchBuilderOptions,
  ).prepareDispatch(task, recommendation.model.id);

  const validationErrors = validateRouteRequest(payload);
  if (validationErrors.length > 0) {
    return fail(
      'E_VALIDATION',
      'Route payload validation failed.',
      'Fix the route payload fields and try again.',
      {
        fieldErrors: validationErrors.map(
          (fieldError) => `${fieldError.path}: ${fieldError.message}`,
        ),
      },
    );
  }

  if (input.previewOnly) {
    return ok({
      recommendation,
      alternatives:
        recommendation.alternatives?.map((entry) => entry.model.id) ?? [],
      correlationId: payload.correlation.correlationId,
      handoff:
        input.profile.buildHandoff({
          recommendation,
          ...(input.currentModelId
            ? { currentModelId: input.currentModelId }
            : {}),
        }).instructions[0] ?? recommendation.model.id,
      payload,
      preview: input.profile.buildPreview(payload),
    });
  }

  const timestamp = getNow(input.clock).getTime();
  const payloadHash = hashPayload(payload, DEFAULT_REDACTION_CONFIG.salt);
  await input.store.putPayloadHash({
    hash: payloadHash,
    algorithm: 'sha-256-hmac',
    createdAt: timestamp,
  });

  let route: RouteResponse | undefined;
  try {
    route = (await input.client?.route(payload)) as RouteResponse | undefined;
    if (route) {
      recommendation = mapRouteRecommendation(input.profile, route, recommendation);
    }
  } catch (error) {
    await appendAudit(input.store, {
      id: `${normalizeCorrelationId(payload.correlation.correlationId)}-route`,
      kind: 'routing',
      correlationId: payload.correlation.correlationId,
      status: 'failed',
      timestamp,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof HokusaiNetworkError) {
      return fail(
        'E_NETWORK',
        error.message,
        'Check network connectivity and retry the routing request.',
      );
    }
    if (error instanceof HokusaiValidationError || error instanceof ModelMappingError) {
      return toValidationFailure(error);
    }
    throw error;
  }

  const handoff = input.profile.buildHandoff({
    recommendation,
    ...(input.currentModelId ? { currentModelId: input.currentModelId } : {}),
  });
  await input.profile.storeCorrelationMetadata?.({
    payload,
    recommendation,
    payloadHash,
    now: getNow(input.clock).toISOString(),
    store: input.store,
  });
  await appendAudit(input.store, {
    id: `${normalizeCorrelationId(payload.correlation.correlationId)}-route`,
    kind: 'routing',
    correlationId: payload.correlation.correlationId,
    status: 'submitted',
    timestamp,
  });

  return ok({
    recommendation,
    alternatives: recommendation.alternatives?.map((entry) => entry.model.id) ?? [],
    correlationId: payload.correlation.correlationId,
    handoff: handoff.instructions[0] ?? handoff.copyableCommand ?? handoff.slashCommand,
    payload,
    preview: input.profile.buildPreview(payload),
    ...(route ? { route } : {}),
  });
}

async function resolveCorrelationRecord(
  store: LocalStore,
  correlationId?: string,
): Promise<{
  correlationId: string;
  taskId: string;
  recommendedModel?: string;
  alternatives: string[];
} | undefined> {
  const records = await store.listCorrelations();
  const sorted = records.slice().sort((left, right) => right.createdAt - left.createdAt);
  const match = correlationId
    ? sorted.find(
        (record) =>
          record.correlationId === normalizeCorrelationId(correlationId) ||
          record.metadata?.originalCorrelationId === correlationId,
      )
    : sorted[0];

  if (!match) {
    return undefined;
  }

  const output = {
    correlationId: match.metadata?.originalCorrelationId ?? match.correlationId,
    taskId: match.metadata?.taskId ?? match.packetHash,
    alternatives: parseAlternativeIds(match.metadata?.recommendedAlternativeIds),
  };
  return match.metadata?.recommendedModelId
    ? {
        ...output,
        recommendedModel: match.metadata.recommendedModelId,
      }
    : output;
}

function buildOutcomePreviewLines(
  correlationId: string,
  report: ReturnType<HarnessRoutingProfile['buildOutcomeReport']>,
): string[] {
  return [
    `Correlation ID: ${correlationId}`,
    `Recommended model: ${report.recommendedModel}`,
    `Actual model: ${report.actualModel}`,
    `Completion status: ${report.completionStatus}`,
    `Recommendation accepted: ${report.recommendationAccepted ? 'yes' : 'no'}`,
    'Excluded by default: raw code, raw prompts, terminal logs, customer data.',
  ];
}

export async function previewOutcomeCommand(
  input: PreviewOutcomeCommandInput,
): Promise<HarnessCommandResult<PreviewOutcomeCommandValue>> {
  const resolved = await resolveCorrelationRecord(input.store, input.correlationId);
  if (!resolved) {
    return fail(
      'E_NOT_FOUND',
      'No stored route was found for outcome reporting.',
      'Route a task first or pass an explicit correlationId.',
    );
  }

  const recommendedModel =
    input.input.recommendedModel ?? resolved.recommendedModel ?? input.currentModelId;
  if (!recommendedModel?.trim()) {
    return fail(
      'E_INVALID_INPUT',
      'recommendedModel is required when no stored recommendation exists.',
      'Pass recommendedModel explicitly or route the task first.',
    );
  }

  const reportInput: OutcomeReportInput = {
    ...input.input,
    correlationId: resolved.correlationId,
    recommendedModel: recommendedModel.trim(),
  };

  try {
    const report = input.profile.buildOutcomeReport(reportInput);
    return ok({
      correlationId: resolved.correlationId,
      report,
      resolvedRecommendedModel: recommendedModel.trim(),
      previewLines: buildOutcomePreviewLines(resolved.correlationId, report),
    });
  } catch (error) {
    return fail(
      'E_VALIDATION',
      error instanceof Error ? error.message : String(error),
      'Fix the outcome payload fields and try again.',
    );
  }
}

export async function submitOutcomeCommand(
  input: SubmitOutcomeCommandInput,
): Promise<HarnessCommandResult<SubmitOutcomeCommandValue>> {
  const preview = await previewOutcomeCommand(input);
  if (!preview.ok) {
    return preview;
  }

  if (!input.approve) {
    return ok({
      ...preview.value,
      submitted: false,
    });
  }

  if (!input.apiKey?.trim()) {
    return fail(
      'E_MISSING_API_KEY',
      'HOKUSAI_API_KEY is not configured.',
      'Set HOKUSAI_API_KEY in the environment before sending outcome reports.',
    );
  }
  if (!input.outcomeOptIn) {
    return fail(
      'E_MISSING_CONSENT',
      'HOKUSAI_OUTCOME_OPT_IN must be explicitly enabled before sending outcomes.',
      'Set HOKUSAI_OUTCOME_OPT_IN=true to allow outcome reporting.',
    );
  }

  const timestamp = getNow(input.clock).getTime();
  await input.store.putPayloadHash(toPayloadHashRecord(preview.value.report, input.clock));

  try {
    const response = (await input.client?.reportOutcome(
      preview.value.report,
    )) as OutcomeResponse | undefined;
    await appendAudit(input.store, {
      id: `${normalizeCorrelationId(preview.value.correlationId)}-outcome`,
      kind: 'outcome',
      correlationId: preview.value.correlationId,
      status: 'submitted',
      timestamp,
    });
    return ok({
      ...preview.value,
      submitted: true,
      ...(response ? { response } : {}),
    });
  } catch (error) {
    await appendAudit(input.store, {
      id: `${normalizeCorrelationId(preview.value.correlationId)}-outcome`,
      kind: 'outcome',
      correlationId: preview.value.correlationId,
      status: 'failed',
      timestamp,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof HokusaiNetworkError) {
      return fail(
        'E_NETWORK',
        error.message,
        'Check network connectivity and retry outcome submission.',
      );
    }
    if (error instanceof HokusaiValidationError) {
      return toValidationFailure(error);
    }
    throw error;
  }
}

export async function latestRouteCommand(
  store: LocalStore,
): Promise<HarnessCommandResult<LatestRouteCommandValue>> {
  const resolved = await resolveCorrelationRecord(store);
  if (!resolved) {
    return fail(
      'E_NOT_FOUND',
      'No stored route was found.',
      'Route a task first before requesting the latest route.',
    );
  }

  const records = await store.listCorrelations();
  const match = records.find(
    (entry) =>
      entry.metadata?.originalCorrelationId === resolved.correlationId ||
      entry.correlationId === normalizeCorrelationId(resolved.correlationId),
  );

  return ok({
    correlationId: resolved.correlationId,
    taskId: resolved.taskId,
    createdAt: new Date(match?.createdAt ?? 0).toISOString(),
    alternatives: resolved.alternatives,
    ...(resolved.recommendedModel
      ? { recommendedModel: resolved.recommendedModel }
      : {}),
  });
}

export async function privacyStatusCommand(input: {
  apiKey?: string | undefined;
  outcomeOptInGranted: boolean;
  store: LocalStore;
  storageDir?: string | undefined;
  retentionDays?: number | undefined;
}): Promise<HarnessCommandResult<PrivacyStatusCommandValue>> {
  const [correlations, payloadHashes, auditEntries] = await Promise.all([
    input.store.listCorrelations(),
    input.store.listPayloadHashes(),
    input.store.listAudit(),
  ]);
  const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const checks = [
    {
      name: 'apiKey',
      status: input.apiKey?.trim() ? 'ok' : 'action_required',
      message: input.apiKey?.trim()
        ? 'HOKUSAI_API_KEY is configured.'
        : 'HOKUSAI_API_KEY is not configured.',
      remediation: input.apiKey?.trim()
        ? undefined
        : 'Set HOKUSAI_API_KEY before routing or reporting.',
    },
    {
      name: 'outcomeOptIn',
      status: input.outcomeOptInGranted ? 'ok' : 'action_required',
      message: input.outcomeOptInGranted
        ? 'Outcome reporting opt-in is enabled.'
        : 'Outcome reporting opt-in is not enabled.',
      remediation: input.outcomeOptInGranted
        ? undefined
        : 'Set HOKUSAI_OUTCOME_OPT_IN=true before sending outcomes.',
    },
  ] as const;

  return ok({
    apiKeyConfigured: Boolean(input.apiKey?.trim()),
    routingConsentGranted: true,
    outcomeOptInGranted: input.outcomeOptInGranted,
    retentionDays,
    maxRecords: DEFAULT_RETENTION_MAX_RECORDS,
    ...(input.storageDir ? { storageDir: input.storageDir } : {}),
    storedRoutes: correlations.length,
    storedPayloadHashes: payloadHashes.length,
    auditEntries: auditEntries.length,
    warnings: [],
    doctor: {
      status: checks.every((check) => check.status === 'ok')
        ? 'ok'
        : 'action_required',
      checks: checks.map((check) => ({
        name: check.name,
        status: check.status,
        message: check.message,
        ...(check.remediation ? { remediation: check.remediation } : {}),
      })),
    },
  });
}

export function createFsStore(configDir: string): FsLocalStore {
  return new FsLocalStore(configDir);
}

export function createDefaultOutcomeReport(
  input: OutcomeReportInput,
): ReturnType<typeof buildOutcomeReport> {
  return buildOutcomeReport(input);
}

export function createDefaultHandoff(
  recommendation: HarnessRecommendation,
  currentModelId: string | undefined,
  harness: 'claude-code' | 'codex',
) {
  return buildHandoffInstructions({
    recommendation,
    harness,
    ...(currentModelId ? { currentModelId } : {}),
  });
}
