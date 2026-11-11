/**
 * Captures timestamped GitHub evidence for merge-time features (HOK-3023).
 * Output holds raw titles, bodies and commit messages, so it stays in the local
 * cache and is never published. Batches are saved as they finish, so an
 * interrupted run resumes.
 *
 * GraphQL cost counts every possible nested connection, so commit fields here are
 * deliberately not connections: `authors` or `parents` under `commits(first:100)`
 * would cost about 25 times as much.
 *
 * Timeline events (labels, renames, dismissals) are captured separately. GitHub
 * caps the timeline nodes one query returns, about 310 across all aliases, and
 * past the cap it drops nodes while still reporting `hasNextPage: false`. Found
 * by the HOK-3023 spot check: a 25-PR batch returned 0 of one PR's 34 label
 * events. The timeline step splits any batch whose total nears the cap.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { GraphqlRunner } from './enumerate.js';
import { CI_FAILED_STATES, type CiEvidence, type PrEvidence } from './features.js';

export const EVIDENCE_BATCH_SIZE = 25;

/** The probe found no retained CI before 2025Q4; this leaves a quarter of margin. */
export const CI_CAPTURE_FROM = '2025-07-01T00:00:00Z';

export type CaptureKind = 'evidence' | 'ci' | 'timeline';

/** Well under the ~310 timeline nodes GitHub returns per query before it silently truncates. */
export const TIMELINE_SPLIT_NODES = 150;

interface PageInfo { hasNextPage: boolean; endCursor: string | null }
interface Connection<T> { pageInfo: PageInfo; nodes: (T | null)[] | null }

const PAGE = 'pageInfo{ hasNextPage endCursor }';
const REVIEWS = `${PAGE} nodes{ id state submittedAt author{ login } }`;
const TIMELINE = `${PAGE} nodes{ __typename
  ... on LabeledEvent{ createdAt label{ name } }
  ... on UnlabeledEvent{ createdAt label{ name } }
  ... on RenamedTitleEvent{ createdAt previousTitle currentTitle }
  ... on ReviewDismissedEvent{ createdAt previousReviewState review{ id } } }`;
const TIMELINE_TYPES = 'itemTypes:[LABELED_EVENT,UNLABELED_EVENT,RENAMED_TITLE_EVENT,REVIEW_DISMISSED_EVENT]';
const EDITS = `${PAGE} nodes{ editedAt diff }`;
const COMMITS = `${PAGE} nodes{ commit{ oid message author{ name email user{ login } } } }`;
const CONTEXTS = `${PAGE} nodes{ __typename ... on CheckRun{ completedAt conclusion } ... on StatusContext{ createdAt state } }`;

const EVIDENCE_FIELDS = `number createdAt mergedAt title body headRefName
  reviews(first:100){ ${REVIEWS} }
  userContentEdits(first:100){ ${EDITS} }
  commits(first:100){ ${COMMITS} }`;
const TIMELINE_FIELDS = `number timelineItems(first:100,${TIMELINE_TYPES}){ ${TIMELINE} }`;
const CI_FIELDS = `number commits(last:1){ nodes{ commit{ statusCheckRollup{ contexts(first:100){ ${CONTEXTS} } } } } }`;

/** One connection's further pages on one PR. */
const FOLLOW_UPS = {
  reviews: { args: '', nodes: REVIEWS },
  userContentEdits: { args: '', nodes: EDITS },
  commits: { args: '', nodes: COMMITS },
} as const;

type PrResponse = Record<string, unknown> & { number: number };
type Repository = Record<string, PrResponse | null>;

function runQuery(graphql: GraphqlRunner, repo: string, fields: string): Repository {
  const [owner, name] = repo.split('/') as [string, string];
  const data = graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name }) as { repository: Repository };
  return data.repository;
}

const TIMELINE_FOLLOW_UP = { timelineItems: { args: `${TIMELINE_TYPES},`, nodes: TIMELINE } } as const;

function drainConnections(pr: PrResponse, repo: string, graphql: GraphqlRunner, followUps: Record<string, { args: string; nodes: string }> = FOLLOW_UPS): void {
  for (const key of Object.keys(followUps)) {
    const connection = pr[key] as Connection<unknown>;
    let info = connection.pageInfo;
    while (info.hasNextPage) {
      const follow = followUps[key]!;
      const page = runQuery(graphql, repo, `pr: pullRequest(number:${pr.number}){ ${key}(${follow.args}first:100,after:${JSON.stringify(info.endCursor)}){ ${follow.nodes} } }`);
      const next = page['pr']?.[key] as Connection<unknown> | undefined;
      if (!next) throw new Error(`PR ${pr.number}: ${key} page disappeared`);
      connection.nodes = [...(connection.nodes ?? []), ...(next.nodes ?? [])];
      info = next.pageInfo;
    }
  }
}

interface RawReview { id: string; state: string; submittedAt: string | null; author: { login: string } | null }
type RawTimeline = { __typename: string; createdAt: string; label?: { name: string } | null; previousTitle?: string; currentTitle?: string; previousReviewState?: string | null; review?: { id: string } | null };
interface RawEdit { editedAt: string; diff: string | null }
interface RawCommit { commit: { oid: string; message: string; author: { name: string | null; email: string | null; user: { login: string } | null } | null } }

