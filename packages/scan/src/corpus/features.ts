/**
 * Pure merge-time feature extraction (HOK-3023). Given evidence captured at any
 * later date, `extractPrFeatures` returns what was knowable at `as_of`. It reads
 * no clock, git or network, so the replay test can prove that history after the
 * merge cannot change a row: see `truncateEvidenceAt`.
 *
 * Current GitHub state is used only where nothing changed it: the current title
 * or body stands in only when the PR has no rename or edit at all.
 */

import { createHash } from 'node:crypto';
import {
  REWORK_RISK_FEATURE_MANIFEST,
  REWORK_RISK_FEATURE_MANIFEST_VERSION,
  validateEvidenceAsOf,
  type AsOfBasis,
} from '@hokusai/core';
import { agentMarkerColumns, detectAgentMarkers, type AgentMarkerCommit } from '../attribution/agent-markers.js';
import type { CorpusPrRecord } from './enumerate.js';

export interface EvidenceCommit {
  oid: string;
  message: string;
  author_name: string | null;
  author_email: string | null;
  author_login: string | null;
}

/** Everything captured for one PR. Holds raw text: private, never published. */
export interface PrEvidence {
  pr_number: number;
  created_at: string;
  merged_at: string | null;
  title: string;
  body: string | null;
  head_ref: string | null;
  reviews: { id: string; state: string; submitted_at: string | null; author: string | null }[];
  dismissals: { at: string; previous_state: string | null; review_id: string | null }[];
  label_events: { at: string; action: 'added' | 'removed'; label: string | null }[];
  renames: { at: string; from: string; to: string }[];
  /** Full body versions. When a body was edited, the oldest is the original. */
  body_edits: { at: string; body: string | null }[];
  commits: EvidenceCommit[];
}

export interface CiEvidence {
  pr_number: number;
  /** Each CI result on the PR's head commit. `at` is when it finished. */
  contexts: { at: string | null; failed: boolean }[];
}

/** Columns computed from git, supplied by the caller (see feature-git.ts). */
export type GitFeatureColumns = Record<string, number | boolean | string | null>;

export interface FeatureRow {
  manifest_version: string;
  repo: string;
  pr_number: number;
  merge_sha: string;
  base_sha: string;
  landed_by: CorpusPrRecord['landed_by'];
  as_of: string;
  as_of_basis: AsOfBasis | null;
  features: Record<string, number | boolean | string | null>;
}

export const MANIFEST_COLUMNS: readonly string[] = REWORK_RISK_FEATURE_MANIFEST.entries.map((entry) => entry.name);

/** Failure conclusions only: a cancelled run is usually superseded, not broken. */
export const CI_FAILED_STATES: readonly string[] = ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ERROR'];

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const hours = (ms: number) => Number((ms / 3_600_000).toFixed(4));

function ms(at: string): number {
  return Date.parse(at);
}

function byTime<T extends { at: string }>(events: readonly T[]): T[] {
  return events.map((event, index) => ({ event, index })).sort((a, b) => ms(a.event.at) - ms(b.event.at) || a.index - b.index).map(({ event }) => event);
}

/** The title at `as_of`, from rename events. */
export function titleAt(evidence: PrEvidence, asOf: string): string {
  const renames = byTime(evidence.renames);
  if (renames.length === 0) return evidence.title;
  const cutoff = ms(asOf);
  const seen = renames.filter((rename) => ms(rename.at) <= cutoff);
  return seen.at(-1)?.to ?? renames[0]!.from;
}

/** The body at `as_of`, from edit history, or null when that version is gone. */
export function bodyAt(evidence: PrEvidence, asOf: string): string | null {
  if (evidence.body_edits.length === 0) return evidence.body ?? '';
  const cutoff = ms(asOf);
  return byTime(evidence.body_edits).filter((edit) => ms(edit.at) <= cutoff).at(-1)?.body ?? null;
}

/** Labels at `as_of`, or null when an event no longer names its label. */
export function labelsAt(evidence: PrEvidence, asOf: string): string[] | null {
  const cutoff = ms(asOf);
  const labels = new Set<string>();
  for (const event of byTime(evidence.label_events)) {
    if (ms(event.at) > cutoff) continue;
    if (event.label === null) return null;
    if (event.action === 'added') labels.add(event.label);
    else labels.delete(event.label);
  }
  return [...labels].sort();
}

