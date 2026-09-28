/**
 * Repo-agnostic extractor for the frozen Arbiter S1 `candidate_features/v1`.
 *
 * The core accepts only a checkout plus PR number. Caller workflow state is
 * deliberately outside the boundary; callers that have a task contract may
 * pass the normalized, privacy-safe contract below to enrich Intent and
 * bounded Provenance fields. Without that contract, Intent fields are `null`,
 * never guessed defaults.
 *
 * The wire shape, vocabularies, and validation all come from
 * `@hokusai/core`'s `candidate-features` module — this extractor never
 * redeclares the schema (that duplication was the pre-extraction state this
 * package removed; see Arbiter R1).
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CANDIDATE_FEATURES_SCHEMA_VERSION,
  HOKUSAI_DESCRIPTION_LENGTH_BUCKETS,
  HOKUSAI_DOMAINS,
  HOKUSAI_FILES_TOUCHED_BUCKETS,
  HOKUSAI_LANGUAGES,
  HOKUSAI_REPO_SIZE_BUCKETS,
  HOKUSAI_RISK_LEVELS,
  HOKUSAI_TASK_TYPES,
  deriveTaskDescriptor,
  normalizeComplexity,
  validateCandidateFeaturesV1,
  type CandidateFeaturesV1,
  type HokusaiDescriptionLengthBucket,
  type HokusaiDomain,
  type HokusaiFilesTouchedBucket,
  type HokusaiLanguage,
  type HokusaiRepoSizeBucket,
  type HokusaiRiskLevel,
  type HokusaiTaskType,
  type TaskDescriptorSignals,
} from '@hokusai/core';
import { collectStaticFeatures, type StaticFeaturesResult } from './static-features.js';
import { execArgvCommand } from './shell-utils.js';

export { CANDIDATE_FEATURES_SCHEMA_VERSION };
export type { CandidateFeaturesV1 };

/** Candidate vocabularies are exactly the core task-descriptor vocabularies. */
export type CandidateTaskType = HokusaiTaskType;
export type CandidateLanguage = HokusaiLanguage;
export type CandidateDomain = HokusaiDomain;
export type CandidateRepoSizeBucket = HokusaiRepoSizeBucket;
export type CandidateFilesTouchedBucket = HokusaiFilesTouchedBucket;
export type CandidateDescriptionLengthBucket = HokusaiDescriptionLengthBucket;
export type CandidateRiskLevel = HokusaiRiskLevel;

export type CandidateFeatureKey = Exclude<keyof CandidateFeaturesV1, 'schema_version'>;

export interface CandidateFeatureContract {
  /**
   * Local task text used only as input to `deriveTaskDescriptor`; never returned.
   */
  taskText?: string | undefined;
  repositorySignals?: TaskDescriptorSignals | undefined;
  intent?: Partial<Pick<
    CandidateFeaturesV1,
    | 'task_type'
    | 'language'
    | 'domain'
    | 'complexity'
    | 'repo_size_bucket'
    | 'files_touched_bucket'
    | 'description_length_bucket'
    | 'is_greenfield'
    | 'is_migration'
    | 'requires_tests'
    | 'cross_service'
    | 'ui_heavy'
    | 'risk_level'
  >> | undefined;
  scope?: {
    allowedFiles?: string[] | undefined;
    allowedPrefixes?: string[] | undefined;
  } | undefined;
  provenance?: Partial<Pick<
    CandidateFeaturesV1,
    | 'human_intervention_count'
    | 'review_rounds'
    | 'change_requests'
    | 'self_review_iterations'
    | 'agent_iterations'
  >> | undefined;
}

export interface CandidateFeaturesOptions {
  checkoutDir: string;
  prNumber: string | number;
  repoDir?: string | undefined;
  baseRef?: string | undefined;
  contract?: CandidateFeatureContract | undefined;
  offline?: boolean | undefined;
  staticFeatures?: StaticFeaturesResult | undefined;
  /** Explicit committed-config path forwarded to the static collector. */
  configPath?: string | undefined;
  /** Receives non-fatal diagnostics from the static collector. */
  onDiagnostic?: ((message: string) => void) | undefined;
}

export interface CandidateFeatureValidationIssue {
  field: string;
  message: string;
}

