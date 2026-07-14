import {
  HokusaiApiError,
  HokusaiAuthError,
  HokusaiDispatchError,
  HokusaiNetworkError,
  HokusaiRateLimitError,
  HokusaiValidationError,
  buildReportContributionRow,
  isConsentGranted,
  parseRouteContext,
  type AdapterError,
  type AdapterResult,
  type ConsentConfig,
  type ConsentScope,
  type ContributionAcceptedResponse,
  type ContributionRequest,
  type HokusaiClient,
  type HokusaiDispatchBuilder,
  type HokusaiDispatchPayload,
  type HokusaiValidationSuccess,
  type LocalStore,
  type OutcomeReportInput,
  type RouteContextProjection,
  type RouteResponse,
  type SubmissionAuditEntry,
} from '@hokusai/core';
import { buildCodexOutcomeReport } from './outcome.js';

export interface CodexCommandDescriptor {
  name:
    | 'hokusai:run'
    | 'hokusai:recommend'
    | 'hokusai:preview'
    | 'hokusai:outcome';
  consentScope: ConsentScope;
  description: string;
}

export const CODEX_COMMAND_MANIFEST: readonly CodexCommandDescriptor[] = [
  {
    name: 'hokusai:run',
    consentScope: 'task-execution',
    description: 'Run a Hokusai recommendation flow from Codex.',
  },
  {
    name: 'hokusai:recommend',
    consentScope: 'task-execution',
    description:
      'Request a Hokusai route recommendation for the current Codex task.',
  },
  {
    name: 'hokusai:preview',
    consentScope: 'task-execution',
    description: 'Preview the anonymized Hokusai route payload before sending.',
  },
  {
    name: 'hokusai:outcome',
    consentScope: 'telemetry',
    description: 'Submit an anonymized Codex outcome report to Hokusai.',
  },
] as const;

export interface RequestRecommendationArgs {
  client?: HokusaiClient;
  dispatchBuilder: HokusaiDispatchBuilder;
  task: Parameters<HokusaiDispatchBuilder['prepareDispatch']>[0];
  modelId: string;
  scope?: ConsentScope;
}

export interface PreviewRoutePayloadArgs {
  dispatchBuilder: HokusaiDispatchBuilder;
  task: Parameters<HokusaiDispatchBuilder['prepareDispatch']>[0];
  modelId: string;
  scope?: ConsentScope;
}

export interface SubmitOutcomeArgs {
  client?: HokusaiClient;
  consent: ConsentConfig;
  outcome: OutcomeReportInput;
  store?: LocalStore;
  auditId: string;
  clock?: () => Date;
  /** What the run cost. Without it the contribution is telemetry, not training data. */
  actualCostUsd?: number | undefined;
  wallClockSeconds?: number | undefined;
}

/**
 * The route this outcome belongs to, as persisted at route time. A contribution
 * row is attributed to its decision through `inference_log_id` and scored on the
 * models and descriptor the route actually used, so all of it has to be read
 * back from the store rather than reconstructed.
 */
async function loadRoutedTask(
  store: LocalStore | undefined,
  correlationId: string,
): Promise<
  | { routeContext: RouteContextProjection | undefined; inferenceLogId?: string }
  | undefined
> {
  if (!store) {
    return undefined;
  }

  const record =
    (await store.getCorrelation(correlationId.replace(/[:.]/g, '_'))) ??
    (await store.listCorrelations()).find(
      (entry) => entry.metadata?.originalCorrelationId === correlationId,
    );

  if (!record) {
    return undefined;
  }

  const inferenceLogId = record.metadata?.inferenceLogId;
  return {
    routeContext: parseRouteContext(record.metadata?.routeContext),
    ...(inferenceLogId ? { inferenceLogId } : {}),
  };
}

export async function requestRecommendation(
  args: RequestRecommendationArgs,
): Promise<AdapterResult<RouteResponse>> {
  if (!args.client) {
    return fail(
      'client_unavailable',
      'A Hokusai client is required to request a recommendation.',
    );
  }

  try {
    const payload = await args.dispatchBuilder.prepareDispatch(
      args.task,
      args.modelId,
      args.scope,
    );
    const response = await args.client.route(payload);
    if (!isRouteResponse(response)) {
      return fail(
        'invalid_route_response',
        'Hokusai client returned an unexpected route response shape.',
      );
    }
    return ok(response);
  } catch (error) {
    return failFromError(error);
  }
}

export async function previewRoutePayload(
  args: PreviewRoutePayloadArgs,
): Promise<AdapterResult<HokusaiDispatchPayload>> {
  try {
    const payload = await args.dispatchBuilder.prepareDispatch(
      args.task,
      args.modelId,
      args.scope,
    );
    return ok(payload);
  } catch (error) {
    return failFromError(error);
  }
}

