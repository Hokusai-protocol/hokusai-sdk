/**
 * Rework Risk merge-time feature manifest and leakage validator (HOK-3023).
 *
 * Every arm in the pre-registered backtest consumes the same information set:
 * what was knowable at merge. This module declares that set and is the single
 * implementation of the rule that nothing else may enter it. Dataset assembly
 * (HOK-2818) and experiment evaluation (HOK-3021) both run this validator;
 * non-TypeScript callers reach it through `hokusai-scan corpus-feature-audit`.
 *
 * The cutoff has two halves:
 * - API evidence is filtered to timestamps at or before the row's `as_of`.
 * - Git evidence is limited to commits reachable from `merge_sha`. Commit dates
 *   are never the leakage gate, because authors and bots can set them.
 *
 * This module is contract-only: extraction lives in `@hokusai/scan`. Contract
 * doc: `docs/arbiter/merge-time-feature-manifest.md`.
 *
 * @module rework-risk-features
 */

import type { HokusaiFieldError } from './schemas.js';

/** Any change to the entries or the rules below bumps this version. */
export const REWORK_RISK_FEATURE_MANIFEST_VERSION = 'rr-merge-features/0.2.0' as const;

/** Sources whose evidence is fixed at or before `as_of`. */
export const FEATURE_AS_OF_SOURCES = [
  /** The diff between `base_sha` and `merge_sha`. */
  'git_diff_base_to_merge',
  /** Commits reachable from `base_sha`; windows are measured back from `as_of`. */
  'git_ancestors_of_base',
  /** Timestamped GitHub events, each at or before `as_of`. */
  'github_events_until_as_of',
  /** The PR's commits up to its head at merge, plus the landing commit; fixed by SHA. */
  'pr_commits_at_merge',
  /** A PR fact that cannot change after creation. */
  'immutable_pr_fact',
  /** Task-contract data written by an instrumented harness before merge. */
  'harness_contract',
] as const;
export type FeatureAsOfSource = (typeof FEATURE_AS_OF_SOURCES)[number];

/** Sources that can see past `as_of`. Declaring one fails the audit. */
export const POST_MERGE_SOURCES = [
  'github_current_state',
  'git_history_after_merge',
  'label_store',
  'wall_clock',
] as const;

/** How a row's `as_of` was obtained; recorded per row, because it differs by merge convention. */
export const AS_OF_BASES = [
  /** GitHub reported a `mergedAt` for the PR. */
  'github_merged_at',
  /** No `mergedAt` (e.g. pytorch's merge bot closes PRs): the landing commit's timestamp. */
  'landing_commit_time',
] as const;
export type AsOfBasis = (typeof AS_OF_BASES)[number];

export type FeatureKind = 'integer' | 'number' | 'boolean' | 'content_sha256' | 'category';

/**
 * Agent tools a PR can carry evidence of. `none` means no marker was seen, not
 * that a person wrote the PR unaided.
 */
export const AGENT_TOOL_FAMILIES = [
  'none', 'claude', 'copilot', 'cursor', 'codex', 'devin', 'gemini', 'aider', 'openhands', 'other', 'multiple',
] as const;
export type AgentToolFamily = (typeof AGENT_TOOL_FAMILIES)[number];

export interface MergeTimeFeatureEntry {
  /** `feature.<group>.<field>` or `segment.<group>.<field>`. */
  readonly name: string;
  readonly as_of_source: FeatureAsOfSource;
  readonly kind: FeatureKind;
  readonly description: string;
  readonly null_meaning: string;
  /** Segment features are never arm inputs; they are reported separately. */
  readonly segment: boolean;
  /**
   * Allowed values of a `category`. An arm input needs a closed list, because a
   * value training never saw (a new model name) also dates the row.
   */
  readonly categories?: readonly string[];
  /** Only part of the corpus window has this evidence. */
  readonly availability?: string;
}

export interface MergeTimeFeatureManifest {
  readonly manifest_version: string;
  readonly as_of: string;
  readonly entries: readonly MergeTimeFeatureEntry[];
}