const TASK_TYPES = new Set<CandidateTaskType>(HOKUSAI_TASK_TYPES);
const LANGUAGES = new Set<CandidateLanguage>(HOKUSAI_LANGUAGES);
const DOMAINS = new Set<CandidateDomain>(HOKUSAI_DOMAINS);
const REPO_SIZE_BUCKETS = new Set<CandidateRepoSizeBucket>(HOKUSAI_REPO_SIZE_BUCKETS);
const FILES_TOUCHED_BUCKETS = new Set<CandidateFilesTouchedBucket>(HOKUSAI_FILES_TOUCHED_BUCKETS);
const DESCRIPTION_LENGTH_BUCKETS = new Set<CandidateDescriptionLengthBucket>(
  HOKUSAI_DESCRIPTION_LENGTH_BUCKETS,
);
const RISK_LEVELS = new Set<CandidateRiskLevel>(HOKUSAI_RISK_LEVELS);

const TEST_FILE_PATTERN = /(^|\/)(__tests__|tests?)\/|(\.|-)(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$/i;

interface DiffStats {
  changedFiles: string[];
  filesTouched: number;
  linesAdded: number;
  linesDeleted: number;
  locTouched: number;
  diffUncertain: boolean;
}

interface PullRequestEvidence {
  baseRefName?: string;
}

export function extractCandidateFeatures(options: CandidateFeaturesOptions): CandidateFeaturesV1 {
  const checkoutDir = resolve(options.checkoutDir);
  const repoDir = resolve(options.repoDir ?? checkoutDir);
  const prNumber = String(options.prNumber);
  const prEvidence = options.offline
    ? null
    : safe(() => fetchPullRequestEvidence(prNumber, repoDir), null);
  const baseRef = resolveBaseRef(checkoutDir, prEvidence?.baseRefName, options.baseRef);
  const diffStats = safe(() => collectDiffStats(checkoutDir, baseRef), null);
  const staticFeatures = options.staticFeatures ?? collectStaticFeatures({
    checkoutDir,
    prNumber,
    repoDir,
    ...(baseRef ? { baseRef } : {}),
    offline: options.offline,
    configPath: options.configPath,
    onDiagnostic: options.onDiagnostic,
  });
  const reviewEvidence = options.offline
    ? null
    : safe(() => collectReviewEvidence(prNumber, repoDir), null);

  const candidate: CandidateFeaturesV1 = {
    schema_version: CANDIDATE_FEATURES_SCHEMA_VERSION,
    files_touched: diffStats?.filesTouched ?? null,
    lines_added: diffStats?.linesAdded ?? null,
    lines_deleted: diffStats?.linesDeleted ?? null,
    loc_touched: diffStats?.locTouched ?? null,
    dependency_depth: null,
    module_hotspot_score: null,
    diff_uncertain: diffStats?.diffUncertain ?? null,
    type_errors: staticFeatures.type_errors,
    lint_errors: staticFeatures.lint_errors,
    build_ok: staticFeatures.build_ok,
    complexity_delta: staticFeatures.complexity_delta,
    tests_changed: diffStats ? diffStats.changedFiles.some(isTestFile) : null,
    test_pass_rate: options.offline ? null : safe(() => collectTestPassRate(prNumber, repoDir), null),
    test_runtime_seconds: null,
    ...nullIntent(),
    touched_out_of_scope_files: collectTouchedOutOfScopeFiles(diffStats, options.contract),
    human_intervention_count: normalizeNonNegativeInteger(options.contract?.provenance?.human_intervention_count),
    review_rounds: normalizeNonNegativeInteger(
      options.contract?.provenance?.review_rounds ?? reviewEvidence?.reviewRounds,
    ),
    change_requests: normalizeNonNegativeInteger(
      options.contract?.provenance?.change_requests ?? reviewEvidence?.changeRequests,
    ),
    self_review_iterations: normalizeNonNegativeInteger(options.contract?.provenance?.self_review_iterations),
    agent_iterations: normalizeNonNegativeInteger(options.contract?.provenance?.agent_iterations),
  };

  const intent = deriveIntent(options.contract, diffStats);
  Object.assign(candidate, intent);

  const issues = validateCandidateFeatures(candidate);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
    throw new Error(`candidate_features/v1 validation failed: ${details}`);
  }

  return candidate;
}

