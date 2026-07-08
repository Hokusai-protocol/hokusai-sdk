import {
  anonymizeText,
  redact,
  type AnonymizationOptions,
  type RedactionConfig,
} from './anonymization.js';
import {
  assertCanRoute,
  assertCanSubmitOutcome,
  isConsentGranted,
  type ConsentConfig,
  type ConsentScope,
} from './consent.js';
import type { HokusaiPluginConfig } from './config.js';
import {
  type HokusaiDispatchPayload,
  type HokusaiFieldError,
  type HokusaiTaskInput,
  type TechnicalTaskRouterTaskType,
  type HokusaiValidationSuccess,
  type OutcomeReport,
  type OutcomeResponse,
  type RouteRequest,
  type RouteResponse,
  type TechnicalTaskRouterRequest,
  validateOutcomeReport,
  validateOutcomeResponse,
  validateRouteRequest,
  validateRouteResponse,
} from './schemas.js';
import {
  type ModelDefinition,
  type ModelRegistry,
  type ModelSelection,
  validateRecommendedModel,
} from './model-registry.js';
import {
  InMemoryCorrelationStorage,
  type CorrelationRecord,
  type CorrelationStorage,
} from './storage.js';

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 5_000;
const ROUTE_PATH = '/api/v1/models/30/predict';
const OUTCOME_PATH = '/v1/outcomes';
const SIGNAL_PATH = '/v1/signals';
const SDK_VERSION = '0.1.5';

export const DEFAULT_HOKUSAI_BASE_URL = 'https://api.hokus.ai';

export interface FetchTransportResponse {
  headers: {
    get(name: string): string | null;
  };
  status: number;
  text(): Promise<string>;
}

export interface FetchTransportRequestInit {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  signal?: AbortSignal;
}

export type FetchTransport = (
  input: string,
  init: FetchTransportRequestInit,
) => Promise<FetchTransportResponse>;

export interface HokusaiRequestOptions {
  dryRun?: boolean;
  requestId?: string;
  signal?: AbortSignal;
}

export interface HokusaiSignalRequest {
  kind: string;
  stage: string;
  installationId: string;
  occurredAt: string;
  installedAt?: string | undefined;
  harness?: string | undefined;
  timeToFirstRouteMs?: number | undefined;
}

export interface HokusaiSignalResponse {
  requestId?: string | undefined;
  status: 'recorded';
}

export interface HokusaiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  transport?: FetchTransport;
  maxRetries?: number;
  timeoutMs?: number;
  sdkVersion?: string;
  requestIdFactory?: () => string;
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HokusaiDispatchBuilderOptions {
  consent: ConsentConfig;
  anonymization?: AnonymizationOptions;
  redactionConfig?: RedactionConfig;
  modelRegistry: ModelRegistry;
  modelAllowlist?: string[];
  storage?: CorrelationStorage;
  clock?: () => Date;
}

export interface HokusaiPluginClientOptions extends Omit<
  HokusaiClientOptions,
  'apiKey' | 'baseUrl'
> {
  config: HokusaiPluginConfig;
}

export interface GatedClient {
  readonly client: HokusaiClient;
  route(
    request: RouteRequest,
    options?: HokusaiRequestOptions,
  ): Promise<
    RouteResponse | HokusaiValidationSuccess<TechnicalTaskRouterRequest>
  >;
  reportOutcome(
    request: OutcomeReport,
    options?: HokusaiRequestOptions,
  ): Promise<OutcomeResponse | HokusaiValidationSuccess<OutcomeReport>>;
}

interface ParsedErrorBody {
  code?: string | undefined;
  fieldErrors?: HokusaiFieldError[] | undefined;
  message?: string | undefined;
  retryAfter?: number | undefined;
}

interface HokusaiApiErrorOptions {
  code?: string | undefined;
  requestId: string;
  status?: number | undefined;
}

export class HokusaiDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HokusaiDispatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class HokusaiApiError extends Error {
  readonly code?: string;
  readonly requestId: string;
  readonly status?: number;