const present = <T>(connection: unknown): T[] => ((connection as Connection<T>).nodes ?? []).filter((node): node is NonNullable<typeof node> => node !== null);

/** Timeline events for one PR, from the separate timeline capture. */
export type TimelineEvidence = Pick<PrEvidence, 'pr_number' | 'dismissals' | 'label_events' | 'renames'>;

export function normalizeTimeline(pr: PrResponse): TimelineEvidence {
  const timeline = present<RawTimeline>(pr['timelineItems']);
  return {
    pr_number: pr.number,
    dismissals: timeline.filter((event) => event.__typename === 'ReviewDismissedEvent').map((event) => ({ at: event.createdAt, previous_state: event.previousReviewState ?? null, review_id: event.review?.id ?? null })),
    label_events: timeline.filter((event) => event.__typename === 'LabeledEvent' || event.__typename === 'UnlabeledEvent').map((event) => ({ at: event.createdAt, action: event.__typename === 'LabeledEvent' ? 'added' as const : 'removed' as const, label: event.label?.name ?? null })),
    renames: timeline.filter((event) => event.__typename === 'RenamedTitleEvent').map((event) => ({ at: event.createdAt, from: event.previousTitle ?? '', to: event.currentTitle ?? '' })),
  };
}

/** Everything but the timeline events, which `mergeTimeline` adds from the timeline capture. */
export function normalizeEvidence(pr: PrResponse): PrEvidence {
  return {
    pr_number: pr.number,
    created_at: pr['createdAt'] as string,
    merged_at: (pr['mergedAt'] as string | null) ?? null,
    title: pr['title'] as string,
    body: (pr['body'] as string | null) ?? null,
    head_ref: (pr['headRefName'] as string | null) ?? null,
    reviews: present<RawReview>(pr['reviews']).map((review) => ({ id: review.id, state: review.state, submitted_at: review.submittedAt, author: review.author?.login ?? null })),
    dismissals: [],
    label_events: [],
    renames: [],
    body_edits: present<RawEdit>(pr['userContentEdits']).map((edit) => ({ at: edit.editedAt, body: edit.diff })),
    commits: present<RawCommit>(pr['commits']).map(({ commit }) => ({ oid: commit.oid, message: commit.message, author_name: commit.author?.name ?? null, author_email: commit.author?.email ?? null, author_login: commit.author?.user?.login ?? null })),
  };
}

type RawContext = { __typename: string; completedAt?: string | null; conclusion?: string | null; createdAt?: string | null; state?: string | null };

export function normalizeCi(pr: PrResponse): CiEvidence | null {
  const head = (pr['commits'] as { nodes: ({ commit: { statusCheckRollup: { contexts: unknown } | null } } | null)[] | null }).nodes?.[0];
  const rollup = head?.commit.statusCheckRollup;
  if (!rollup) return null;
  return {
    pr_number: pr.number,
    contexts: present<RawContext>(rollup.contexts).map((context) => ({
      at: context.completedAt ?? context.createdAt ?? null,
      failed: CI_FAILED_STATES.includes(context.conclusion ?? context.state ?? ''),
    })),
  };
}

function drainContexts(pr: PrResponse, repo: string, graphql: GraphqlRunner): void {
  const rollup = (pr['commits'] as { nodes: ({ commit: { statusCheckRollup: { contexts: Connection<unknown> } | null } } | null)[] | null }).nodes?.[0]?.commit.statusCheckRollup;
  if (!rollup) return;
  let info = rollup.contexts.pageInfo;
  while (info.hasNextPage) {
    const page = runQuery(graphql, repo, `pr: pullRequest(number:${pr.number}){ commits(last:1){ nodes{ commit{ statusCheckRollup{ contexts(first:100,after:${JSON.stringify(info.endCursor)}){ ${CONTEXTS} } } } } } }`);
    const next = (page['pr']?.['commits'] as { nodes: { commit: { statusCheckRollup: { contexts: Connection<unknown> } | null } }[] } | undefined)?.nodes[0]?.commit.statusCheckRollup?.contexts;
    if (!next) break;
    rollup.contexts.nodes = [...(rollup.contexts.nodes ?? []), ...(next.nodes ?? [])];
    info = next.pageInfo;
  }
}

export type CapturedItem<T> = { pr_number: number; value: T | null; error: string | null };