/**
 * Issue-list adapter over `@hokusai/core`'s `validateCandidateFeaturesV1`,
 * preserving the pre-extraction call shape. Message text comes from core.
 */
export function validateCandidateFeatures(value: unknown): CandidateFeatureValidationIssue[] {
  const result = validateCandidateFeaturesV1(value);
  if (result.ok) return [];
  return result.errors.map((error) => ({ field: error.path, message: error.message }));
}

function collectDiffStats(checkoutDir: string, baseRef: string | null): DiffStats | null {
  if (!baseRef || !isExistingDir(checkoutDir)) return null;
  const mergeBase = runGit(checkoutDir, ['merge-base', baseRef, 'HEAD']);
  if (!mergeBase) return null;

  const numstat = runGit(checkoutDir, ['diff', '--numstat', '--find-renames', `${mergeBase}...HEAD`]);
  const names = runGit(checkoutDir, ['diff', '--name-only', '--find-renames', `${mergeBase}...HEAD`]);
  if (numstat === null || names === null) return null;

  const changedFiles = names.split('\n').map((line) => line.trim()).filter(Boolean).sort();
  let linesAdded = 0;
  let linesDeleted = 0;

  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, deleted] = line.split('\t');
    linesAdded += parseNumstatCount(added);
    linesDeleted += parseNumstatCount(deleted);
  }

  return {
    changedFiles,
    filesTouched: changedFiles.length,
    linesAdded,
    linesDeleted,
    locTouched: linesAdded + linesDeleted,
    diffUncertain: changedFiles.length > 0 && numstat.trim().length === 0,
  };
}

