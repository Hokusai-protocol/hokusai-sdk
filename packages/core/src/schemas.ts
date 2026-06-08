import type { ConsentSnapshot } from './consent.js';
import type { ModelSelection } from './model-registry.js';
import type { RedactionRecord } from './anonymization.js';
import type { CorrelationRecord } from './storage.js';
export type {
  BuildSummary,
  CoarseBucket,
  CompletionStatus,
  OutcomeExtensions,
  OutcomeReport,
  OutcomeReportInput,
  OutcomeValidationError,
  TestSummary,
} from './outcome.js';
import { validateOutcomeReport as validateNormalizedOutcomeReport } from './outcome.js';

export interface HokusaiTaskInput {
  id: string;
  prompt: string;
  metadata?: Record<string, string>;
}

export interface HokusaiOutcome {
  taskId: string;
  status: 'accepted' | 'completed' | 'failed';
  /**
   * Builders should pass user-visible summaries through redact() before
   * constructing outcome packets when the reusable redaction engine is enabled.
   */
  summary: string;
  redactions?: RedactionRecord[];
}

export interface HokusaiDispatchPayload {
  task: HokusaiTaskInput;
  prompt: string;
  consent: ConsentSnapshot;
  model: ModelSelection;
  correlation: CorrelationRecord;
  /** Redaction records — original sensitive values are never included. */
  redactions: Array<{ label: string } | RedactionRecord>;
  createdAt: string;
}

export type RouteRequest = HokusaiDispatchPayload;

export interface RouteResponse {
  routeId: string;
  taskId: string;
  status: 'accepted';
  requestId?: string | undefined;
}

export type OutcomeResponseStatus = 'accepted' | 'recorded';

export interface OutcomeResponse {
  taskId: string;
  status: OutcomeResponseStatus;
  requestId?: string | undefined;
}

export type HokusaiFieldErrorCode =
  | 'invalid_type'
  | 'invalid_value'
  | 'required';

export interface HokusaiFieldError {
  path: string;
  message: string;
  code?: HokusaiFieldErrorCode | undefined;
}

export interface HokusaiValidationSuccess<TRequest> {
  ok: true;
  request: TRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pushFieldError(
  errors: HokusaiFieldError[],
  path: string,
  message: string,
  code: HokusaiFieldErrorCode,
): void {
  errors.push({ path, message, code });
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (typeof value !== 'string') {
    pushFieldError(errors, path, 'Expected a string.', 'invalid_type');
    return;
  }

  if (value.trim().length === 0) {
    pushFieldError(errors, path, 'Value must not be empty.', 'required');
  }
}

function validateStringRecord(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (!isRecord(value)) {
    pushFieldError(errors, path, 'Expected an object.', 'invalid_type');
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      pushFieldError(
        errors,
        `${path}.${key}`,
        'Expected a string value.',
        'invalid_type',
      );
    }
  }
}

function validateTaskInput(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (!isRecord(value)) {
    pushFieldError(errors, path, 'Expected an object.', 'invalid_type');
    return;
  }

  validateNonEmptyString(value.id, `${path}.id`, errors);
  validateNonEmptyString(value.prompt, `${path}.prompt`, errors);

  if ('metadata' in value && value.metadata !== undefined) {
    validateStringRecord(value.metadata, `${path}.metadata`, errors);
  }
}

function validateConsentSnapshot(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (!isRecord(value)) {
    pushFieldError(errors, path, 'Expected an object.', 'invalid_type');
    return;
  }

  validateNonEmptyString(value.subjectId, `${path}.subjectId`, errors);

  if (!Array.isArray(value.grantedScopes)) {
    pushFieldError(
      errors,
      `${path}.grantedScopes`,
      'Expected an array of consent scopes.',
      'invalid_type',
    );
    return;
  }

  value.grantedScopes.forEach((scope, index) => {
    validateNonEmptyString(scope, `${path}.grantedScopes.${index}`, errors);
  });
}