  constructor(message: string, options: HokusaiApiErrorOptions) {
    super(message);
    this.name = 'HokusaiApiError';
    this.requestId = options.requestId;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.code !== undefined) {
      this.code = options.code;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class HokusaiAuthError extends HokusaiApiError {
  constructor(message: string, options: HokusaiApiErrorOptions) {
    super(message, options);
    this.name = 'HokusaiAuthError';
  }
}

export class HokusaiValidationError extends HokusaiApiError {
  readonly fieldErrors: HokusaiFieldError[];

  constructor(
    message: string,
    options: HokusaiApiErrorOptions & { fieldErrors: HokusaiFieldError[] },
  ) {
    super(message, options);
    this.name = 'HokusaiValidationError';
    this.fieldErrors = [...options.fieldErrors];
  }
}

export class HokusaiNetworkError extends HokusaiApiError {
  constructor(message: string, options: HokusaiApiErrorOptions) {
    super(message, options);
    this.name = 'HokusaiNetworkError';
  }
}

export class HokusaiRateLimitError extends HokusaiApiError {
  readonly retryAfter?: number;

  constructor(
    message: string,
    options: HokusaiApiErrorOptions & { retryAfter?: number | undefined },
  ) {
    super(message, options);
    this.name = 'HokusaiRateLimitError';
    if (options.retryAfter !== undefined) {
      this.retryAfter = options.retryAfter;
    }
  }
}

export class HokusaiDispatchBuilder {
  readonly #anonymization: AnonymizationOptions | undefined;
  readonly #redactionConfig: RedactionConfig | undefined;
  readonly #clock: () => Date;
  readonly #consent: ConsentConfig;
  readonly #modelRegistry: ModelRegistry;
  readonly #modelAllowlist: string[] | undefined;
  readonly #storage: CorrelationStorage;

  constructor(options: HokusaiDispatchBuilderOptions) {
    this.#consent = options.consent;
    this.#anonymization = options.anonymization;
    this.#redactionConfig = options.redactionConfig;
    this.#modelRegistry = options.modelRegistry;
    this.#modelAllowlist = options.modelAllowlist;
    this.#storage = options.storage ?? new InMemoryCorrelationStorage();
    this.#clock = options.clock ?? (() => new Date());
  }

  async prepareDispatch(
    task: HokusaiTaskInput,
    modelId: string,
    scope: ConsentScope = 'task-execution',
  ): Promise<HokusaiDispatchPayload> {
    if (!isConsentGranted(this.#consent, scope)) {
      throw new HokusaiDispatchError(
        `Consent has not been granted for scope "${scope}".`,
      );
    }

    const model = this.#resolveModel(modelId);
    if (this.#modelAllowlist) {
      const validation = validateRecommendedModel(model.id, {
        allowlist: this.#modelAllowlist,
        registry: this.#modelRegistry,
      });

      if (!validation.ok) {
        throw new HokusaiDispatchError(
          `Model "${model.id}" is not permitted by the configured allowlist.`,
        );
      }
    }
    const correlationRecord = await this.#getOrCreateCorrelationRecord(task.id);
    const promptPayload = this.#redactionConfig
      ? redact(task.prompt, this.#redactionConfig)
      : anonymizeText(task.prompt, this.#anonymization ?? {});

    return {
      task,
      consent: {
        grantedScopes: [...this.#consent.grantedScopes],
        subjectId: this.#consent.subjectId,
      },
      model: this.#toModelSelection(model),
      correlation: correlationRecord,
      prompt:
        'output' in promptPayload ? promptPayload.output : promptPayload.text,
      redactions:
        'output' in promptPayload
          ? promptPayload.redactions
          : promptPayload.redactions.map(({ label }) => ({ label })),
      createdAt: this.#clock().toISOString(),
    };
  }

  async #getOrCreateCorrelationRecord(
    taskId: string,
  ): Promise<CorrelationRecord> {
    const existing = await this.#storage.get(taskId);
    if (existing) {
      return existing;
    }

    const createdAt = this.#clock().toISOString();
    const correlationRecord = {
      taskId,
      correlationId: `${taskId}:${createdAt}`,
      createdAt,
    };

    await this.#storage.set(correlationRecord);
    return correlationRecord;
  }

  #resolveModel(modelId: string): ModelDefinition {
    const model = this.#modelRegistry.get(modelId);
    if (!model) {
      throw new HokusaiDispatchError(`Unknown model "${modelId}".`);
    }

    return model;
  }

  #toModelSelection(model: ModelDefinition): ModelSelection {
    return {
      id: model.id,
      provider: model.provider,
      capabilities: [...model.capabilities],
    };
  }
}

export class HokusaiClient {
  readonly #apiKey: string | undefined;
  readonly #backoffMs: (attempt: number) => number;
  readonly #baseUrl: URL;
  readonly #maxRetries: number;
  readonly #requestIdFactory: () => string;
  readonly #sdkVersion: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #transport: FetchTransport | undefined;

  constructor(options: HokusaiClientOptions = {}) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = parseBaseUrl(options.baseUrl ?? DEFAULT_HOKUSAI_BASE_URL);
    this.#transport = options.transport ?? getGlobalFetchTransport();
    this.#maxRetries = normalizeMaxRetries(options.maxRetries);
    this.#timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.#sdkVersion = options.sdkVersion ?? SDK_VERSION;
    this.#requestIdFactory = options.requestIdFactory ?? createRequestId;
    this.#backoffMs = options.backoffMs ?? defaultBackoffMs;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  async route(
    request: RouteRequest,
    options: HokusaiRequestOptions = {},
  ): Promise<
    RouteResponse | HokusaiValidationSuccess<TechnicalTaskRouterRequest>
  > {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateRouteRequest(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError('Route request validation failed.', {
        requestId,
        fieldErrors,
      });
    }

    const technicalTaskRouterRequest = buildTechnicalTaskRouterRequest(request);

    if (options.dryRun) {
      return {
        ok: true,
        request: technicalTaskRouterRequest,
      };
    }

    return this.#send<TechnicalTaskRouterRequest, RouteResponse>({
      path: ROUTE_PATH,
      request: technicalTaskRouterRequest,
      requestId,
      requestOptions: options,
      responseMapper: (response, responseRequestId) =>
        normalizeTechnicalTaskRouterResponse(
          response,
          request,
          responseRequestId,
        ),
      responseValidator: validateRouteResponse,
      responseErrorMessage: 'Hokusai API returned an invalid route response.',
    });
  }