function parseNumstatCount(value: string | undefined): number {
  if (!value || value === '-') return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveBaseRef(
  checkoutDir: string,
  prBaseRefName: string | undefined,
  explicitBaseRef: string | undefined,
): string | null {
  const candidates = [
    explicitBaseRef,
    prBaseRefName ? `origin/${prBaseRefName}` : undefined,
    prBaseRefName,
    'origin/main',
    'main',
    'origin/HEAD',
    'HEAD^',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = runGit(checkoutDir, ['rev-parse', '--verify', candidate], { allowFailure: true });
    if (resolved) return candidate;
  }
  return null;
}

function fetchPullRequestEvidence(prNumber: string, repoDir: string): PullRequestEvidence | null {
  if (!/^\d+$/.test(prNumber) || !isExistingDir(repoDir)) return null;
  const result = execArgvCommand(
    'gh',
    ['pr', 'view', prNumber, '--json', 'baseRefName'],
    { cwd: repoDir, timeout: 15_000, encoding: 'utf-8' },
  );
  if (result.failed || result.exitCode !== 0 || !result.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { baseRefName?: unknown };
    return typeof parsed.baseRefName === 'string' && parsed.baseRefName.length > 0
      ? { baseRefName: parsed.baseRefName }
      : null;
  } catch {
    return null;
  }
}

function collectTestPassRate(prNumber: string, repoDir: string): number | null {
  if (!/^\d+$/.test(prNumber) || !isExistingDir(repoDir)) return null;
  const result = execArgvCommand(
    'gh',
    ['pr', 'checks', prNumber, '--json', 'name,state,bucket'],
    { cwd: repoDir, timeout: 15_000, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.failed || result.exitCode < 0 || !result.stdout.trim()) return null;
  let checks: Array<{ name?: string; bucket?: string; state?: string }>;
  try {
    checks = JSON.parse(result.stdout) as typeof checks;
  } catch {
    return null;
  }
  if (!Array.isArray(checks)) return null;
  // Aggregate across every check whose name matches a test tool. Sharded
  // pipelines (e.g. `unit-shard-3/7`) expose per-shard checks; taking only
  // the first would report the pass rate of one shard as if it were the
  // whole suite. Skipped/cancelled/pending shards are excluded from the
  // denominator so the rate reflects only checks that reported a verdict.
  const testChecks = checks.filter((check) => /test|spec|jest|vitest|pytest/i.test(check.name ?? ''));
  if (testChecks.length === 0) return null;
  let passed = 0;
  let scored = 0;
  for (const check of testChecks) {
    if (check.bucket === 'pass') { passed += 1; scored += 1; }
    else if (check.bucket === 'fail') { scored += 1; }
  }
  if (scored === 0) return null;
  return passed / scored;
}

function collectReviewEvidence(
  prNumber: string,
  repoDir: string,
): { reviewRounds: number; changeRequests: number } | null {
  if (!/^\d+$/.test(prNumber) || !isExistingDir(repoDir)) return null;
  const result = execArgvCommand(
    'gh',
    ['pr', 'view', prNumber, '--json', 'reviews'],
    { cwd: repoDir, timeout: 15_000, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.failed || result.exitCode !== 0 || !result.stdout.trim()) return null;
  let reviews: Array<{ state?: string; submittedAt?: string }>;
  try {
    const parsed = JSON.parse(result.stdout) as { reviews?: unknown };
    reviews = Array.isArray(parsed.reviews) ? (parsed.reviews as typeof reviews) : [];
  } catch {
    return null;
  }
  if (reviews.length === 0) return { reviewRounds: 0, changeRequests: 0 };
  const roundHours = new Set<number>();
  let changeRequests = 0;
  for (const review of reviews) {
    if (typeof review.submittedAt === 'string') {
      const time = new Date(review.submittedAt).getTime();
      if (Number.isFinite(time)) roundHours.add(Math.floor(time / (1000 * 60 * 60)));
    }
    if ((review.state ?? '').toUpperCase() === 'CHANGES_REQUESTED') {
      changeRequests += 1;
    }
  }
  return { reviewRounds: roundHours.size, changeRequests };
}

type CandidateIntent = Pick<
  CandidateFeaturesV1,
  | 'task_type'
  | 'language'
  | 'domain'
  | 'complexity'
  | 'repo_size_bucket'
  | 'files_touched_bucket'
  | 'description_length_bucket'
  | 'is_greenfield'
  | 'is_migration'
  | 'requires_tests'
  | 'cross_service'
  | 'ui_heavy'
  | 'risk_level'
>;

function deriveIntent(
  contract: CandidateFeatureContract | undefined,
  diffStats: DiffStats | null,
): CandidateIntent {
  if (!contract) return nullIntent();
  const descriptor = deriveTaskDescriptor({
    taskText: contract.taskText,
    repositorySignals: contract.repositorySignals,
  });
  const intent = nullIntent();

  intent.task_type = normalizeTaskType(contract.intent?.task_type ?? descriptor.task_type);
  intent.language = normalizeLanguage(contract.intent?.language ?? descriptor.language);
  intent.domain = normalizeDomain(contract.intent?.domain);
  intent.complexity = normalizeComplexityValue(contract.intent?.complexity ?? descriptor.complexity);
  intent.repo_size_bucket = normalizeRepoSizeBucket(contract.intent?.repo_size_bucket ?? descriptor.repo_size_bucket);
  intent.files_touched_bucket = normalizeFilesTouchedBucket(
    contract.intent?.files_touched_bucket ?? bucketFilesTouched(diffStats?.filesTouched),
  );
  intent.description_length_bucket = normalizeDescriptionLengthBucket(
    contract.intent?.description_length_bucket ?? bucketDescription(contract.taskText),
  );
  intent.is_greenfield = normalizeBoolean(contract.intent?.is_greenfield);
  intent.is_migration = normalizeBoolean(contract.intent?.is_migration);
  intent.requires_tests = normalizeBoolean(contract.intent?.requires_tests);
  intent.cross_service = normalizeBoolean(contract.intent?.cross_service);
  intent.ui_heavy = normalizeBoolean(contract.intent?.ui_heavy);
  intent.risk_level = normalizeRiskLevel(contract.intent?.risk_level);
  return intent;
}

function nullIntent(): CandidateIntent {
  return {
    task_type: null,
    language: null,
    domain: null,
    complexity: null,
    repo_size_bucket: null,
    files_touched_bucket: null,
    description_length_bucket: null,
    is_greenfield: null,
    is_migration: null,
    requires_tests: null,
    cross_service: null,
    ui_heavy: null,
    risk_level: null,
  };
}

function collectTouchedOutOfScopeFiles(
  diffStats: DiffStats | null,
  contract: CandidateFeatureContract | undefined,
): number | null {
  if (!diffStats || !contract?.scope) return null;
  const allowedFiles = new Set((contract.scope.allowedFiles ?? []).map(normalizeRepoPath).filter(Boolean));
  const allowedPrefixes = (contract.scope.allowedPrefixes ?? [])
    .map(normalizeRepoPath)
    .filter((path): path is string => Boolean(path))
    .map((path) => (path.endsWith('/') ? path : `${path}/`));
  if (allowedFiles.size === 0 && allowedPrefixes.length === 0) return null;

  let outOfScope = 0;
  for (const file of diffStats.changedFiles) {
    const normalized = normalizeRepoPath(file);
    if (!normalized) {
      outOfScope += 1;
      continue;
    }
    const allowed = allowedFiles.has(normalized)
      || allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
    if (!allowed) outOfScope += 1;
  }
  return outOfScope;
}

function normalizeRepoPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }
  return normalized;
}

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path);
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeTaskType(value: unknown): CandidateTaskType | null {
  if (value === 'test') return 'tests';
  return typeof value === 'string' && TASK_TYPES.has(value as CandidateTaskType)
    ? (value as CandidateTaskType)
    : null;
}