const NO_DIFF = 'The diff between base_sha and merge_sha could not be read.';
const NO_HISTORY = 'Ancestor history of base_sha could not be read.';
const NO_EVENTS = 'GitHub returned no timeline for this PR.';
const NOT_INSTRUMENTED = 'The PR did not come from an instrumented agent harness.';
const NO_COMMITS = "The PR's commits could not be read.";
const NO_MARKER_EVIDENCE = 'No marker was found, and the commits or the body at as_of could not be read.';
const NO_AUTHOR = 'The author account no longer exists.';

const entry = (
  name: string,
  as_of_source: FeatureAsOfSource,
  kind: FeatureKind,
  description: string,
  null_meaning: string,
): MergeTimeFeatureEntry => ({ name, as_of_source, kind, description, null_meaning, segment: name.startsWith('segment.') });

/** The frozen information set. Raw content stays private; rows carry its hash. */
export const REWORK_RISK_FEATURE_MANIFEST: MergeTimeFeatureManifest = Object.freeze({
  manifest_version: REWORK_RISK_FEATURE_MANIFEST_VERSION,
  as_of: 'merged_at, or the landing commit time when GitHub reports none; see AS_OF_BASES.',
  entries: Object.freeze([
    entry('feature.shape.files_touched', 'git_diff_base_to_merge', 'integer', 'Files changed.', NO_DIFF),
    entry('feature.shape.lines_added', 'git_diff_base_to_merge', 'integer', 'Lines added.', NO_DIFF),
    entry('feature.shape.lines_deleted', 'git_diff_base_to_merge', 'integer', 'Lines deleted.', NO_DIFF),
    entry('feature.shape.loc_touched', 'git_diff_base_to_merge', 'integer', 'Lines added plus deleted.', NO_DIFF),
    entry('feature.shape.tests_changed', 'git_diff_base_to_merge', 'boolean', 'A test file changed.', NO_DIFF),
    entry('feature.shape.diff_uncertain', 'git_diff_base_to_merge', 'boolean', 'The diff may include other PRs, as in a batched merge.', NO_DIFF),
    entry('feature.shape.member_commits', 'git_diff_base_to_merge', 'integer', 'First-parent commits the PR contributed.', NO_DIFF),
    entry('feature.shape.complexity_delta', 'git_diff_base_to_merge', 'number', 'wavemill-cyclomatic/v1 at merge_sha minus base_sha.', 'No supported analyzer completed on both revisions.'),

    entry('feature.history.file_commits_90d', 'git_ancestors_of_base', 'integer', 'Commits touching the changed files in the 90 days before as_of.', NO_HISTORY),
    entry('feature.history.file_authors_90d', 'git_ancestors_of_base', 'integer', 'Distinct authors of those commits.', NO_HISTORY),
    entry('feature.history.file_fix_commits_90d', 'git_ancestors_of_base', 'integer', 'Those commits with a fix-shaped subject. Never read from label tables.', NO_HISTORY),
    entry('feature.history.newest_file_age_days', 'git_ancestors_of_base', 'number', 'Age of the most recently created changed file that already existed.', 'Every changed file is new, or history could not be read.'),
    entry('feature.history.new_files', 'git_ancestors_of_base', 'integer', 'Changed files absent at base_sha.', NO_HISTORY),

    entry('feature.author.repo_commits_prior', 'git_ancestors_of_base', 'integer', "The author's commits among ancestors of base_sha.", NO_HISTORY),
    entry('feature.author.touched_file_commits_prior', 'git_ancestors_of_base', 'integer', "The author's commits to the changed files among those ancestors.", NO_HISTORY),
    entry('feature.author.is_bot', 'immutable_pr_fact', 'boolean', 'GitHub reports the PR author as a bot.', NO_AUTHOR),

    entry('feature.agent.marker_present', 'github_events_until_as_of', 'boolean', 'The PR carries evidence of an agent tool. False means no marker was seen, not that a person wrote it unaided.', NO_MARKER_EVIDENCE),
    { ...entry('feature.agent.tool_family', 'github_events_until_as_of', 'category', 'The agent tool the markers name.', NO_MARKER_EVIDENCE), categories: AGENT_TOOL_FAMILIES },
    entry('feature.agent.marked_commit_share', 'pr_commits_at_merge', 'number', "Share of the PR's commits that carry a marker.", NO_COMMITS),

    entry('feature.process.review_count', 'github_events_until_as_of', 'integer', 'Reviews submitted by as_of.', NO_EVENTS),
    entry('feature.process.approvals', 'github_events_until_as_of', 'integer', 'Approvals submitted by as_of.', NO_EVENTS),
    entry('feature.process.changes_requested', 'github_events_until_as_of', 'integer', 'Change requests submitted by as_of, for any PR. Distinct from segment.provenance.change_requests.', NO_EVENTS),
    entry('feature.process.distinct_reviewers', 'github_events_until_as_of', 'integer', 'Distinct reviewers by as_of.', NO_EVENTS),
    entry('feature.process.hours_open', 'github_events_until_as_of', 'number', 'Hours from PR creation to as_of.', NO_EVENTS),
    entry('feature.process.hours_to_first_review', 'github_events_until_as_of', 'number', 'Hours from PR creation to the first review by as_of.', 'No review was submitted by as_of.'),
    entry('feature.process.github_label_count', 'github_events_until_as_of', 'integer', 'Labels on the PR at as_of, replayed from label events.', NO_EVENTS),
    entry('feature.process.title_chars', 'github_events_until_as_of', 'integer', 'Title length at as_of, replayed from rename events.', NO_EVENTS),
    entry('feature.process.body_chars', 'github_events_until_as_of', 'integer', 'Body length at as_of, replayed from edit history.', 'The body at as_of cannot be rebuilt from edit history.'),

    entry('feature.content.diff_sha256', 'git_diff_base_to_merge', 'content_sha256', 'Hash of the private diff that content arms read.', NO_DIFF),
    entry('feature.content.title_sha256', 'github_events_until_as_of', 'content_sha256', 'Hash of the private title at as_of.', NO_EVENTS),
    entry('feature.content.body_sha256', 'github_events_until_as_of', 'content_sha256', 'Hash of the private body at as_of.', 'The body at as_of cannot be rebuilt from edit history.'),

    entry('segment.provenance.agent_iterations', 'harness_contract', 'integer', 'Agent rework iterations.', NOT_INSTRUMENTED),
    entry('segment.provenance.self_review_iterations', 'harness_contract', 'integer', 'Agent self-review iterations.', NOT_INSTRUMENTED),
    entry('segment.provenance.human_intervention_count', 'harness_contract', 'integer', 'Human interventions during the run.', NOT_INSTRUMENTED),
    entry('segment.provenance.review_rounds', 'harness_contract', 'integer', 'Review rounds the harness recorded.', NOT_INSTRUMENTED),
    entry('segment.provenance.change_requests', 'harness_contract', 'integer', 'Change requests the harness recorded.', NOT_INSTRUMENTED),

    entry('segment.agent.exact_model', 'pr_commits_at_merge', 'category', 'The model a commit names, when exactly one is named. Most markers name only a tool.', 'No commit names exactly one model, or the commits could not be read.'),
    entry('segment.agent.marked_by_account', 'immutable_pr_fact', 'boolean', 'The PR author is a known agent bot account.', NO_AUTHOR),
    entry('segment.agent.marked_by_branch', 'immutable_pr_fact', 'boolean', "The PR's head branch has an agent tool's prefix.", 'GitHub reports no head branch for this PR.'),
    entry('segment.agent.marked_by_commit', 'pr_commits_at_merge', 'boolean', 'A commit has an agent author, co-author trailer, footer or model tag.', NO_COMMITS),
    entry('segment.agent.marked_by_body', 'github_events_until_as_of', 'boolean', 'The body at as_of has an agent footer or session link.', 'The body at as_of cannot be rebuilt from edit history.'),
    entry('segment.author.dependency_bot', 'immutable_pr_fact', 'boolean', 'The PR author is a dependency bot. Pre-registration section 2 reports these PRs separately.', NO_AUTHOR),

    {
      ...entry('segment.ci.checks_completed_by_merge', 'github_events_until_as_of', 'integer', 'CI results completed by as_of.', 'GitHub no longer retains CI results for this commit.'),
      availability: 'From 2025Q4 only; see docs/arbiter/merge-time-feature-manifest.md.',
    },
    {
      ...entry('segment.ci.checks_failed_by_merge', 'github_events_until_as_of', 'integer', 'CI failures completed by as_of.', 'GitHub no longer retains CI results for this commit.'),
      availability: 'From 2025Q4 only; see docs/arbiter/merge-time-feature-manifest.md.',
    },
  ]),
});

