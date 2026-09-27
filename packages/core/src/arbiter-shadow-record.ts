/**
 * Arbiter shadow-mode wire contracts and validators (HOK-2820).
 *
 * Three frozen record schemas:
 * - `arbiter_shadow_score/v1`: one per merged PR, recording the scorer's estimate
 * - `arbiter_shadow_outcome/v1`: one per scored PR per horizon, after it has matured
 * - `arbiter_shadow_state/v1`: cursor and run metadata, one per (repo, scorer)
 *
 * All records are append-only JSONL. Validators reject raw content and enforce
 * referential integrity (e.g., would_flag === score < threshold).
 */

import type { HokusaiFieldError } from './schemas.js';
import type { ArbiterSurvivalLabelV1, HorizonDays } from './arbiter-survival-label.js';
import { HORIZONS, ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION } from './arbiter-survival-label.js';
import { validateCandidateFeaturesV1 } from './candidate-features.js';
import type { CandidateFeaturesV1 } from './candidate-features.js';

/** Schema version constants. */
export const ARBITER_SHADOW_SCORE_SCHEMA_VERSION = 'arbiter_shadow_score/v1' as const;
export const ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION = 'arbiter_shadow_outcome/v1' as const;
export const ARBITER_SHADOW_STATE_SCHEMA_VERSION = 'arbiter_shadow_state/v1' as const;

/** Run status enum. */
export const ARBITER_SHADOW_RUN_STATUSES = ['ok', 'partial', 'error'] as const;
export type ArbiterShadowRunStatus = (typeof ARBITER_SHADOW_RUN_STATUSES)[number];

/** Error codes — closed set used by state and CLI. */
export const ARBITER_SHADOW_ERROR_CODES = [
  'INVALID_ARG',
  'NOT_A_GIT_REPO',
  'SHALLOW_CLONE',
  'DATA_DIR_UNWRITABLE',
  'STATE_CORRUPT',
  'CURSOR_RESET',
  'EXTRACT_FAILED',
  'LABEL_FAILED',
  'INVALID_ROW',
  'INTERNAL',
] as const;
export type ArbiterShadowErrorCode = (typeof ARBITER_SHADOW_ERROR_CODES)[number];

/** Raw-content keys to reject at any depth. */
export const ARBITER_SHADOW_FORBIDDEN_KEYS = new Set([
  // Core raw-content names
  'rawTaskText',
  'rawCode',
  'rawLog',
  'prompt',
  'rawPrompt',
  'rawContent',
  // Additional forbidden keys for shadow mode
  'diff',
  'patch',
  'body',
  'title',
  'commit_message',
  'author_email',
  'line_ranges',
  'path',
]);

/** Outcome label: omit line_ranges and owner_correction for privacy. */
export type ArbiterShadowLabel = Omit<ArbiterSurvivalLabelV1, 'line_ranges' | 'owner_correction'>;

/** Score row: one per merged PR. */
export interface ArbiterShadowScoreV1 {
  schema_version: typeof ARBITER_SHADOW_SCORE_SCHEMA_VERSION;
  repo: string; // owner/name
  pr_number: number | null; // int > 0 or null
  merge_sha: string; // 40 lowercase hex
  merged_at: string; // ISO 8601
  scored_at: string; // ISO 8601
  scorer_id: string;
  scorer_version: string;
  score: number; // [0, 1]
  threshold: number; // [0, 1]
  would_flag: boolean; // score < threshold
  features: CandidateFeaturesV1;
}

/** Outcome row: one per (repo, pr_number, merge_sha, horizon_days) after maturity. */
export interface ArbiterShadowOutcomeV1 {
  schema_version: typeof ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION;
  repo: string; // owner/name
  pr_number: number | null; // int > 0 or null
  merge_sha: string; // 40 lowercase hex
  horizon_days: HorizonDays;
  labelled_at: string; // ISO 8601
  survived: boolean | null;
  label: ArbiterShadowLabel;
}

/** State row: cursor and run metadata. */
export interface ArbiterShadowStateV1 {
  schema_version: typeof ARBITER_SHADOW_STATE_SCHEMA_VERSION;
  repo: string; // owner/name
  last_seen_merge_sha: string | null; // 40 hex or null
  last_run_at: string | null; // ISO 8601 or null (initial)
  last_run_status: ArbiterShadowRunStatus;
  last_error_code: ArbiterShadowErrorCode | null;
  scorer_id: string;
  scorer_version: string;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: HokusaiFieldError[] };

