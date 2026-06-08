import { anonymizeText, type AnonymizationOptions } from './anonymization.js';
import {
  isConsentGranted,
  type ConsentConfig,
  type ConsentScope,
} from './consent.js';
import {
  validateRouteRequest,
  validateRouteResponse,
  validateOutcomeRequest,
  validateOutcomeResponse,
  type HokusaiDispatchPayload,
  type HokusaiTaskInput,
  type RouteRequest,
  type RouteResponse,
  type OutcomeRequest,
  type OutcomeResponse,
  type DryRunDescriptor,
  type HokusaiValidationIssue,
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

// Kept in sync with packages/core/package.json — guarded by test assertion
const SDK_VERSION = '0.1.0';

const DEFAULT_BASE_URL = 'https://api.hokusai.dev';
const ROUTE_PATH = '/v1/route';
const OUTCOME_PATH = '/v1/outcomes';
const DEFAULT_MAX_RETRIES = 2;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// --- Transport ---

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

// --- Error types ---

export type HokusaiErrorCode =
  | 'missing_api_key'
  | 'invalid_base_url'
  | 'invalid_request'
  | 'invalid_response'
  | 'network_error'
  | 'api_error'
  | 'auth_error';

export class HokusaiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HokusaiClientError';
  }
}

export class HokusaiError extends HokusaiClientError {
  readonly code: HokusaiErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(
    message: string,
    code: HokusaiErrorCode,
    options?: {
      status?: number;
      requestId?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'HokusaiError';
    this.code = code;
    this.status = options?.status;
    this.requestId = options?.requestId;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        writable: true,
        configurable: true,
      });
    }
  }
}

export class HokusaiAuthError extends HokusaiError {
  constructor(
    message: string,
    options?: {
      code?: Extract<HokusaiErrorCode, 'auth_error' | 'missing_api_key'>;
      status?: number;
      requestId?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.code ?? 'auth_error', buildErrorOptions(options));
    this.name = 'HokusaiAuthError';
  }
}

export class HokusaiValidationError extends HokusaiError {
  readonly issues: HokusaiValidationIssue[] | undefined;

  constructor(
    message: string,
    code: Extract<
      HokusaiErrorCode,
      'invalid_request' | 'invalid_response' | 'invalid_base_url'
    >,
    options?: {
      status?: number;
      requestId?: string;
      details?: unknown;
      cause?: unknown;
      issues?: HokusaiValidationIssue[];
    },
  ) {
    super(message, code, buildErrorOptions(options));
    this.name = 'HokusaiValidationError';
    this.issues = options?.issues;
  }
}

export class HokusaiNetworkError extends HokusaiError {
  constructor(
    message: string,
    options?: {
      requestId?: string;
      cause?: unknown;
    },
  ) {
    super(message, 'network_error', buildErrorOptions(options));
    this.name = 'HokusaiNetworkError';
  }
}

export class HokusaiApiError extends HokusaiError {
  constructor(
    message: string,
    options?: {
      code?: Extract<HokusaiErrorCode, 'api_error' | 'invalid_response'>;
      status?: number;
      requestId?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.code ?? 'api_error', buildErrorOptions(options));
    this.name = 'HokusaiApiError';
  }
}

// --- Client options ---

export interface HokusaiClientOptions {
  consent?: ConsentConfig;
  anonymization?: AnonymizationOptions;
  modelRegistry?: ModelRegistry;
  storage?: CorrelationStorage;
  clock?: () => Date;
  apiKey?: string;
  baseUrl?: string;
  transport?: FetchLike;
  maxRetries?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  requestIdFactory?: () => string;
  backoffMs?: (attempt: number) => number;
}

// Per-call options for route() and reportOutcome()
export interface ApiCallOptions {
  dryRun?: boolean;
}

// --- HokusaiClient ---

export class HokusaiClient {
  readonly #consent: ConsentConfig | undefined;
  readonly #anonymization: AnonymizationOptions | undefined;
  readonly #modelRegistry: ModelRegistry | undefined;
  readonly #storage: CorrelationStorage;
  readonly #clock: () => Date;
  readonly #apiKey: string | undefined;
  readonly #normalizedBaseUrl: string;
  readonly #transport: FetchLike;
  readonly #maxRetries: number;
  readonly #dryRun: boolean;
  readonly #requestIdFactory: () => string;
  readonly #backoffMs: (attempt: number) => number;

  constructor(options: HokusaiClientOptions) {
    this.#consent = options.consent;
    this.#anonymization = options.anonymization;
    this.#modelRegistry = options.modelRegistry;
    this.#storage = options.storage ?? new InMemoryCorrelationStorage();
    this.#clock = options.clock ?? (() => new Date());
    this.#apiKey = options.apiKey;
    this.#normalizedBaseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#transport = options.transport ?? defaultTransport;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#dryRun = options.dryRun ?? false;
    this.#requestIdFactory = options.requestIdFactory ?? generateRequestId;
    this.#backoffMs =
      options.backoffMs ??
      ((attempt: number) => Math.min(100 * Math.pow(2, attempt), 5000));
  }