/** A batch that fails is split, so one oversized PR cannot lose its neighbours. */
function fetchBatch<T>(kind: CaptureKind, repo: string, numbers: readonly number[], graphql: GraphqlRunner, log: (line: string) => void): CapturedItem<T>[] {
  if (kind === 'timeline') return fetchTimeline(repo, numbers, graphql, log) as CapturedItem<T>[];
  try {
    const fields = kind === 'evidence' ? EVIDENCE_FIELDS : CI_FIELDS;
    const repository = runQuery(graphql, repo, numbers.map((number) => `pr${number}: pullRequest(number:${number}){ ${fields} }`).join('\n'));
    return numbers.map((number) => {
      const pr = repository[`pr${number}`];
      if (!pr) return { pr_number: number, value: null, error: 'not_found' };
      if (kind === 'evidence') {
        drainConnections(pr, repo, graphql);
        return { pr_number: number, value: normalizeEvidence(pr) as T, error: null };
      }
      drainContexts(pr, repo, graphql);
      return { pr_number: number, value: normalizeCi(pr) as T | null, error: null };
    });
  } catch (error) {
    if (numbers.length > 1) {
      const middle = numbers.length >>> 1;
      return [...fetchBatch<T>(kind, repo, numbers.slice(0, middle), graphql, log), ...fetchBatch<T>(kind, repo, numbers.slice(middle), graphql, log)];
    }
    log(`warn: ${repo}: PR ${numbers[0]} ${kind} capture failed: ${(error as Error).message.slice(0, 160)}`);
    return [{ pr_number: numbers[0]!, value: null, error: 'capture_failed' }];
  }
}

/**
 * Timeline events for a batch. A batch whose nodes near GitHub's per-query cap is
 * split, because a truncated answer looks complete; a single PR pages normally.
 */
function fetchTimeline(repo: string, numbers: readonly number[], graphql: GraphqlRunner, log: (line: string) => void): CapturedItem<TimelineEvidence>[] {
  const split = () => {
    const middle = numbers.length >>> 1;
    return [...fetchTimeline(repo, numbers.slice(0, middle), graphql, log), ...fetchTimeline(repo, numbers.slice(middle), graphql, log)];
  };
  let repository: Repository;
  try {
    repository = runQuery(graphql, repo, numbers.map((number) => `pr${number}: pullRequest(number:${number}){ ${TIMELINE_FIELDS} }`).join('\n'));
  } catch (error) {
    if (numbers.length > 1) return split();
    log(`warn: ${repo}: PR ${numbers[0]} timeline capture failed: ${(error as Error).message.slice(0, 160)}`);
    return [{ pr_number: numbers[0]!, value: null, error: 'capture_failed' }];
  }
  const nodes = numbers.reduce((sum, number) => sum + (((repository[`pr${number}`]?.['timelineItems'] as Connection<unknown> | undefined)?.nodes ?? []).length), 0);
  if (numbers.length > 1 && nodes >= TIMELINE_SPLIT_NODES) return split();
  return numbers.map((number) => {
    const pr = repository[`pr${number}`];
    if (!pr) return { pr_number: number, value: null, error: 'not_found' };
    try {
      drainConnections(pr, repo, graphql, TIMELINE_FOLLOW_UP);
    } catch (error) {
      log(`warn: ${repo}: PR ${number} timeline capture failed: ${(error as Error).message.slice(0, 160)}`);
      return { pr_number: number, value: null, error: 'capture_failed' };
    }
    return { pr_number: number, value: normalizeTimeline(pr), error: null };
  });
}

export const captureDir = (repoDir: string, kind: CaptureKind) => join(repoDir, 'feature-evidence', kind);
const batchPath = (dir: string, numbers: readonly number[]) => join(dir, `${numbers[0]}-${numbers.at(-1)}.json.gz`);

export function chunkNumbers(numbers: readonly number[]): number[][] {
  const sorted = [...numbers].sort((a, b) => a - b);
  const chunks: number[][] = [];
  for (let i = 0; i < sorted.length; i += EVIDENCE_BATCH_SIZE) chunks.push(sorted.slice(i, i + EVIDENCE_BATCH_SIZE));
  return chunks;
}

export function captureRepo(
  kind: CaptureKind,
  repo: string,
  repoDir: string,
  numbers: readonly number[],
  graphql: GraphqlRunner,
  log: (line: string) => void,
  now: () => Date = () => new Date(),
): { batches: number; fetched: number; failed: number } {
  const dir = captureDir(repoDir, kind);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chunks = chunkNumbers(numbers);
  let fetched = 0;
  let failed = 0;
  chunks.forEach((chunk, index) => {
    const path = batchPath(dir, chunk);
    if (existsSync(path)) return;
    const items = fetchBatch(kind, repo, chunk, graphql, log);
    failed += items.filter((item) => item.error === 'capture_failed').length;
    fetched += chunk.length;
    const scratch = `${path}.partial`;
    writeFileSync(scratch, gzipSync(JSON.stringify({ captured_at: now().toISOString(), items })), { mode: 0o600 });
    renameSync(scratch, path);
    if (index % 100 === 0) log(`info: ${repo}: ${kind} batch ${index + 1}/${chunks.length}`);
  });
  return { batches: chunks.length, fetched, failed };
}

export function readCapturedBatch<T>(repoDir: string, kind: CaptureKind, chunk: readonly number[]): { captured_at: string; items: CapturedItem<T>[] } | null {
  const path = batchPath(captureDir(repoDir, kind), chunk);
  if (!existsSync(path)) return null;
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as { captured_at: string; items: CapturedItem<T>[] };
}