/**
 * Fields that read like features but are label-side or captured after merge.
 * The allowlist already rejects them; naming them makes the failure explain
 * itself, and the check also guards a manifest edit that declares one.
 */
export const LEAKAGE_DENYLIST = Object.freeze([
  // Corrective-rework and S2 outcome fields.
  'corrective', 'horizon_days', 'report_outcome', 'reason_codes', 'label_provenance',
  'labeller_version', 'normalization_version', 'definition_version', 'base_label_hash',
  // Repair pairs and candidates.
  'record_type', 'candidate_id', 'repair_pair_ids', 'proxy', 'confidence', 'lag_seconds',
  'fix', 'fix_only', 'original_only', 'fix_preexisting', 'fix_tests', 'line_survival',
  'graph_distance', 'original_review', 'evidence', 'status',
  // Exclusion and cause codes.
  'exclusion_code', 'exclusion_codes', 'cause_code', 'cause_codes', 'verdict',
  // Corpus record fields that hold post-merge or enumeration-time state.
  'relanded_merge_shas', 'closing_issues', 'labels', 'title', 'body',
]);

export type LeakageErrorCode =
  | 'invalid_manifest_version'
  | 'duplicate_entry'
  | 'invalid_namespace'
  | 'segment_flag_mismatch'
  | 'open_category_in_arm_input'
  | 'missing_as_of_source'
  | 'post_merge_as_of_source'
  | 'unknown_as_of_source'
  | 'label_field'
  | 'denied_field'
  | 'undeclared_column'
  | 'segment_in_arm_input'
  | 'invalid_as_of'
  | 'invalid_event_timestamp'
  | 'event_after_as_of';