  async reportOutcome(
    request: OutcomeReport,
    options: HokusaiRequestOptions = {},
  ): Promise<OutcomeResponse | HokusaiValidationSuccess<OutcomeReport>> {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateOutcomeReport(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError('Outcome report validation failed.', {
        requestId,
        fieldErrors,
      });
    }

    if (options.dryRun) {
      return {
        ok: true,
        request,
      };
    }

    const response = await this.#send<OutcomeReport, OutcomeResponse>({
      allowNoContent: true,
      path: OUTCOME_PATH,
      request,
      requestId,
      requestOptions: options,
      responseValidator: validateOutcomeResponse,
      responseErrorMessage: 'Hokusai API returned an invalid outcome response.',
    });

    if (response.status === 'recorded') {
      return response;
    }

    return response;
  }

  async signal(
    request: HokusaiSignalRequest,
    options: HokusaiRequestOptions = {},
  ): Promise<HokusaiSignalResponse | HokusaiValidationSuccess<HokusaiSignalRequest>> {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateSignalRequest(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError('Signal request validation failed.', {
        requestId,
        fieldErrors,
      });
    }

    if (options.dryRun) {
      return {
        ok: true,
        request,
      };
    }

    return this.#send<HokusaiSignalRequest, HokusaiSignalResponse>({
      allowNoContent: true,
      path: SIGNAL_PATH,
      request,
      requestId,
      requestOptions: options,
      responseValidator: validateSignalResponse,
      responseErrorMessage: 'Hokusai API returned an invalid signal response.',
    });
  }

  async #send<
    TRequest,
    TResponse extends { requestId?: string | undefined },
  >(options: {
    allowNoContent?: boolean;
    path: string;
    request: TRequest;
    requestId: string;
    requestOptions: HokusaiRequestOptions;
    responseErrorMessage: string;
    responseMapper?: (value: unknown, requestId: string) => TResponse;
    responseValidator: (value: unknown) => HokusaiFieldError[];
  }): Promise<TResponse> {
    const transport = this.#transport;
    if (!transport) {
      throw new HokusaiApiError(
        'No fetch transport is available. Pass a transport explicitly when constructing HokusaiClient.',
        {
          requestId: options.requestId,
        },
      );
    }

    if (!this.#apiKey) {
      throw new HokusaiAuthError(
        'A Hokusai API key is required. Pass apiKey when constructing HokusaiClient.',
        {
          requestId: options.requestId,
        },
      );
    }

    let attempt = 0;
    let lastError: HokusaiApiError | undefined;

    while (attempt <= this.#maxRetries) {
      try {
        const response = await this.#executeRequest({
          path: options.path,
          request: options.request,
          requestId: options.requestId,
          signal: options.requestOptions.signal,
          transport,
        });

        const headerRequestId =
          response.headers.get('x-hokusai-request-id') ?? options.requestId;

        if (response.status >= 200 && response.status < 300) {
          if (response.status === 204 && options.allowNoContent) {
            return {
              requestId: headerRequestId,
              status: 'recorded',
              taskId: getTaskId(options.request),
            } as unknown as TResponse;
          }

          const body = await readJsonBody(response, options.requestId);
          const responseObject = options.responseMapper
            ? options.responseMapper(body, headerRequestId)
            : (body as TResponse);
          const fieldErrors = options.responseValidator(responseObject);
          if (fieldErrors.length > 0) {
            throw new HokusaiApiError(options.responseErrorMessage, {
              requestId: headerRequestId,
              status: response.status,
            });
          }

          if (responseObject.requestId === undefined) {
            responseObject.requestId = headerRequestId;
          }

          return responseObject;
        }

        const parsedError = await parseErrorResponse(response);
        lastError = this.#toApiError({
          parsedError,
          requestId: headerRequestId,
          status: response.status,
        });

        if (!shouldRetryResponse(response.status, attempt, this.#maxRetries)) {
          throw lastError;
        }

        await this.#sleep(
          getRetryDelayMs({
            attempt,
            backoffMs: this.#backoffMs,
            retryAfter: parsedError.retryAfter,
          }),
        );
      } catch (error) {
        if (error instanceof HokusaiApiError) {
          if (!isRetryableApiError(error) || attempt >= this.#maxRetries) {
            throw error;
          }

          lastError = error;
          await this.#sleep(
            getRetryDelayMs({
              attempt,
              backoffMs: this.#backoffMs,
              retryAfter:
                error instanceof HokusaiRateLimitError
                  ? error.retryAfter
                  : undefined,
            }),
          );
        } else {
          const networkError = new HokusaiNetworkError(
            'Unable to reach the Hokusai API. Check your network connection and try again.',
            {
              requestId: options.requestId,
            },
          );

          if (attempt >= this.#maxRetries) {
            throw networkError;
          }

          lastError = networkError;
          await this.#sleep(
            getRetryDelayMs({
              attempt,
              backoffMs: this.#backoffMs,
            }),
          );
        }
      }

      attempt += 1;
    }

    throw (
      lastError ??
      new HokusaiNetworkError('Hokusai API request failed.', {
        requestId: options.requestId,
      })
    );
  }

  async #executeRequest<TRequest>(options: {
    path: string;
    request: TRequest;
    requestId: string;
    signal: AbortSignal | undefined;
    transport: FetchTransport;
  }): Promise<FetchTransportResponse> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.#timeoutMs);

    const cleanup = linkAbortSignals(options.signal, controller);

    try {
      return await options.transport(buildUrl(this.#baseUrl, options.path), {
        method: 'POST',
        body: JSON.stringify(options.request),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          'X-Request-ID': options.requestId,
          'X-Hokusai-Request-Id': options.requestId,
          'X-Hokusai-Sdk-Version': this.#sdkVersion,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HokusaiNetworkError(
          'The Hokusai API request timed out before the server responded.',
          {
            requestId: options.requestId,
          },
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      cleanup();
    }
  }

  #toApiError(options: {
    parsedError: ParsedErrorBody;
    requestId: string;
    status: number;
  }): HokusaiApiError {
    const message =
      options.parsedError.message ??
      defaultErrorMessageForStatus(options.status);

    if (options.status === 401 || options.status === 403) {
      return new HokusaiAuthError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code,
      });
    }

    if (options.status === 400 || options.status === 422) {
      return new HokusaiValidationError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code,
        fieldErrors: options.parsedError.fieldErrors ?? [],
      });
    }

    if (options.status === 429) {
      return new HokusaiRateLimitError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code,
        retryAfter: options.parsedError.retryAfter,
      });
    }

    if (options.status >= 500) {
      return new HokusaiNetworkError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code,
      });
    }

    return new HokusaiApiError(message, {
      requestId: options.requestId,
      status: options.status,
      code: options.parsedError.code,
    });
  }
}