function fieldError(
  path: string,
  message: string,
  code: NonNullable<HokusaiFieldError['code']>,
): HokusaiFieldError {
  return { path, message, code };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Walk object and any nested objects to detect forbidden keys. */
function findForbiddenKeys(obj: unknown, path: string = '$'): HokusaiFieldError[] {
  const errors: HokusaiFieldError[] = [];

  if (!isPlainObject(obj)) {
    return errors;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (ARBITER_SHADOW_FORBIDDEN_KEYS.has(key)) {
      errors.push(fieldError(path === '$' ? key : `${path}.${key}`, `Forbidden key.`, 'invalid_value'));
    }

    // Recurse into nested objects and arrays
    if (isPlainObject(value)) {
      errors.push(...findForbiddenKeys(value, path === '$' ? key : `${path}.${key}`));
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const item = value[i];
        if (isPlainObject(item)) {
          errors.push(...findForbiddenKeys(item, `${path === '$' ? key : `${path}.${key}`}[${i}]`));
        }
      }
    }
  }

  return errors;
}

/** Validate a score row. */
export function validateShadowScoreRow(
  input: unknown,
): ValidationResult<ArbiterShadowScoreV1> {
  const errors: HokusaiFieldError[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [fieldError('$', 'Score row must be a plain object.', 'invalid_type')],
    };
  }

  // Check for unknown keys
  const allowedKeys = new Set([
    'schema_version',
    'repo',
    'pr_number',
    'merge_sha',
    'merged_at',
    'scored_at',
    'scorer_id',
    'scorer_version',
    'score',
    'threshold',
    'would_flag',
    'features',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      errors.push(fieldError(key, `Unknown field.`, 'invalid_value'));
    }
  }

  // Check schema_version
  if (!('schema_version' in input)) {
    errors.push(fieldError('schema_version', 'Field is required.', 'required'));
  } else if (input.schema_version !== ARBITER_SHADOW_SCORE_SCHEMA_VERSION) {
    errors.push(
      fieldError(
        'schema_version',
        `Expected "${ARBITER_SHADOW_SCORE_SCHEMA_VERSION}".`,
        typeof input.schema_version === 'string' ? 'invalid_value' : 'invalid_type',
      ),
    );
  }

  // Check repo
  if (!('repo' in input)) {
    errors.push(fieldError('repo', 'Field is required.', 'required'));
  } else if (typeof input.repo !== 'string' || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.repo)) {
    errors.push(fieldError('repo', 'Must be "owner/name".', 'invalid_value'));
  }

  // Check pr_number
  if (!('pr_number' in input)) {
    errors.push(fieldError('pr_number', 'Field is required.', 'required'));
  } else if (input.pr_number !== null && typeof input.pr_number === 'number') {
    if (!Number.isInteger(input.pr_number) || input.pr_number <= 0) {
      errors.push(fieldError('pr_number', 'Must be an integer > 0 or null.', 'invalid_value'));
    }
  } else if (input.pr_number !== null) {
    errors.push(fieldError('pr_number', 'Must be an integer > 0 or null.', 'invalid_value'));
  }

  // Check merge_sha
  if (!('merge_sha' in input)) {
    errors.push(fieldError('merge_sha', 'Field is required.', 'required'));
  } else if (typeof input.merge_sha !== 'string' || !/^[0-9a-f]{40}$/.test(input.merge_sha)) {
    errors.push(fieldError('merge_sha', 'Must be 40 lowercase hex characters.', 'invalid_value'));
  }

  // Check dates
  if (!('merged_at' in input)) {
    errors.push(fieldError('merged_at', 'Field is required.', 'required'));
  } else if (typeof input.merged_at === 'string' && Number.isNaN(Date.parse(input.merged_at))) {
    errors.push(fieldError('merged_at', 'Must be valid ISO 8601 date.', 'invalid_value'));
  } else if (typeof input.merged_at !== 'string') {
    errors.push(fieldError('merged_at', 'Must be valid ISO 8601 date.', 'invalid_value'));
  }

  if (!('scored_at' in input)) {
    errors.push(fieldError('scored_at', 'Field is required.', 'required'));
  } else if (typeof input.scored_at === 'string' && Number.isNaN(Date.parse(input.scored_at))) {
    errors.push(fieldError('scored_at', 'Must be valid ISO 8601 date.', 'invalid_value'));
  } else if (typeof input.scored_at !== 'string') {
    errors.push(fieldError('scored_at', 'Must be valid ISO 8601 date.', 'invalid_value'));
  }

  // Check scorer_id and scorer_version
  if (!('scorer_id' in input)) {
    errors.push(fieldError('scorer_id', 'Field is required.', 'required'));
  } else if (typeof input.scorer_id !== 'string' || input.scorer_id === '') {
    errors.push(fieldError('scorer_id', 'Must be a non-empty string.', 'invalid_value'));
  }

  if (!('scorer_version' in input)) {
    errors.push(fieldError('scorer_version', 'Field is required.', 'required'));
  } else if (typeof input.scorer_version !== 'string' || input.scorer_version === '') {
    errors.push(fieldError('scorer_version', 'Must be a non-empty string.', 'invalid_value'));
  }

  // Check score and threshold
  if (!('score' in input)) {
    errors.push(fieldError('score', 'Field is required.', 'required'));
  } else if (typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > 1) {
    errors.push(fieldError('score', 'Must be a finite number in [0, 1].', 'invalid_value'));
  }

  if (!('threshold' in input)) {
    errors.push(fieldError('threshold', 'Field is required.', 'required'));
  } else if (typeof input.threshold !== 'number' || !Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold > 1) {
    errors.push(fieldError('threshold', 'Must be a finite number in [0, 1].', 'invalid_value'));
  }

  // Check would_flag consistency (score < threshold)
  if (!('would_flag' in input)) {
    errors.push(fieldError('would_flag', 'Field is required.', 'required'));
  } else if (typeof input.would_flag !== 'boolean') {
    errors.push(fieldError('would_flag', 'Must be a boolean.', 'invalid_value'));
  } else if (
    'score' in input &&
    'threshold' in input &&
    typeof input.score === 'number' &&
    typeof input.threshold === 'number' &&
    Number.isFinite(input.score) &&
    Number.isFinite(input.threshold)
  ) {
    const expectedFlag = input.score < input.threshold;
    if (input.would_flag !== expectedFlag) {
      errors.push(
        fieldError(
          'would_flag',
          `Must be ${expectedFlag} (score ${input.score.toFixed(3)} < threshold ${input.threshold.toFixed(3)}).`,
          'invalid_value',
        ),
      );
    }
  }

  // Check features
  if (!('features' in input)) {
    errors.push(fieldError('features', 'Field is required.', 'required'));
  } else {
    const featResult = validateCandidateFeaturesV1(input.features);
    if (!featResult.ok) {
      errors.push(...featResult.errors.map(e => ({ ...e, path: `features.${e.path}` })));
    }
  }

  // Forbidden key check (before other checks so path is more precise)
  errors.push(...findForbiddenKeys(input));

  return errors.length === 0
    ? { ok: true, value: (input as unknown) as ArbiterShadowScoreV1 }
    : { ok: false, errors };
}