/** Reviews by `as_of`, each in the state it held then. A later dismissal does not count. */
export function reviewsAt(evidence: PrEvidence, asOf: string): { state: string; submitted_at: string; author: string | null }[] {
  const cutoff = ms(asOf);
  const dismissedLater = new Map(
    evidence.dismissals.filter((event) => ms(event.at) > cutoff && event.review_id).map((event) => [event.review_id!, event.previous_state]),
  );
  return evidence.reviews
    .filter((review) => review.submitted_at !== null && ms(review.submitted_at) <= cutoff)
    .map((review) => ({
      state: dismissedLater.get(review.id) ?? review.state,
      submitted_at: review.submitted_at!,
      author: review.author,
    }));
}

function assertReadableEvidence(evidence: PrEvidence, ci: CiEvidence | null, asOf: string): void {
  const events = [
    { source: 'created_at', at: evidence.created_at },
    ...evidence.reviews.flatMap((review) => (review.submitted_at ? [{ source: 'review', at: review.submitted_at }] : [])),
    ...evidence.dismissals.map((event) => ({ source: 'dismissal', at: event.at })),
    ...evidence.label_events.map((event) => ({ source: 'label_event', at: event.at })),
    ...evidence.renames.map((event) => ({ source: 'rename', at: event.at })),
    ...evidence.body_edits.map((event) => ({ source: 'body_edit', at: event.at })),
    ...(ci?.contexts ?? []).flatMap((context) => (context.at ? [{ source: 'ci', at: context.at }] : [])),
  ];
  // Later events are expected here and are filtered out by each reader above. Only
  // unreadable timestamps fail, because they cannot be shown to precede as_of.
  const errors = validateEvidenceAsOf(events, asOf).filter((error) => error.code !== 'event_after_as_of');
  if (errors.length) throw new Error(`pr evidence: ${errors[0]!.message}`);
}

function processColumns(evidence: PrEvidence | null, ci: CiEvidence | null, asOf: string): GitFeatureColumns {
  const empty = {
    'feature.process.review_count': null,
    'feature.process.approvals': null,
    'feature.process.changes_requested': null,
    'feature.process.distinct_reviewers': null,
    'feature.process.hours_open': null,
    'feature.process.hours_to_first_review': null,
    'feature.process.github_label_count': null,
    'feature.process.title_chars': null,
    'feature.process.body_chars': null,
    'feature.content.title_sha256': null,
    'feature.content.body_sha256': null,
  };
  const ciColumns = {
    'segment.ci.checks_completed_by_merge': null as number | null,
    'segment.ci.checks_failed_by_merge': null as number | null,
  };
  if (ci) {
    const cutoff = ms(asOf);
    const finished = ci.contexts.filter((context) => context.at !== null && ms(context.at) <= cutoff);
    if (finished.length > 0) {
      ciColumns['segment.ci.checks_completed_by_merge'] = finished.length;
      ciColumns['segment.ci.checks_failed_by_merge'] = finished.filter((context) => context.failed).length;
    }
  }
  if (!evidence) return { ...empty, ...ciColumns };

  const reviews = reviewsAt(evidence, asOf);
  const created = ms(evidence.created_at);
  const open = ms(asOf) - created;
  const first = reviews.length ? Math.min(...reviews.map((review) => ms(review.submitted_at))) : null;
  const labels = labelsAt(evidence, asOf);
  const title = titleAt(evidence, asOf);
  const body = bodyAt(evidence, asOf);
  return {
    'feature.process.review_count': reviews.length,
    'feature.process.approvals': reviews.filter((review) => review.state === 'APPROVED').length,
    'feature.process.changes_requested': reviews.filter((review) => review.state === 'CHANGES_REQUESTED').length,
    'feature.process.distinct_reviewers': new Set(reviews.flatMap((review) => (review.author ? [review.author] : []))).size,
    'feature.process.hours_open': open >= 0 ? hours(open) : null,
    'feature.process.hours_to_first_review': first !== null && first >= created ? hours(first - created) : null,
    'feature.process.github_label_count': labels ? labels.length : null,
    'feature.process.title_chars': title.length,
    'feature.process.body_chars': body === null ? null : body.length,
    'feature.content.title_sha256': sha256(title),
    'feature.content.body_sha256': body === null ? null : sha256(body),
    ...ciColumns,
  };
}

const MERGE_SUBJECT = /^Merge (?:branch|remote-tracking branch|pull request|tag|commit)\b|^Merge .+ into .+/;