  // --- Offline dispatch (existing behavior preserved) ---

  async prepareDispatch(
    task: HokusaiTaskInput,
    modelId: string,
    scope: ConsentScope = 'task-execution',
  ): Promise<HokusaiDispatchPayload> {
    if (this.#consent === undefined) {
      throw new HokusaiClientError(
        'consent is required for prepareDispatch. Pass consent in HokusaiClientOptions.',
      );
    }
    if (this.#modelRegistry === undefined) {
      throw new HokusaiClientError(
        'modelRegistry is required for prepareDispatch. Pass modelRegistry in HokusaiClientOptions.',
      );
    }
    if (!isConsentGranted(this.#consent, scope)) {
      throw new HokusaiClientError(
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

  // --- Network API methods ---

  async route(
    request: RouteRequest,
    options?: ApiCallOptions,
  ): Promise<RouteResponse | DryRunDescriptor> {
    const validated = validateRouteRequest(request);
    if (Array.isArray(validated)) {
      throw new HokusaiValidationError(
        `Invalid route request: ${validated.map((i) => i.message).join(', ')}`,
        'invalid_request',
        { issues: validated },
      );
    }

    const requestId = this.#requestIdFactory();
    const dryRun = options?.dryRun ?? this.#dryRun;

    if (dryRun) {
      return this.#buildDryRunDescriptor('POST', ROUTE_PATH, validated, requestId);
    }

    return this.#executeWithRetry(
      'POST',
      ROUTE_PATH,
      validated,
      validateRouteResponse,
      requestId,
      'route',
    );
  }

  async reportOutcome(
    request: OutcomeRequest,
    options?: ApiCallOptions,
  ): Promise<OutcomeResponse | DryRunDescriptor> {
    const validated = validateOutcomeRequest(request);
    if (Array.isArray(validated)) {
      throw new HokusaiValidationError(
        `Invalid outcome request: ${validated.map((i) => i.message).join(', ')}`,
        'invalid_request',
        { issues: validated },
      );
    }

    const requestId = this.#requestIdFactory();
    const dryRun = options?.dryRun ?? this.#dryRun;

    if (dryRun) {
      return this.#buildDryRunDescriptor('POST', OUTCOME_PATH, validated, requestId);
    }

    return this.#executeWithRetry(
      'POST',
      OUTCOME_PATH,
      validated,
      validateOutcomeResponse,
      requestId,
      'reportOutcome',
    );
  }

  // --- Private helpers ---

  #resolveModel(modelId: string): ModelDefinition {
    const model = this.#modelRegistry?.get(modelId);
    if (!model) {
      throw new HokusaiClientError(`Unknown model "${modelId}".`);
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

  async #getOrCreateCorrelationRecord(taskId: string): Promise<CorrelationRecord> {
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

  #buildHeaders(requestId: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Request-Id': requestId,
      'X-Hokusai-SDK-Version': SDK_VERSION,
    };
    if (this.#apiKey !== undefined) {
      headers['Authorization'] = `Bearer ${this.#apiKey}`;
    }
    return headers;
  }

  #buildDryRunDescriptor(
    method: string,
    path: string,
    body: unknown,
    requestId: string,
  ): DryRunDescriptor {
    const url = `${this.#normalizedBaseUrl}${path}`;
    const headers = this.#buildHeaders(requestId);
    // Always redact the authorization value in dry-run output
    const safeHeaders = { ...headers };
    if ('Authorization' in safeHeaders) {
      safeHeaders['Authorization'] = '[redacted]';
    }
    return {
      dryRun: true,
      method,
      url,
      headers: safeHeaders,
      body: JSON.stringify(body),
    };
  }

  #getRetryDelay(response: Response, attempt: number): number {
    const retryAfterHeader = response.headers.get('Retry-After');
    if (retryAfterHeader !== null) {
      const seconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
    return this.#backoffMs(attempt);
  }