export interface LeakageError extends Omit<HokusaiFieldError, 'code'> {
  code: LeakageErrorCode;
}

const FIELD_NAME = /^(feature|segment)\.[a-z_]+\.[a-z0-9_]+$/;

const isLabelField = (name: string) => name === 'label' || name.startsWith('label.');
const isDenied = (name: string) => LEAKAGE_DENYLIST.includes(name.split('.').at(-1) ?? name);

function nameError(path: string, name: string): LeakageError | null {
  if (isLabelField(name)) return { path, code: 'label_field', message: `${name} is label-side and can never be a feature.` };
  if (isDenied(name)) return { path, code: 'denied_field', message: `${name} is label-side or captured after merge.` };
  return null;
}

/** Validates the manifest itself. An entry that could see past `as_of` fails here. */
export function validateFeatureManifest(manifest: {
  manifest_version?: unknown;
  entries?: readonly object[];
}): LeakageError[] {
  const errors: LeakageError[] = [];
  if (typeof manifest.manifest_version !== 'string' || !/^rr-merge-features\/\d+\.\d+\.\d+$/.test(manifest.manifest_version)) {
    errors.push({ path: 'manifest_version', code: 'invalid_manifest_version', message: 'manifest_version must be rr-merge-features/<semver>.' });
  }
  const seen = new Set<string>();
  (manifest.entries ?? []).forEach((raw, index) => {
    const item = raw as { name?: unknown; segment?: unknown; as_of_source?: unknown; kind?: unknown; categories?: unknown };
    const path = `entries[${index}]`;
    const name = typeof item.name === 'string' ? item.name : '';
    if (seen.has(name)) errors.push({ path, code: 'duplicate_entry', message: `${name} is declared twice.` });
    seen.add(name);

    const denied = nameError(path, name);
    if (denied) errors.push(denied);
    else if (!FIELD_NAME.test(name)) errors.push({ path, code: 'invalid_namespace', message: `${name} must be feature.<group>.<field> or segment.<group>.<field>.` });

    if (item.segment !== name.startsWith('segment.')) {
      errors.push({ path, code: 'segment_flag_mismatch', message: `${name}: the segment flag must match the namespace.` });
    }

    if (item.kind === 'category' && !item.segment && !(Array.isArray(item.categories) && item.categories.length > 0)) {
      errors.push({ path, code: 'open_category_in_arm_input', message: `${name}: an arm input needs a closed list of categories.` });
    }

    const source = item.as_of_source;
    if (source === undefined || source === null || source === '') {
      errors.push({ path, code: 'missing_as_of_source', message: `${name} declares no as_of source.` });
    } else if ((POST_MERGE_SOURCES as readonly unknown[]).includes(source)) {
      errors.push({ path, code: 'post_merge_as_of_source', message: `${name}: ${JSON.stringify(source)} can see past as_of.` });
    } else if (!(FEATURE_AS_OF_SOURCES as readonly unknown[]).includes(source)) {
      errors.push({ path, code: 'unknown_as_of_source', message: `${name}: ${JSON.stringify(source)} is not a declared as_of source.` });
    }
  });
  return errors;
}