function validateModelSelection(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (!isRecord(value)) {
    pushFieldError(errors, path, 'Expected an object.', 'invalid_type');
    return;
  }

  validateNonEmptyString(value.id, `${path}.id`, errors);
  validateNonEmptyString(value.provider, `${path}.provider`, errors);

  if (!Array.isArray(value.capabilities)) {
    pushFieldError(
      errors,
      `${path}.capabilities`,
      'Expected an array of capabilities.',
      'invalid_type',
    );
    return;
  }

  value.capabilities.forEach((capability, index) => {
    validateNonEmptyString(capability, `${path}.capabilities.${index}`, errors);
  });
}

function validateCorrelationRecord(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (!isRecord(value)) {
    pushFieldError(errors, path, 'Expected an object.', 'invalid_type');
    return;
  }

  validateNonEmptyString(value.taskId, `${path}.taskId`, errors);
  validateNonEmptyString(value.correlationId, `${path}.correlationId`, errors);
  validateNonEmptyString(value.createdAt, `${path}.createdAt`, errors);
}

function validateRedactions(
  value: unknown,
  path: string,
  errors: HokusaiFieldError[],
): void {
  if (!Array.isArray(value)) {
    pushFieldError(
      errors,
      path,
      'Expected an array of redactions.',
      'invalid_type',
    );
    return;
  }

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      pushFieldError(
        errors,
        `${path}.${index}`,
        'Expected an object.',
        'invalid_type',
      );
      return;
    }

    if ('label' in entry) {
      validateNonEmptyString(entry.label, `${path}.${index}.label`, errors);
      return;
    }

    validateNonEmptyString(entry.category, `${path}.${index}.category`, errors);
    validateNonEmptyString(
      entry.placeholder,
      `${path}.${index}.placeholder`,
      errors,
    );

    if (typeof entry.count !== 'number') {
      pushFieldError(
        errors,
        `${path}.${index}.count`,
        'Expected a number.',
        'invalid_type',
      );
    }
  });
}

export function validateRouteRequest(request: unknown): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];

  if (!isRecord(request)) {
    return [
      {
        path: '$',
        message: 'Expected a route request object.',
        code: 'invalid_type',
      },
    ];
  }

  validateTaskInput(request.task, 'task', errors);
  validateNonEmptyString(request.prompt, 'prompt', errors);
  validateConsentSnapshot(request.consent, 'consent', errors);
  validateModelSelection(request.model, 'model', errors);
  validateCorrelationRecord(request.correlation, 'correlation', errors);
  validateRedactions(request.redactions, 'redactions', errors);
  validateNonEmptyString(request.createdAt, 'createdAt', errors);

  return errors;
}

export function validateOutcomeReport(request: unknown): HokusaiFieldError[] {
  return validateNormalizedOutcomeReport(request).map((error) => ({
    path: error.path,
    message: error.message,
  }));
}

export function validateRouteResponse(response: unknown): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];

  if (!isRecord(response)) {
    return [
      {
        path: '$',
        message: 'Expected a route response object.',
        code: 'invalid_type',
      },
    ];
  }

  validateNonEmptyString(response.routeId, 'routeId', errors);
  validateNonEmptyString(response.taskId, 'taskId', errors);

  if (response.status !== 'accepted') {
    pushFieldError(errors, 'status', 'Expected accepted.', 'invalid_value');
  }

  if ('requestId' in response && response.requestId !== undefined) {
    validateNonEmptyString(response.requestId, 'requestId', errors);
  }

  return errors;
}

export function validateOutcomeResponse(
  response: unknown,
): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];

  if (!isRecord(response)) {
    return [
      {
        path: '$',
        message: 'Expected an outcome response object.',
        code: 'invalid_type',
      },
    ];
  }

  validateNonEmptyString(response.taskId, 'taskId', errors);

  if (response.status !== 'accepted' && response.status !== 'recorded') {
    pushFieldError(
      errors,
      'status',
      'Expected accepted or recorded.',
      'invalid_value',
    );
  }

  if ('requestId' in response && response.requestId !== undefined) {
    validateNonEmptyString(response.requestId, 'requestId', errors);
  }

  return errors;
}