/** Validate an outcome row. */
export function validateShadowOutcomeRow(
  input: unknown,
): ValidationResult<ArbiterShadowOutcomeV1> {
  const errors: HokusaiFieldError[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [fieldError('$', 'Outcome row must be a plain object.', 'invalid_type')],
    };
  }

  // Check for unknown keys
  const allowedKeys = new Set([
    'schema_version',
    'repo',
    'pr_number',
    'merge_sha',
    'horizon_days',
    'labelled_at',
    'survived',
    'label',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      errors.push(fieldError(key, `Unknown field.`, 'invalid_value'));
    }
  }

  // Check schema_version
  if (!('schema_version' in input)) {
    errors.push(fieldError('schema_version', 'Field is required.', 'required'));
  } else if (input.schema_version !== ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION) {
    errors.push(
      fieldError(
        'schema_version',
        `Expected "${ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION}".`,
        typeof input.schema_version === 'string' ? 'invalid_value' : 'invalid_type',
      ),
    );
  }

  // Check repo
  if (!('repo' in input)) {
    errors.push(fieldError('repo', 'Field is required.', 'required'));
  } else if (typeof input.repo !== 'string' || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.repo)) {
    errors.push(fieldError('repo', 'Must be "owner/name".', 'invalid_value'));
  }

  // Check pr_number
  if (!('pr_number' in input)) {
    errors.push(fieldError('pr_number', 'Field is required.', 'required'));
  } else if (input.pr_number !== null && typeof input.pr_number === 'number') {
    if (!Number.isInteger(input.pr_number) || input.pr_number <= 0) {
      errors.push(fieldError('pr_number', 'Must be an integer > 0 or null.', 'invalid_value'));
    }
  } else if (input.pr_number !== null) {
    errors.push(fieldError('pr_number', 'Must be an integer > 0 or null.', 'invalid_value'));
  }

  // Check merge_sha
  if (!('merge_sha' in input)) {
    errors.push(fieldError('merge_sha', 'Field is required.', 'required'));
  } else if (typeof input.merge_sha !== 'string' || !/^[0-9a-f]{40}$/.test(input.merge_sha)) {
    errors.push(fieldError('merge_sha', 'Must be 40 lowercase hex characters.', 'invalid_value'));
  }

  // Check horizon_days
  if (!('horizon_days' in input)) {
    errors.push(fieldError('horizon_days', 'Field is required.', 'required'));
  } else if (!HORIZONS.includes(input.horizon_days as HorizonDays)) {
    errors.push(fieldError('horizon_days', `Must be one of ${HORIZONS.join(', ')}.`, 'invalid_value'));
  }

  // Check labelled_at
  if (!('labelled_at' in input)) {
    errors.push(fieldError('labelled_at', 'Field is required.', 'required'));
  } else if (typeof input.labelled_at === 'string' && Number.isNaN(Date.parse(input.labelled_at))) {
    errors.push(fieldError('labelled_at', 'Must be valid ISO 8601 date.', 'invalid_value'));
  } else if (typeof input.labelled_at !== 'string') {
    errors.push(fieldError('labelled_at', 'Must be valid ISO 8601 date.', 'invalid_value'));
  }

  // Check survived
  if (!('survived' in input)) {
    errors.push(fieldError('survived', 'Field is required.', 'required'));
  } else if (typeof input.survived !== 'boolean' && input.survived !== null) {
    errors.push(fieldError('survived', 'Must be a boolean or null.', 'invalid_value'));
  }

  // Check label
  if (!('label' in input)) {
    errors.push(fieldError('label', 'Field is required.', 'required'));
  } else if (isPlainObject(input.label)) {
    // Check label schema_version
    if (input.label.schema_version !== ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION) {
      errors.push(
        fieldError(
          'label.schema_version',
          `Expected "${ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION}".`,
          'invalid_value',
        ),
      );
    }

    // Check label.horizon_days matches
    if (input.label.horizon_days !== input.horizon_days) {
      errors.push(fieldError('label.horizon_days', 'Must match row horizon_days.', 'invalid_value'));
    }

    // Check label.envelope.merge_sha matches
    if (isPlainObject(input.label.envelope)) {
      if (input.label.envelope.merge_sha !== input.merge_sha) {
        errors.push(fieldError('label.envelope.merge_sha', 'Must match row merge_sha.', 'invalid_value'));
      }
    }

    // Check label.outcome.survived matches row survived
    if (isPlainObject(input.label.outcome)) {
      if (input.label.outcome.survived !== input.survived) {
        errors.push(fieldError('label.outcome.survived', 'Must match row survived.', 'invalid_value'));
      }

      // Check reason_codes
      if (!Array.isArray(input.label.outcome.reason_codes) || input.label.outcome.reason_codes.length === 0) {
        errors.push(fieldError('label.outcome.reason_codes', 'Must be a non-empty array.', 'invalid_value'));
      }
    }
  } else {
    errors.push(fieldError('label', 'Must be an object.', 'invalid_type'));
  }

  // Forbidden key check (includes line_ranges and path)
  errors.push(...findForbiddenKeys(input));

  return errors.length === 0
    ? { ok: true, value: (input as unknown) as ArbiterShadowOutcomeV1 }
    : { ok: false, errors };
}