export interface ValidateFeatureColumnsOptions {
  /** Defaults to the current manifest. */
  manifest?: MergeTimeFeatureManifest;
  /** True only when reporting a segment. Arm inputs leave this off. */
  allowSegments?: boolean;
}

/**
 * The check every consumer runs on the columns it is about to use as features.
 * It fails closed: a column must be declared, so a new field cannot leak by
 * being added quietly. Pass feature columns only, not row identity or the target.
 */
export function validateFeatureColumns(
  columns: readonly string[],
  options: ValidateFeatureColumnsOptions = {},
): LeakageError[] {
  const manifest = options.manifest ?? REWORK_RISK_FEATURE_MANIFEST;
  const declared = new Map(manifest.entries.map((item) => [item.name, item]));
  const errors = validateFeatureManifest(manifest);
  columns.forEach((column, index) => {
    const path = `columns[${index}]`;
    const denied = nameError(path, column);
    if (denied) {
      errors.push(denied);
      return;
    }
    const item = declared.get(column);
    if (!item) errors.push({ path, code: 'undeclared_column', message: `${column} is not in ${manifest.manifest_version}.` });
    else if (item.segment && !options.allowSegments) errors.push({ path, code: 'segment_in_arm_input', message: `${column} is a segment feature and cannot be an arm input.` });
  });
  return errors;
}

export interface TimestampedEvidence {
  /** A stable name for error messages; carries no raw content. */
  source: string;
  at: string;
}

/**
 * Extractors call this on the evidence behind each row. It fails closed:
 * an unreadable timestamp is an error, because it cannot be shown to precede `as_of`.
 */
export function validateEvidenceAsOf(events: readonly TimestampedEvidence[], asOf: string): LeakageError[] {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) return [{ path: 'as_of', code: 'invalid_as_of', message: `${asOf} is not a timestamp.` }];
  const errors: LeakageError[] = [];
  events.forEach((event, index) => {
    const path = `events[${index}]`;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) errors.push({ path, code: 'invalid_event_timestamp', message: `${event.source} has no readable timestamp.` });
    else if (at > cutoff) errors.push({ path, code: 'event_after_as_of', message: `${event.source} at ${event.at} is after as_of ${asOf}.` });
  });
  return errors;
}