export async function submitOutcome(
  args: SubmitOutcomeArgs,
): Promise<
  AdapterResult<
    ContributionAcceptedResponse | HokusaiValidationSuccess<ContributionRequest>
  >
> {
  const timestamp = (args.clock ?? (() => new Date()))().getTime();

  if (!isConsentGranted(args.consent, 'telemetry')) {
    await appendAudit(args.store, {
      id: args.auditId,
      kind: 'outcome',
      correlationId: args.outcome.correlationId,
      status: 'skipped',
      timestamp,
      error: 'Consent has not been granted for scope "telemetry".',
    });

    return fail(
      'consent_required',
      'Consent has not been granted for scope "telemetry".',
    );
  }

  if (!args.client) {
    await appendAudit(args.store, {
      id: args.auditId,
      kind: 'outcome',
      correlationId: args.outcome.correlationId,
      status: 'failed',
      timestamp,
      error: 'A Hokusai client is required to submit an outcome.',
    });
    return fail(
      'client_unavailable',
      'A Hokusai client is required to submit an outcome.',
    );
  }

  const report = buildCodexOutcomeReport(args.outcome);
  const routed = await loadRoutedTask(args.store, args.outcome.correlationId);

  // The legacy /outcomes endpoint patches an inference log and bypasses training
  // and reward attribution entirely, so an outcome that does not become a
  // contribution row earns nothing. Build the row before the network call: a
  // route we cannot attribute should fail loudly, not submit something useless.
  const rowResult = buildReportContributionRow({
    report,
    routeContext: routed?.routeContext,
    inferenceLogId: routed?.inferenceLogId,
    harness: 'codex',
    observedAt: new Date(timestamp).toISOString(),
    ...(args.actualCostUsd !== undefined
      ? { actualCostUsd: args.actualCostUsd }
      : {}),
    ...(args.wallClockSeconds !== undefined
      ? { wallClockSeconds: args.wallClockSeconds }
      : {}),
  });

  if (!rowResult.ok) {
    await appendAudit(args.store, {
      id: args.auditId,
      kind: 'outcome',
      correlationId: args.outcome.correlationId,
      status: 'failed',
      timestamp,
      error: rowResult.error.message,
    });
    return fail('contribution_unavailable', rowResult.error.message);
  }

  try {
    const response = await args.client.submitContribution({
      rows: [rowResult.value],
      metadata: { idempotency_key: args.outcome.correlationId },
    });

    await appendAudit(args.store, {
      id: args.auditId,
      kind: 'outcome',
      correlationId: args.outcome.correlationId,
      status: 'submitted',
      timestamp,
    });

    return ok(response);
  } catch (error) {
    const failure = normalizeError(error);
    await appendAudit(args.store, {
      id: args.auditId,
      kind: 'outcome',
      correlationId: args.outcome.correlationId,
      status: 'failed',
      timestamp,
      error: failure.message,
    });
    return { ok: false, error: failure };
  }
}

async function appendAudit(
  store: LocalStore | undefined,
  entry: SubmissionAuditEntry,
): Promise<void> {
  if (!store) {
    return;
  }

  await store.appendAudit(entry);
}

function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value };
}

function fail(code: string, message: string): AdapterResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function failFromError(error: unknown): AdapterResult<never> {
  return {
    ok: false,
    error: normalizeError(error),
  };
}

function isRouteResponse(response: unknown): response is RouteResponse {
  return (
    typeof (response as RouteResponse).routeId === 'string' &&
    typeof (response as RouteResponse).status === 'string'
  );
}

function normalizeError(error: unknown): AdapterError {
  if (
    error instanceof HokusaiDispatchError ||
    error instanceof HokusaiApiError ||
    error instanceof HokusaiAuthError ||
    error instanceof HokusaiValidationError ||
    error instanceof HokusaiRateLimitError ||
    error instanceof HokusaiNetworkError
  ) {
    const details: Record<string, string | string[]> = {};

    if (error instanceof HokusaiValidationError) {
      details.fieldErrors = error.fieldErrors.map(
        ({ path, message }) => `${path}: ${message}`,
      );
    }

    if (
      error instanceof HokusaiRateLimitError &&
      error.retryAfter !== undefined
    ) {
      details.retryAfter = String(error.retryAfter);
    }

    if (error instanceof HokusaiApiError && error.code) {
      details.apiCode = error.code;
    }

    return {
      code: error.name,
      message: error.message,
      ...(Object.keys(details).length > 0 ? { details } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name || 'Error',
      message: error.message,
    };
  }

  return {
    code: 'UnknownError',
    message: String(error),
  };
}