export function createGatedClient(
  options: HokusaiPluginClientOptions,
): GatedClient {
  const client = new HokusaiClient({
    ...options,
    baseUrl: options.config.apiBaseUrl,
    ...(options.config.apiKey ? { apiKey: options.config.apiKey } : {}),
  });

  return {
    client,
    async route(request, requestOptions) {
      assertCanRoute(options.config);
      return client.route(request, requestOptions);
    },
    async reportOutcome(request, requestOptions) {
      assertCanSubmitOutcome(options.config);
      return client.reportOutcome(request, requestOptions);
    },
  };
}

function buildUrl(baseUrl: URL, path: string): string {
  const resolvedBaseUrl = new URL(baseUrl.toString());
  if (!resolvedBaseUrl.pathname.endsWith('/')) {
    resolvedBaseUrl.pathname = `${resolvedBaseUrl.pathname}/`;
  }

  return new URL(path.replace(/^\/+/, ''), resolvedBaseUrl).toString();
}

function createRequestId(): string {
  const cryptoObject = Reflect.get(globalThis, 'crypto') as
    | { randomUUID?: () => string }
    | undefined;
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }

  return `hokusai-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function defaultBackoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2_000);
}

function defaultErrorMessageForStatus(status: number): string {
  if (status === 404) {
    return 'The requested Hokusai API endpoint was not found.';
  }

  if (status >= 500) {
    return 'The Hokusai API is temporarily unavailable. Try again shortly.';
  }

  return `Hokusai API request failed with status ${status}.`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getGlobalFetchTransport(): FetchTransport | undefined {
  const fetchValue = Reflect.get(globalThis, 'fetch');
  if (typeof fetchValue !== 'function') {
    return undefined;
  }

  return fetchValue;
}

function getRetryDelayMs(options: {
  attempt: number;
  backoffMs: (attempt: number) => number;
  retryAfter?: number | undefined;
}): number {
  if (options.retryAfter !== undefined) {
    return Math.min(options.retryAfter, MAX_RETRY_AFTER_MS);
  }

  return options.backoffMs(options.attempt);
}

function getTaskId(request: unknown): string {
  if (
    typeof request === 'object' &&
    request !== null &&
    'taskId' in request &&
    typeof request.taskId === 'string'
  ) {
    return request.taskId;
  }

  return '';
}

function validateSignalRequest(
  request: HokusaiSignalRequest,
): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];

  for (const field of ['kind', 'stage', 'installationId', 'occurredAt'] as const) {
    if (typeof request[field] !== 'string' || request[field].trim().length === 0) {
      errors.push({
        path: field,
        message: 'Expected a non-empty string.',
      });
    }
  }

  if (Number.isNaN(Date.parse(request.occurredAt))) {
    errors.push({
      path: 'occurredAt',
      message: 'Expected an ISO timestamp.',
    });
  }
  if (
    request.installedAt !== undefined &&
    Number.isNaN(Date.parse(request.installedAt))
  ) {
    errors.push({
      path: 'installedAt',
      message: 'Expected an ISO timestamp.',
    });
  }
  if (
    request.timeToFirstRouteMs !== undefined &&
    (!Number.isFinite(request.timeToFirstRouteMs) ||
      request.timeToFirstRouteMs < 0)
  ) {
    errors.push({
      path: 'timeToFirstRouteMs',
      message: 'Expected a non-negative finite number.',
    });
  }

  return errors;
}

function validateSignalResponse(value: unknown): HokusaiFieldError[] {
  if (
    typeof value === 'object' &&
    value !== null &&
    (!('status' in value) || value.status === 'recorded')
  ) {
    return [];
  }

  return [
    {
      path: 'status',
      message: 'Expected "recorded".',
    },
  ];
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function omitEmptySections(
  inputs: TechnicalTaskRouterRequest['inputs'],
): TechnicalTaskRouterRequest['inputs'] {
  return Object.fromEntries(
    Object.entries(inputs).filter(
      ([key, value]) =>
        key === 'task' ||
        (isPlainRecord(value) && Object.keys(value).length > 0),
    ),
  ) as TechnicalTaskRouterRequest['inputs'];
}

function firstNonEmptyString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readInteger(value: unknown): number | undefined {
  const parsed = readNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeTaskType(
  value: unknown,
  prompt: string,
): TechnicalTaskRouterTaskType {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    ['feature', 'bugfix', 'refactor', 'research', 'maintenance'].includes(
      normalized,
    )
  ) {
    return normalized as TechnicalTaskRouterTaskType;
  }
  if (['bug', 'fix'].includes(normalized)) {
    return 'bugfix';
  }
  if (['docs', 'doc', 'chore', 'infra', 'test', 'tests'].includes(normalized)) {
    return 'maintenance';
  }

  return normalizeLegacyTaskType(inferTaskType(prompt));
}

function normalizeLegacyTaskType(value: string): TechnicalTaskRouterTaskType {
  if (value === 'bugfix' || value === 'refactor') {
    return value;
  }
  if (value === 'research') {
    return 'research';
  }
  if (value === 'feature') {
    return 'feature';
  }

  return 'maintenance';
}

function normalizeRepoSizeBucket(
  value: unknown,
): NonNullable<TechnicalTaskRouterRequest['inputs']['context']>['repo_size_bucket'] {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase().replace('-', '_')
      : '';
  if (['tiny', 'small', 'medium', 'large', 'very_large'].includes(normalized)) {
    return normalized as NonNullable<
      TechnicalTaskRouterRequest['inputs']['context']
    >['repo_size_bucket'];
  }

  return undefined;
}

function normalizeRiskLevel(
  value: unknown,
): NonNullable<TechnicalTaskRouterRequest['inputs']['context']>['risk_level'] {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['low', 'medium', 'high', 'critical'].includes(normalized)) {
    return normalized as NonNullable<
      TechnicalTaskRouterRequest['inputs']['context']
    >['risk_level'];
  }

  return undefined;
}

function normalizeComplexity(
  value: unknown,
): NonNullable<TechnicalTaskRouterRequest['inputs']['context']>['estimated_complexity'] {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized as NonNullable<
      TechnicalTaskRouterRequest['inputs']['context']
    >['estimated_complexity'];
  }
  if (['shallow', 'simple'].includes(normalized)) {
    return 'low';
  }
  if (['deep', 'complex'].includes(normalized)) {
    return 'high';
  }

  return undefined;
}

function normalizeRoutingObjective(
  value: unknown,
): NonNullable<TechnicalTaskRouterRequest['inputs']['routing']>['objective'] {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    ['lowest_cost', 'fastest_completion', 'highest_reliability'].includes(
      normalized,
    )
  ) {
    return normalized as NonNullable<
      TechnicalTaskRouterRequest['inputs']['routing']
    >['objective'];
  }

  return undefined;
}

function normalizeExecutionEnvironment(
  value: unknown,
): NonNullable<TechnicalTaskRouterRequest['inputs']['workflow']>['execution_environment'] {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['local', 'ci', 'remote', 'hybrid'].includes(normalized)) {
    return normalized as NonNullable<
      TechnicalTaskRouterRequest['inputs']['workflow']
    >['execution_environment'];
  }

  return undefined;
}

function buildTechnicalTaskRouterRequest(
  request: RouteRequest,
): TechnicalTaskRouterRequest {
  const metadata = request.task.metadata ?? {};
  const modelIds = readStringList(metadata.available_models) ?? [
    request.model.id,
  ];
  const inputs: TechnicalTaskRouterRequest['inputs'] = {
    task: omitUndefined({
      description: request.prompt,
      task_type: normalizeTaskType(
        metadata.task_type ?? metadata.taskType ?? metadata.taskFamily,
        request.prompt,
      ),
      language: firstNonEmptyString(metadata.primaryLanguage, metadata.language),
      framework: firstNonEmptyString(metadata.framework, metadata.stack),
      repo_type: firstNonEmptyString(metadata.repoType, metadata.repo_type),
    }),
    routing: omitUndefined({
      available_models: modelIds,
      available_planner_models:
        readStringList(metadata.available_planner_models) ?? modelIds,
      available_coder_models:
        readStringList(metadata.available_coder_models) ?? modelIds,
      available_reviewer_models:
        readStringList(metadata.available_reviewer_models) ?? modelIds,
      preferred_models: readStringList(metadata.preferred_models),
      max_cost_usd: readNumber(metadata.max_cost_usd),
      max_latency_seconds: readNumber(metadata.max_latency_seconds),
      objective: normalizeRoutingObjective(metadata.objective),
      prioritize_quality: readBoolean(metadata.prioritize_quality),
      prioritize_speed: readBoolean(metadata.prioritize_speed),
    }),
    context: omitUndefined({
      domain: firstNonEmptyString(metadata.domain, metadata.repo),
      repo_size_bucket: normalizeRepoSizeBucket(metadata.repositoryScale),
      requires_tests: readBoolean(metadata.requires_tests) ?? inferRequiresTests(request.prompt),
      risk_level: normalizeRiskLevel(metadata.risk_level),
      file_count: readInteger(metadata.file_count),
      estimated_complexity: normalizeComplexity(
        metadata.estimated_complexity ?? metadata.complexity ?? metadata.reasoningDepth,
      ),
      security_sensitive: readBoolean(metadata.security_sensitive),
    }),
    workflow: omitUndefined({
      surface: firstNonEmptyString(metadata.surface) ?? 'hokusai-sdk',
      stages: ['plan', 'code', 'review'] as Array<'plan' | 'code' | 'review'>,
      execution_environment: normalizeExecutionEnvironment(
        metadata.execution_environment,
      ),
      human_review_required: readBoolean(metadata.human_review_required),
    }),
    metadata: omitUndefined({
      external_task_id: request.task.id,
      run_id: request.correlation.correlationId,
      integration_version: SDK_VERSION,
      idempotency_key: request.correlation.correlationId,
    }),
  };

  return { inputs: omitEmptySections(inputs) };
}

function normalizeTechnicalTaskRouterResponse(
  response: unknown,
  request: RouteRequest,
  requestId: string,
): RouteResponse {
  if (validateRouteResponse(response).length === 0) {
    return response as RouteResponse;
  }

  const responseRecord = isPlainRecord(response) ? response : {};
  const predictions = isPlainRecord(responseRecord.predictions)
    ? responseRecord.predictions
    : {};
  const recommendedStrategy = isPlainRecord(predictions.recommended_strategy)
    ? predictions.recommended_strategy
    : undefined;
  if (recommendedStrategy) {
    const model = firstString(
      recommendedStrategy.coder_model,
      recommendedStrategy.planner_model,
      recommendedStrategy.reviewer_model,
    );
    const confidence = firstNumber(recommendedStrategy.confidence);
    const reason = firstString(recommendedStrategy.rationale);
    const metadata = isPlainRecord(responseRecord.metadata)
      ? responseRecord.metadata
      : {};
    const routeId =
      firstString(
        responseRecord.inference_log_id,
        metadata.request_id,
        metadata.requestId,
      ) ?? request.correlation.correlationId;

    const normalized: RouteResponse = {
      routeId,
      taskId: request.task.id,
      status: 'accepted',
      requestId,
    };

    if (model) {
      normalized.recommendation = {
        model,
        ...(reason ? { reason } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      };
    }

    return normalized;
  }

  if (
    !('metadata' in responseRecord) &&
    !('completed_successfully' in responseRecord)
  ) {
    return response as RouteResponse;
  }

  const metadata = isPlainRecord(responseRecord.metadata)
    ? responseRecord.metadata
    : {};
  const model = firstString(
    metadata.coder_model,
    metadata.recommended_model,
    metadata.recommendedModel,
    metadata.model,
    metadata.planner_model,
    metadata.reviewer_model,
  );
  const confidence = firstNumber(metadata.confidence, metadata.score);
  const reason = firstString(metadata.reason, metadata.explanation);
  const routeId =
    firstString(
      metadata.routeId,
      metadata.route_id,
      metadata.predictionId,
      metadata.prediction_id,
      metadata.requestId,
      metadata.request_id,
    ) ?? request.correlation.correlationId;

  const normalized: RouteResponse = {
    routeId,
    taskId: request.task.id,
    status: 'accepted',
    requestId,
  };

  if (model) {
    normalized.recommendation = {
      model,
      ...(reason ? { reason } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }

  return normalized;
}

function inferRequiresTests(prompt: string): boolean {
  return /\b(test|tests|testing|spec|vitest|jest|pytest|cypress)\b/i.test(prompt);
}

function inferTaskType(prompt: string): string {
  if (/\b(migrat(?:e|ion|ing)|backfill)\b/i.test(prompt)) {
    return 'migration';
  }

  if (/\b(refactor|rename|cleanup|restructure)\b/i.test(prompt)) {
    return 'refactor';
  }

  if (/\b(test|tests|spec|coverage)\b/i.test(prompt)) {
    return 'test';
  }

  if (/\b(docs?|readme|documentation)\b/i.test(prompt)) {
    return 'docs';
  }

  if (/\b(bug|regression|failure|crash|timeout|fix)\b/i.test(prompt)) {
    return 'bugfix';
  }

  if (/\b(feature|implement|add support|enable)\b/i.test(prompt)) {
    return 'feature';
  }

  return 'chore';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return clampConfidence(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return clampConfidence(parsed);
      }
    }
  }

  return undefined;
}

function clampConfidence(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function isRetryableApiError(error: HokusaiApiError): boolean {
  if (error instanceof HokusaiRateLimitError) {
    return true;
  }

  return error instanceof HokusaiNetworkError;
}

function linkAbortSignals(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) {
    return () => {};
  }

  if (signal.aborted) {
    controller.abort();
    return () => {};
  }

  const onAbort = (): void => {
    controller.abort();
  };

  signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

function normalizeMaxRetries(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_RETRIES;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new HokusaiApiError('maxRetries must be a non-negative integer.', {
      requestId: 'configuration',
    });
  }

  return value;
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new HokusaiApiError('timeoutMs must be greater than zero.', {
      requestId: 'configuration',
    });
  }

  return value;
}

function parseApiFieldErrors(value: unknown): HokusaiFieldError[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const fieldErrors: HokusaiFieldError[] = [];
  for (const entry of value) {
    if (!isFieldErrorLike(entry)) {
      continue;
    }

    const fieldError: HokusaiFieldError = {
      path: entry.path,
      message: entry.message,
    };

    if (isFieldErrorCode(entry.code)) {
      fieldError.code = entry.code;
    }

    fieldErrors.push(fieldError);
  }

  return fieldErrors;
}

function isFieldErrorCode(value: unknown): value is HokusaiFieldError['code'] {
  return (
    value === 'invalid_type' ||
    value === 'invalid_value' ||
    value === 'required'
  );
}

function isFieldErrorLike(
  value: unknown,
): value is { code?: unknown; message: string; path: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

async function parseErrorResponse(
  response: FetchTransportResponse,
): Promise<ParsedErrorBody> {
  const rawBody = await response.text();
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

  if (rawBody.trim().length === 0) {
    return { retryAfter };
  }

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const result: ParsedErrorBody = { retryAfter };

    if (
      typeof parsed.message === 'string' &&
      parsed.message.trim().length > 0
    ) {
      result.message = parsed.message;
    } else if (
      typeof parsed.error === 'string' &&
      parsed.error.trim().length > 0
    ) {
      result.message = parsed.error;
    }

    if (typeof parsed.code === 'string' && parsed.code.trim().length > 0) {
      result.code = parsed.code;
    }

    const fieldErrors = parseApiFieldErrors(parsed.fieldErrors);
    if (fieldErrors !== undefined) {
      result.fieldErrors = fieldErrors;
    }

    return result;
  } catch {
    return {
      message: rawBody.trim(),
      retryAfter,
    };
  }
}

function parseBaseUrl(input: string): URL {
  try {
    const url = new URL(input);
    return new URL(url.toString().replace(/\/+$/, ''));
  } catch {
    throw new HokusaiApiError(
      `Invalid Hokusai base URL "${input}". Pass a full URL such as https://api.hokus.ai.`,
      {
        requestId: 'configuration',
      },
    );
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(dateMs - Date.now(), 0);
}

async function readJsonBody(
  response: FetchTransportResponse,
  requestId: string,
): Promise<unknown> {
  const rawBody = await response.text();
  if (rawBody.trim().length === 0) {
    throw new HokusaiApiError('Hokusai API returned an empty JSON response.', {
      requestId,
      status: response.status,
    });
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HokusaiApiError('Hokusai API returned malformed JSON.', {
      requestId,
      status: response.status,
    });
  }
}

function shouldRetryResponse(
  status: number,
  attempt: number,
  maxRetries: number,
): boolean {
  if (attempt >= maxRetries) {
    return false;
  }

  return status === 429 || status >= 500;
}