function markerCommits(evidence: PrEvidence | null): AgentMarkerCommit[] | null {
  if (!evidence) return null;
  // Updating a branch from main leaves a merge commit that says nothing about who wrote the PR.
  return evidence.commits
    .filter((commit) => !MERGE_SUBJECT.test(commit.message))
    .map((commit) => ({
      message: commit.message,
      ...(commit.author_name ? { authorName: commit.author_name } : {}),
      ...(commit.author_email ? { authorEmail: commit.author_email } : {}),
    }));
}

export interface ExtractInput {
  record: CorpusPrRecord;
  evidence: PrEvidence | null;
  ci: CiEvidence | null;
  /** The landing commit's message; omit for a batched landing, which also holds other PRs. */
  landingMessage?: string | null;
  git: GitFeatureColumns;
}

/** One row. Every manifest column is present, and no others. */
export function extractPrFeatures(input: ExtractInput): FeatureRow {
  const { record, evidence, ci, git } = input;
  const asOf = record.merged_at;
  if (evidence) {
    assertReadableEvidence(evidence, ci, asOf);
    if (evidence.pr_number !== record.pr_number) throw new Error(`evidence is for PR ${evidence.pr_number}, not ${record.pr_number}`);
    if (evidence.merged_at !== null && ms(evidence.merged_at) !== ms(asOf)) throw new Error(`PR ${record.pr_number}: GitHub's merge time disagrees with the corpus record`);
  } else if (ci) {
    assertReadableEvidence({ pr_number: record.pr_number, created_at: asOf, merged_at: null, title: '', body: null, head_ref: null, reviews: [], dismissals: [], label_events: [], renames: [], body_edits: [], commits: [] }, ci, asOf);
  }

  const body = evidence ? bodyAt(evidence, asOf) : null;
  const markers = detectAgentMarkers({
    authorLogin: record.author_login,
    authorType: record.author_type,
    headRef: evidence?.head_ref ?? null,
    commits: markerCommits(evidence),
    body,
    ...(body === null ? { bodyUnavailable: true } : {}),
    ...(input.landingMessage ? { landingMessage: input.landingMessage } : {}),
  });

  const features: FeatureRow['features'] = {
    ...Object.fromEntries(MANIFEST_COLUMNS.map((column) => [column, null])),
    'feature.shape.member_commits': record.member_commits,
    'feature.shape.diff_uncertain': record.batched,
    'feature.author.is_bot': record.author_type === null ? null : record.author_type === 'Bot',
    ...git,
    ...processColumns(evidence, ci, asOf),
    ...agentMarkerColumns(markers),
  };
  const undeclared = Object.keys(features).filter((column) => !MANIFEST_COLUMNS.includes(column));
  if (undeclared.length) throw new Error(`undeclared feature columns: ${undeclared.join(', ')}`);

  return {
    manifest_version: REWORK_RISK_FEATURE_MANIFEST_VERSION,
    repo: record.repo,
    pr_number: record.pr_number,
    merge_sha: record.merge_sha,
    base_sha: record.base_sha,
    landed_by: record.landed_by,
    as_of: asOf,
    as_of_basis: evidence === null ? null : evidence.merged_at !== null ? 'github_merged_at' : 'landing_commit_time',
    features: Object.fromEntries(MANIFEST_COLUMNS.map((column) => [column, features[column] ?? null])),
  };
}

/**
 * The evidence as it would have read at `as_of`: later events gone, and current
 * title and body rolled back. The replay test requires that extraction from this
 * and from the full evidence produce byte-identical rows.
 */
export function truncateEvidenceAt(evidence: PrEvidence, asOf: string): PrEvidence {
  const cutoff = ms(asOf);
  const before = <T extends { at: string }>(events: readonly T[]) => events.filter((event) => ms(event.at) <= cutoff);
  const body = bodyAt(evidence, asOf);
  const dismissedLater = new Map(
    evidence.dismissals.filter((event) => ms(event.at) > cutoff && event.review_id).map((event) => [event.review_id!, event.previous_state]),
  );
  return {
    ...evidence,
    title: titleAt(evidence, asOf),
    body,
    reviews: evidence.reviews
      .filter((review) => review.submitted_at !== null && ms(review.submitted_at) <= cutoff)
      .map((review) => ({ ...review, state: dismissedLater.get(review.id) ?? review.state })),
    dismissals: before(evidence.dismissals),
    label_events: before(evidence.label_events),
    renames: before(evidence.renames),
    // With no version left, an empty history would read the rolled-back body, null, as ''.
    body_edits: body === null ? [{ at: evidence.created_at, body: null }] : before(evidence.body_edits),
  };
}