function normalizeLanguage(value: unknown): CandidateLanguage | null {
  return typeof value === 'string' && LANGUAGES.has(value as CandidateLanguage)
    ? (value as CandidateLanguage)
    : null;
}

function normalizeDomain(value: unknown): CandidateDomain | null {
  if (value === 'full-stack') return 'fullstack';
  if (value === 'infrastructure' || value === 'devtools') return 'devops';
  if (value === 'data-pipeline') return 'data';
  return typeof value === 'string' && DOMAINS.has(value as CandidateDomain)
    ? (value as CandidateDomain)
    : null;
}

function normalizeComplexityValue(value: unknown): number | null {
  const normalized = normalizeComplexity(
    typeof value === 'string' || typeof value === 'number' ? value : undefined,
  );
  if (typeof normalized !== 'number' || !Number.isFinite(normalized)) return null;
  return Math.max(0, Math.min(10, normalized));
}

function normalizeRepoSizeBucket(value: unknown): CandidateRepoSizeBucket | null {
  return typeof value === 'string' && REPO_SIZE_BUCKETS.has(value as CandidateRepoSizeBucket)
    ? (value as CandidateRepoSizeBucket)
    : null;
}

function normalizeFilesTouchedBucket(value: unknown): CandidateFilesTouchedBucket | null {
  return typeof value === 'string' && FILES_TOUCHED_BUCKETS.has(value as CandidateFilesTouchedBucket)
    ? (value as CandidateFilesTouchedBucket)
    : null;
}

function normalizeDescriptionLengthBucket(value: unknown): CandidateDescriptionLengthBucket | null {
  return typeof value === 'string' && DESCRIPTION_LENGTH_BUCKETS.has(value as CandidateDescriptionLengthBucket)
    ? (value as CandidateDescriptionLengthBucket)
    : null;
}

function normalizeRiskLevel(value: unknown): CandidateRiskLevel | null {
  return typeof value === 'string' && RISK_LEVELS.has(value as CandidateRiskLevel)
    ? (value as CandidateRiskLevel)
    : null;
}

function bucketFilesTouched(count: number | null | undefined): CandidateFilesTouchedBucket | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 15) return '6_15';
  return '16_plus';
}

function bucketDescription(taskText: string | undefined): CandidateDescriptionLengthBucket | null {
  const trimmed = taskText?.trim();
  if (!trimmed) return null;
  const tokens = Math.ceil(trimmed.length / 4);
  if (tokens < 50) return 'short';
  if (tokens < 200) return 'medium';
  return 'long';
}

function isExistingDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function runGit(
  cwd: string,
  args: readonly string[],
  options: { allowFailure?: boolean } = {},
): string | null {
  const result = execArgvCommand(
    'git',
    args,
    { cwd, timeout: 30_000, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.failed) return null;
  if (result.exitCode !== 0 && !options.allowFailure) return null;
  if (result.exitCode !== 0 && options.allowFailure) return null;
  return result.stdout.trimEnd();
}
