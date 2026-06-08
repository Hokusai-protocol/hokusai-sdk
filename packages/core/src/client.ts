import { anonymizeText, type AnonymizationOptions } from './anonymization.js';
import {
  isConsentGranted,
  type ConsentConfig,
  type ConsentScope,
} from './consent.js';
import {
  type HokusaiDispatchPayload,
  type HokusaiFieldError,
  type HokusaiTaskInput,
  type HokusaiValidationSuccess,
  type OutcomeReport,
  type OutcomeResponse,
  type RouteRequest,
  type RouteResponse,
  validateOutcomeReport,
  validateOutcomeResponse,
  validateRouteRequest,
  validateRouteResponse,
} from './schemas.js';
import {
  type ModelDefinition,
  type ModelRegistry,
  type ModelSelection,
} from './model-registry.js';
import {
  InMemoryCorrelationStorage,
  type CorrelationRecord,
  type CorrelationStorage,
} from './storage.js';

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 5_000;
const ROUTE_PATH = '/v1/route';
const OUTCOME_PATH = '/v1/outcomes';
const SDK_VERSION = '0.1.0';

export const DEFAULT_HOKUSAI_BASE_URL = 'https://api.hokusai.app';

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
  modelRegistry: ModelRegistry;
  storage?: CorrelationStorage;
  clock?: () => Date;
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
  readonly #clock: () => Date;
  readonly #consent: ConsentConfig;
  readonly #modelRegistry: ModelRegistry;
  readonly #storage: CorrelationStorage;

  constructor(options: HokusaiDispatchBuilderOptions) {
    this.#consent = options.consent;
    this.#anonymization = options.anonymization;
    this.#modelRegistry = options.modelRegistry;
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
    const correlationRecord = await this.#getOrCreateCorrelationRecord(task.id);
    const anonymizedPrompt = anonymizeText(
      task.prompt,
      this.#anonymization ?? {},
    );

    return {
      task,
      consent: {
        grantedScopes: [...this.#consent.grantedScopes],
        subjectId: this.#consent.subjectId,
      },
      model: this.#toModelSelection(model),
      correlation: correlationRecord,
      prompt: anonymizedPrompt.text,
      redactions: anonymizedPrompt.redactions,
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
  ): Promise<RouteResponse | HokusaiValidationSuccess<RouteRequest>> {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateRouteRequest(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError('Route request validation failed.', {
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

    return this.#send<RouteRequest, RouteResponse>({
      path: ROUTE_PATH,
      request,
      requestId,
      requestOptions: options,
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
          const fieldErrors = options.responseValidator(body);
          if (fieldErrors.length > 0) {
            throw new HokusaiApiError(options.responseErrorMessage, {
              requestId: headerRequestId,
              status: response.status,
            });
          }

          const responseObject = body as TResponse;
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
      `Invalid Hokusai base URL "${input}". Pass a full URL such as https://api.hokusai.app.`,
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
