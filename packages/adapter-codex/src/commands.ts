import {
  HokusaiApiError,
  HokusaiAuthError,
  HokusaiDispatchError,
  HokusaiNetworkError,
  HokusaiRateLimitError,
  HokusaiValidationError,
  isConsentGranted,
  type AdapterError,
  type AdapterResult,
  type ConsentConfig,
  type ConsentScope,
  type HokusaiClient,
  type HokusaiDispatchBuilder,
  type HokusaiDispatchPayload,
  type HokusaiValidationSuccess,
  type LocalStore,
  type OutcomeReport,
  type OutcomeReportInput,
  type OutcomeResponse,
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
    description: 'Request a Hokusai route recommendation for the current Codex task.',
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
}

export async function requestRecommendation(
  args: RequestRecommendationArgs,
): Promise<AdapterResult<RouteResponse>> {
  if (!args.client) {
    return fail('client_unavailable', 'A Hokusai client is required to request a recommendation.');
  }

  try {
    const payload = await args.dispatchBuilder.prepareDispatch(
      args.task,
      args.modelId,
      args.scope,
    );
    const response = await args.client.route(payload);
    if (!isRouteResponse(response)) {
      return fail('invalid_route_response', 'Hokusai client returned an unexpected route response shape.');
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
): Promise<AdapterResult<OutcomeResponse | HokusaiValidationSuccess<OutcomeReport>>> {
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
    return fail('client_unavailable', 'A Hokusai client is required to submit an outcome.');
  }

  try {
    const response = await args.client.reportOutcome(
      buildCodexOutcomeReport(args.outcome),
    );

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

function isRouteResponse(
  response: RouteResponse | HokusaiValidationSuccess<HokusaiDispatchPayload>,
): response is RouteResponse {
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

    if (error instanceof HokusaiRateLimitError && error.retryAfter !== undefined) {
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
