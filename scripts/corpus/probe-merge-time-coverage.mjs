#!/usr/bin/env node
/**
 * Merge-time evidence coverage probe (HOK-3023, Phase 1).
 *
 * Measures, per cohort repo and quarter, how much of the merge-time evidence
 * GitHub can still return for merged PRs, and how much of it postdates the
 * merge. It decides whether CI signals can enter the frozen feature set.
 *
 * Output is aggregate counts only: no PR numbers, titles, bodies, logins or
 * labels are written, and no corpus label file is read. Treating every
 * runnable repo the same keeps the run from revealing the evaluation slice.
 *
 * Sampling: the first --per-month PRs by creation date among those merged in
 * days 10-16 of each month. Ordering by creation date avoids the bias that
 * sorting by update time would add towards PRs with post-merge activity.
 *
 * Usage:
 *   node scripts/corpus/probe-merge-time-coverage.mjs \
 *     --manifest fixtures/arbiter/corpus/hok-3022-cohort.json \
 *     --out fixtures/arbiter/corpus/hok-3023-merge-time-coverage.json \
 *     [--per-month 15] [--repo owner/name] [--concurrency 3]
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';

const run = promisify(execFile);
const RUNNABLE = new Set(['kept', 'pending_exception', 'unmeasured']);
const RETRYABLE = /HTTP 50[234]|secondary rate limit|abuse|timed? ?out|ETIMEDOUT|ECONNRESET|Something went wrong|unexpected EOF|connection reset/i;
const ATTEMPTS = 5;

const QUERY = `query($q:String!,$n:Int!){
  rateLimit{ remaining resetAt }
  search(type:ISSUE, query:$q, first:$n){
    nodes{ ... on PullRequest {
      mergedAt baseRefName
      timelineItems(first:100, itemTypes:[LABELED_EVENT,UNLABELED_EVENT,RENAMED_TITLE_EVENT]){
        nodes{ __typename ... on LabeledEvent{createdAt} ... on UnlabeledEvent{createdAt} ... on RenamedTitleEvent{createdAt} }
      }
      userContentEdits(first:20){ nodes{ editedAt } }
      reviews(first:50){ totalCount nodes{ submittedAt } }
      mergeCommit{ statusCheckRollup{ contexts(first:1){ totalCount } } }
      commits(last:1){ nodes{ commit{
        checkSuites(first:1){ totalCount }
        statusCheckRollup{ contexts(first:100){ totalCount nodes{
          __typename ... on CheckRun{ completedAt } ... on StatusContext{ createdAt }
        } } }
      } } }
    } }
  }
}`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function graphql(q, n) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const { stdout } = await run(
        'gh',
        ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${q}`, '-F', `n=${n}`],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      return JSON.parse(stdout).data;
    } catch (error) {
      lastError = error;
      const text = `${error.message}\n${error.stderr ?? ''}`;
      if (!RETRYABLE.test(text)) throw error;
      await sleep(2 ** attempt * 1000);
    }
  }
  throw lastError;
}

function emptyCell(repo, quarter) {
  return {
    repo,
    quarter,
    months_sampled: 0,
    months_failed: 0,
    prs: 0,
    head_rollup_present: 0,
    head_check_suites_present: 0,
    merge_commit_rollup_present: 0,
    ci_usable_at_merge: 0,
    ci_contexts: 0,
    ci_contexts_after_merge: 0,
    ci_contexts_undated: 0,
    prs_with_reviews: 0,
    reviews_after_merge: 0,
    label_events_after_merge: 0,
    renames_after_merge: 0,
    body_edits_after_merge: 0,
  };
}

/** Compares instants, not strings, so differing ISO precision cannot misorder them. */
const isAfter = (timestamp, cutoffMs) => Date.parse(timestamp) > cutoffMs;