  async #executeWithRetry<T>(
    method: string,
    path: string,
    body: unknown,
    validate: (v: unknown) => T | HokusaiValidationIssue[],
    requestId: string,
    operationName: string,
  ): Promise<T> {
    if (this.#apiKey === undefined) {
      throw new HokusaiAuthError(
        `API key is required for ${operationName}. Pass apiKey in the client options.`,
        { code: 'missing_api_key', requestId },
      );
    }

    const url = `${this.#normalizedBaseUrl}${path}`;
    const headers = this.#buildHeaders(requestId);
    const bodyStr = JSON.stringify(body);

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      let response: Response;
      try {
        response = await this.#transport(url, {
          method,
          headers,
          body: bodyStr,
        });
      } catch (networkErr) {
        lastError = networkErr;
        if (attempt < this.#maxRetries) {
          await sleep(this.#backoffMs(attempt));
        }
        continue;
      }

      const responseRequestId =
        response.headers.get('X-Request-Id') ?? requestId;

      // Non-retryable auth errors
      if (response.status === 401 || response.status === 403) {
        throw new HokusaiAuthError(
          `Authentication failed (HTTP ${response.status}). Verify your API key is valid.`,
          { status: response.status, requestId: responseRequestId },
        );
      }

      // Non-retryable 422 validation errors
      if (response.status === 422) {
        let details: unknown;
        try {
          details = await response.json();
        } catch {
          // ignore JSON parse failure for error body
        }
        throw new HokusaiValidationError(
          `Request validation failed (HTTP 422).`,
          'invalid_request',
          { status: 422, requestId: responseRequestId, details },
        );
      }

      // Non-retryable other 4xx errors
      if (response.status >= 400 && !RETRYABLE_STATUSES.has(response.status)) {
        let details: unknown;
        try {
          details = await response.json();
        } catch {
          // ignore
        }
        throw new HokusaiApiError(
          `API request failed (HTTP ${response.status}).`,
          { status: response.status, requestId: responseRequestId, details },
        );
      }

      // Retryable server errors (429, 500, 502, 503, 504)
      if (RETRYABLE_STATUSES.has(response.status)) {
        if (attempt < this.#maxRetries) {
          const delay = this.#getRetryDelay(response, attempt);
          await sleep(delay);
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        throw new HokusaiApiError(
          `API error (HTTP ${response.status}) after ${this.#maxRetries + 1} attempt(s).`,
          { status: response.status, requestId: responseRequestId },
        );
      }

      // 204 No Content — treat as acknowledged ack
      if (response.status === 204) {
        const ackBody: unknown = { taskId: '', routingId: '', acknowledged: true };
        const validated = validate(ackBody);
        if (!Array.isArray(validated)) {
          return validated;
        }
        return ackBody as T;
      }

      // Parse JSON success response
      let json: unknown;
      try {
        json = await response.json();
      } catch (parseErr) {
        throw new HokusaiApiError(`Failed to parse API response body.`, {
          status: response.status,
          requestId: responseRequestId,
          cause: parseErr,
        });
      }

      const validated = validate(json);
      if (Array.isArray(validated)) {
        throw new HokusaiApiError(`API response did not match expected schema.`, {
          code: 'invalid_response',
          status: response.status,
          requestId: responseRequestId,
          details: validated,
        });
      }

      return validated;
    }

    // All retries exhausted due to network errors
    throw new HokusaiNetworkError(
      `Network request failed for ${operationName} after ${this.#maxRetries + 1} attempt(s).`,
      { requestId, cause: lastError },
    );
  }
}

// --- Module-level helpers ---

// Builds HokusaiError constructor options without explicit `undefined` properties,
// which is required for exactOptionalPropertyTypes compatibility.
function buildErrorOptions(src?: {
  status?: number;
  requestId?: string;
  details?: unknown;
  cause?: unknown;
}): {
  status?: number;
  requestId?: string;
  details?: unknown;
  cause?: unknown;
} {
  const opts: {
    status?: number;
    requestId?: string;
    details?: unknown;
    cause?: unknown;
  } = {};
  if (src?.status !== undefined) opts.status = src.status;
  if (src?.requestId !== undefined) opts.requestId = src.requestId;
  if (src !== undefined && 'details' in src && src.details !== undefined)
    opts.details = src.details;
  if (src?.cause !== undefined) opts.cause = src.cause;
  return opts;
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HokusaiValidationError(
      `Invalid base URL "${raw}". Provide a valid http/https URL.`,
      'invalid_base_url',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HokusaiValidationError(
      `Invalid base URL "${raw}". Only http and https are supported.`,
      'invalid_base_url',
    );
  }
  // Remove trailing slash so path concatenation is predictable
  return url.origin + url.pathname.replace(/\/$/, '');
}

function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  const ts = new Date().getTime().toString(36);
  const rand = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `req-${ts}-${rand}`;
}

function defaultTransport(input: string, init?: RequestInit): Promise<Response> {
  if (typeof globalThis.fetch !== 'function') {
    throw new HokusaiNetworkError(
      'No fetch implementation available. Pass a transport function in HokusaiClientOptions.',
    );
  }
  return globalThis.fetch(input, init);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export { SDK_VERSION, ROUTE_PATH, OUTCOME_PATH };