/** Validate state. */
export function validateShadowState(
  input: unknown,
): ValidationResult<ArbiterShadowStateV1> {
  const errors: HokusaiFieldError[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [fieldError('$', 'State must be a plain object.', 'invalid_type')],
    };
  }

  // Check for unknown keys
  const allowedKeys = new Set([
    'schema_version',
    'repo',
    'last_seen_merge_sha',
    'last_run_at',
    'last_run_status',
    'last_error_code',
    'scorer_id',
    'scorer_version',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      errors.push(fieldError(key, `Unknown field.`, 'invalid_value'));
    }
  }

  // Check schema_version
  if (!('schema_version' in input)) {
    errors.push(fieldError('schema_version', 'Field is required.', 'required'));
  } else if (input.schema_version !== ARBITER_SHADOW_STATE_SCHEMA_VERSION) {
    errors.push(
      fieldError(
        'schema_version',
        `Expected "${ARBITER_SHADOW_STATE_SCHEMA_VERSION}".`,
        typeof input.schema_version === 'string' ? 'invalid_value' : 'invalid_type',
      ),
    );
  }

  // Check repo
  if (!('repo' in input)) {
    errors.push(fieldError('repo', 'Field is required.', 'required'));
  } else if (typeof input.repo !== 'string' || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.repo)) {
    errors.push(fieldError('repo', 'Must be "owner/name".', 'invalid_value'));
  }

  // Check last_seen_merge_sha
  if (!('last_seen_merge_sha' in input)) {
    errors.push(fieldError('last_seen_merge_sha', 'Field is required.', 'required'));
  } else if (input.last_seen_merge_sha !== null) {
    if (typeof input.last_seen_merge_sha !== 'string' || !/^[0-9a-f]{40}$/.test(input.last_seen_merge_sha)) {
      errors.push(fieldError('last_seen_merge_sha', 'Must be 40 lowercase hex or null.', 'invalid_value'));
    }
  }

  // Check last_run_at
  if (!('last_run_at' in input)) {
    errors.push(fieldError('last_run_at', 'Field is required.', 'required'));
  } else if (input.last_run_at !== null) {
    if (typeof input.last_run_at !== 'string' || Number.isNaN(Date.parse(input.last_run_at))) {
      errors.push(fieldError('last_run_at', 'Must be valid ISO 8601 date or null.', 'invalid_value'));
    }
  }

  // Check last_run_status
  if (!('last_run_status' in input)) {
    errors.push(fieldError('last_run_status', 'Field is required.', 'required'));
  } else if (typeof input.last_run_status === 'string' && !ARBITER_SHADOW_RUN_STATUSES.includes(input.last_run_status as ArbiterShadowRunStatus)) {
    errors.push(fieldError('last_run_status', `Must be one of ${ARBITER_SHADOW_RUN_STATUSES.join(', ')}.`, 'invalid_value'));
  } else if (typeof input.last_run_status !== 'string') {
    errors.push(fieldError('last_run_status', `Must be one of ${ARBITER_SHADOW_RUN_STATUSES.join(', ')}.`, 'invalid_value'));
  }

  // Check last_error_code
  if (!('last_error_code' in input)) {
    errors.push(fieldError('last_error_code', 'Field is required.', 'required'));
  } else if (input.last_error_code !== null && typeof input.last_error_code === 'string') {
    if (!ARBITER_SHADOW_ERROR_CODES.includes(input.last_error_code as ArbiterShadowErrorCode)) {
      errors.push(
        fieldError(
          'last_error_code',
          `Must be one of ${ARBITER_SHADOW_ERROR_CODES.join(', ')} or null.`,
          'invalid_value',
        ),
      );
    }
  } else if (input.last_error_code !== null) {
    errors.push(
      fieldError(
        'last_error_code',
        `Must be one of ${ARBITER_SHADOW_ERROR_CODES.join(', ')} or null.`,
        'invalid_value',
      ),
    );
  }

  // Check scorer_id and scorer_version
  if (!('scorer_id' in input)) {
    errors.push(fieldError('scorer_id', 'Field is required.', 'required'));
  } else if (typeof input.scorer_id !== 'string' || input.scorer_id === '') {
    errors.push(fieldError('scorer_id', 'Must be a non-empty string.', 'invalid_value'));
  }

  if (!('scorer_version' in input)) {
    errors.push(fieldError('scorer_version', 'Field is required.', 'required'));
  } else if (typeof input.scorer_version !== 'string' || input.scorer_version === '') {
    errors.push(fieldError('scorer_version', 'Must be a non-empty string.', 'invalid_value'));
  }

  return errors.length === 0
    ? { ok: true, value: (input as unknown) as ArbiterShadowStateV1 }
    : { ok: false, errors };
}

/** Create initial state for a repo and scorer. */
export function initialShadowState(
  repo: string,
  scorerId: string,
  scorerVersion: string,
): ArbiterShadowStateV1 {
  return {
    schema_version: ARBITER_SHADOW_STATE_SCHEMA_VERSION,
    repo,
    last_seen_merge_sha: null,
    last_run_at: null,
    last_run_status: 'ok',
    last_error_code: null,
    scorer_id: scorerId,
    scorer_version: scorerVersion,
  };
}