function addPr(cell, pr) {
  const cutoff = Date.parse(pr.mergedAt);
  cell.prs += 1;

  for (const event of pr.timelineItems.nodes) {
    if (!event.createdAt || !isAfter(event.createdAt, cutoff)) continue;
    if (event.__typename === 'RenamedTitleEvent') cell.renames_after_merge += 1;
    else cell.label_events_after_merge += 1;
  }
  cell.body_edits_after_merge += pr.userContentEdits.nodes.filter((edit) => edit.editedAt && isAfter(edit.editedAt, cutoff)).length;

  if (pr.reviews.totalCount > 0) cell.prs_with_reviews += 1;
  cell.reviews_after_merge += pr.reviews.nodes.filter((review) => review.submittedAt && isAfter(review.submittedAt, cutoff)).length;

  if (pr.mergeCommit?.statusCheckRollup) cell.merge_commit_rollup_present += 1;

  const head = pr.commits.nodes[0]?.commit;
  if ((head?.checkSuites?.totalCount ?? 0) > 0) cell.head_check_suites_present += 1;
  const rollup = head?.statusCheckRollup;
  if (!rollup) return;
  cell.head_rollup_present += 1;
  cell.ci_contexts += rollup.contexts.totalCount;
  let usable = false;
  for (const context of rollup.contexts.nodes) {
    const finished = context.completedAt ?? context.createdAt;
    if (!finished) cell.ci_contexts_undated += 1;
    else if (isAfter(finished, cutoff)) cell.ci_contexts_after_merge += 1;
    else usable = true;
  }
  if (usable) cell.ci_usable_at_merge += 1;
}

function monthsInWindow(window) {
  const months = [];
  const end = new Date(`${window.merged_until}T00:00:00Z`);
  const cursor = new Date(`${window.merged_from.slice(0, 7)}-01T00:00:00Z`);
  while (cursor < end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

const quarterOf = (month) => `${month.slice(0, 4)}Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;

async function probeMonth(entry, month, perMonth, cells) {
  const key = `${entry.repo}|${quarterOf(month)}`;
  const cell = cells.get(key) ?? emptyCell(entry.repo, quarterOf(month));
  cells.set(key, cell);
  const q = `repo:${entry.repo} is:pr is:merged merged:${month}-10..${month}-16 sort:created-asc`;
  try {
    const data = await graphql(q, perMonth);
    for (const pr of data.search.nodes) if (pr?.mergedAt) addPr(cell, pr);
    cell.months_sampled += 1;
    return data.rateLimit;
  } catch (error) {
    cell.months_failed += 1;
    process.stderr.write(`warn: ${entry.repo} ${month}: ${String(error.stderr ?? error.message).slice(0, 200).trim()}\n`);
    return null;
  }
}

const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    out: { type: 'string' },
    repo: { type: 'string' },
    'per-month': { type: 'string', default: '15' },
    concurrency: { type: 'string', default: '3' },
  },
});
if (!values.manifest || !values.out) {
  process.stderr.write('error: --manifest and --out are required\n');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
const perMonth = Number(values['per-month']);
const entries = [...manifest.repos, ...manifest.alternates]
  .filter((repo) => RUNNABLE.has(repo.status))
  .filter((repo) => !values.repo || repo.repo === values.repo);
const months = monthsInWindow(manifest.window);
const tasks = entries.flatMap((entry) => months.map((month) => ({ entry, month })));
process.stderr.write(`probing ${entries.length} repos, ${months.length} months, ${tasks.length} queries\n`);

const cells = new Map();
let next = 0;
let done = 0;
await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
  while (next < tasks.length) {
    const { entry, month } = tasks[next];
    next += 1;
    const limit = await probeMonth(entry, month, perMonth, cells);
    done += 1;
    if (done % 25 === 0) process.stderr.write(`${done}/${tasks.length} remaining_points=${limit?.remaining ?? '?'}\n`);
    if (limit && limit.remaining < 50) await sleep(Math.max(0, Date.parse(limit.resetAt) - Date.now()) + 5000);
  }
}));

const rows = [...cells.values()].sort((a, b) => a.repo.localeCompare(b.repo) || a.quarter.localeCompare(b.quarter));
writeFileSync(values.out, `${JSON.stringify({
  issue: 'HOK-3023',
  probe_version: '1.0.0',
  sampling: { per_month: perMonth, days_of_month: '10-16', order: 'created-asc' },
  window: manifest.window,
  repos: entries.length,
  cells: rows,
}, null, 2)}\n`);
process.stderr.write(`wrote ${rows.length} cells to ${values.out}\n`);
