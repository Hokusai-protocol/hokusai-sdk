import { redact } from './anonymization.js';

export const OUTCOME_REPORT_SCHEMA_VERSION = '1';

export const COMPLETION_STATUSES = [
  'succeeded',
  'failed',
  'abandoned',
  'overridden',
  'partial',
] as const;
export const COARSE_BUCKETS = ['low', 'medium', 'high'] as const;
export const BUILD_TEST_STATUSES = ['passed', 'failed', 'skipped'] as const;

export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];
export type CoarseBucket = (typeof COARSE_BUCKETS)[number];
export type BuildTestStatus = (typeof BUILD_TEST_STATUSES)[number];

export interface BuildSummary {
  status: BuildTestStatus;
  failures?: number;
}

export interface TestSummary {
  status: BuildTestStatus;
  failures?: number;
}

export interface OutcomeExtensions {
  version: string;
  data: Record<string, unknown>;
}

export interface OutcomeReport {
  schemaVersion: typeof OUTCOME_REPORT_SCHEMA_VERSION;
  correlationId: string;
  recommendedModel: string;
  actualModel: string;
  recommendationAccepted: boolean;
  completionStatus: CompletionStatus;
  userRating?: number;
  latencyBucket: CoarseBucket;
  costBucket: CoarseBucket;
  tokenBucket: CoarseBucket;
  build?: BuildSummary;
  test?: TestSummary;
  notes?: string;
  extensions?: OutcomeExtensions;
}

export type OutcomeReportInput = Omit<OutcomeReport, 'schemaVersion'> & {
  redactionSalt?: string;
};

export interface OutcomeValidationError {
  path: string;
  message: string;
}

type OutcomeReportKey = keyof OutcomeReport;
type BuildSummaryKey = keyof BuildSummary;
type TestSummaryKey = keyof TestSummary;
type OutcomeExtensionsKey = keyof OutcomeExtensions;
type OutcomeCandidate = Partial<Record<OutcomeReportKey, unknown>>;

const OUTCOME_REPORT_KEYS = [
  'schemaVersion',
  'correlationId',
  'recommendedModel',
  'actualModel',
  'recommendationAccepted',
  'completionStatus',
  'userRating',
  'latencyBucket',
  'costBucket',
  'tokenBucket',
  'build',
  'test',
  'notes',
  'extensions',
] as const satisfies readonly OutcomeReportKey[];

const BUILD_SUMMARY_KEYS = [
  'status',
  'failures',
] as const satisfies readonly BuildSummaryKey[];

const TEST_SUMMARY_KEYS = [
  'status',
  'failures',
] as const satisfies readonly TestSummaryKey[];

const OUTCOME_EXTENSION_KEYS = [
  'version',
  'data',
] as const satisfies readonly OutcomeExtensionsKey[];

const OUTCOME_REPORT_KEY_SET = new Set<string>(OUTCOME_REPORT_KEYS);
const BUILD_SUMMARY_KEY_SET = new Set<string>(BUILD_SUMMARY_KEYS);
const TEST_SUMMARY_KEY_SET = new Set<string>(TEST_SUMMARY_KEYS);
const OUTCOME_EXTENSION_KEY_SET = new Set<string>(OUTCOME_EXTENSION_KEYS);
const DEFAULT_OUTCOME_NOTES_REDACTION_SALT = 'hokusai-outcome-notes';

export class OutcomeReportBuildError extends Error {
  readonly errors: OutcomeValidationError[];

  constructor(message: string, errors: OutcomeValidationError[]) {
    super(message);
    this.name = 'OutcomeReportBuildError';
    this.errors = errors;
  }
}

export function validateOutcomeReport(
  input: unknown,
): OutcomeValidationError[] {
  if (!isPlainObject(input)) {
    return [
      {
        path: '$',
        message: 'Outcome report must be a non-null object.',
      },
    ];
  }

  const errors: OutcomeValidationError[] = [];

  for (const key of Object.keys(input)) {
    if (!OUTCOME_REPORT_KEY_SET.has(key)) {
      errors.push({
        path: key,
        message: `Unknown field "${key}" is not allowed in outcome reports.`,
      });
    }
  }

  validateLiteralString(
    input.schemaVersion,
    'schemaVersion',
    OUTCOME_REPORT_SCHEMA_VERSION,
    errors,
  );
  validateNonEmptyString(input.correlationId, 'correlationId', errors);
  validateNonEmptyString(input.recommendedModel, 'recommendedModel', errors);
  validateNonEmptyString(input.actualModel, 'actualModel', errors);
  validateBoolean(
    input.recommendationAccepted,
    'recommendationAccepted',
    errors,
  );
  validateEnum(
    input.completionStatus,
    'completionStatus',
    COMPLETION_STATUSES,
    errors,
  );

  if (input.userRating !== undefined) {
    validateIntegerInRange(input.userRating, 'userRating', 1, 5, errors);
  }

  validateEnum(input.latencyBucket, 'latencyBucket', COARSE_BUCKETS, errors);
  validateEnum(input.costBucket, 'costBucket', COARSE_BUCKETS, errors);
  validateEnum(input.tokenBucket, 'tokenBucket', COARSE_BUCKETS, errors);

  if (input.build !== undefined) {
    validateSummary(
      input.build,
      'build',
      BUILD_SUMMARY_KEY_SET,
      BUILD_TEST_STATUSES,
      errors,
    );
  }

  if (input.test !== undefined) {
    validateSummary(
      input.test,
      'test',
      TEST_SUMMARY_KEY_SET,
      BUILD_TEST_STATUSES,
      errors,
    );
  }

  if (input.notes !== undefined && typeof input.notes !== 'string') {
    errors.push({
      path: 'notes',
      message: '"notes" must be a string.',
    });
  }

  if (input.extensions !== undefined) {
    validateExtensions(input.extensions, 'extensions', errors);
  }

  return errors;
}

export function buildOutcomeReport(input: OutcomeReportInput): OutcomeReport {
  const candidate = createOutcomeCandidate(input);
  const errors = validateOutcomeReport(candidate);

  if (errors.length > 0) {
    throw new OutcomeReportBuildError(
      formatBuildErrorMessage(errors),
      errors,
    );
  }

  return candidate as OutcomeReport;
}

export function previewOutcomePayload(
  input: OutcomeReportInput,
): OutcomeReport {
  return buildOutcomeReport(input);
}

function createOutcomeCandidate(input: OutcomeReportInput): OutcomeCandidate {
  const candidate = {
    ...input,
    schemaVersion: OUTCOME_REPORT_SCHEMA_VERSION,
  } as Record<string, unknown>;

  delete candidate.redactionSalt;

  if (input.build !== undefined) {
    candidate.build = { ...input.build };
  } else {
    delete candidate.build;
  }

  if (input.test !== undefined) {
    candidate.test = { ...input.test };
  } else {
    delete candidate.test;
  }

  if (input.extensions !== undefined) {
    candidate.extensions = {
      version: input.extensions.version,
      data: isPlainObject(input.extensions.data)
        ? { ...input.extensions.data }
        : input.extensions.data,
    };
  } else {
    delete candidate.extensions;
  }

  if (typeof input.notes === 'string' && input.notes.length > 0) {
    candidate.notes = redact(input.notes, {
      salt: input.redactionSalt ?? DEFAULT_OUTCOME_NOTES_REDACTION_SALT,
      email: true,
      url: true,
      secret: true,
      token: true,
      credential: true,
      hostname: true,
      org: true,
      id: true,
      code: true,
      log: true,
      customRules: [
        {
          category: 'id',
          pattern: /\/(?:Users|home|tmp|var|opt|srv|etc|private)\/[^\s]+/g,
        },
      ],
    }).output;
  } else if (input.notes === undefined) {
    delete candidate.notes;
  }

  if (input.userRating === undefined) {
    delete candidate.userRating;
  }

  return candidate;
}

function validateSummary(
  value: unknown,
  path: string,
  knownKeys: ReadonlySet<string>,
  statuses: readonly BuildTestStatus[],
  errors: OutcomeValidationError[],
): void {
  if (!isPlainObject(value)) {
    errors.push({
      path,
      message: `"${path}" must be an object.`,
    });
    return;
  }

  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) {
      errors.push({
        path: `${path}.${key}`,
        message: `Unknown field "${key}" is not allowed in "${path}".`,
      });
    }
  }

  validateEnum(value.status, `${path}.status`, statuses, errors);

  if (value.failures !== undefined) {
    validateNonNegativeInteger(value.failures, `${path}.failures`, errors);
  }
}

function validateExtensions(
  value: unknown,
  path: string,
  errors: OutcomeValidationError[],
): void {
  if (!isPlainObject(value)) {
    errors.push({
      path,
      message: `"${path}" must be an object.`,
    });
    return;
  }

  for (const key of Object.keys(value)) {
    if (!OUTCOME_EXTENSION_KEY_SET.has(key)) {
      errors.push({
        path: `${path}.${key}`,
        message: `Unknown field "${key}" is not allowed in "${path}".`,
      });
    }
  }

  validateNonEmptyString(value.version, `${path}.version`, errors);

  if (!isPlainObject(value.data)) {
    errors.push({
      path: `${path}.data`,
      message: `"${path}.data" must be an object.`,
    });
  }
}

function validateLiteralString(
  value: unknown,
  path: string,
  expected: string,
  errors: OutcomeValidationError[],
): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({
      path,
      message: `Expected "${path}" to be "${expected}".`,
    });
    return;
  }

  if (value !== expected) {
    errors.push({
      path,
      message: `Unsupported schema version "${value}". Expected "${expected}".`,
    });
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  errors: OutcomeValidationError[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({
      path,
      message: `"${path}" must be a non-empty string.`,
    });
  }
}

function validateBoolean(
  value: unknown,
  path: string,
  errors: OutcomeValidationError[],
): void {
  if (typeof value !== 'boolean') {
    errors.push({
      path,
      message: `"${path}" must be a boolean.`,
    });
  }
}

function validateEnum<T extends readonly string[]>(
  value: unknown,
  path: string,
  allowedValues: T,
  errors: OutcomeValidationError[],
): void {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    errors.push({
      path,
      message: `"${path}" must be one of: ${allowedValues.join(', ')}.`,
    });
  }
}

function validateIntegerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: OutcomeValidationError[],
): void {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    errors.push({
      path,
      message: `"${path}" must be an integer between ${min} and ${max}.`,
    });
  }
}

function validateNonNegativeInteger(
  value: unknown,
  path: string,
  errors: OutcomeValidationError[],
): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    errors.push({
      path,
      message: `"${path}" must be a non-negative integer.`,
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatBuildErrorMessage(errors: OutcomeValidationError[]): string {
  return `Invalid outcome report: ${errors
    .map(({ path, message }) => `${path || '$'}: ${message}`)
    .join('; ')}`;
}
