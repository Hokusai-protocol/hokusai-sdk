#!/usr/bin/env node
/**
 * Independent spot check of merge-time feature rows (HOK-3023, Phase 4).
 *
 * Recomputes the main columns for a stratified sample of development-repo PRs
 * from sources the extractor does not use: GitHub's REST API (pull, timeline
 * and commits endpoints, where capture used GraphQL) and plain `git` commands
 * (where extraction used the in-memory history index). Then compares each with
 * the published row.
 *
 * Evaluation-slice repos are dropped before sampling. Per-PR results go to the
 * private --out directory. The pooled summary, written to --summary, holds only
 * agreement counts per column: no repo names, PR numbers or per-repo figures.
 *
 * Usage:
 *   node scripts/corpus/spot-check-merge-features.mjs \
 *     --manifest <cohort.json> --cache-dir ~/hokusai-data/arbiter-corpus \
 *     --exclude-slice ~/.hokusai-private/hok-3028-slice.json \
 *     --out ~/.hokusai-private/hok-3023-spot-check --summary <pooled.json> [--per-type 12] [--seed <hex>]
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';

const RUNNABLE = new Set(['kept', 'pending_exception', 'unmeasured']);
const TYPES = ['squash', 'merge_commit', 'rebase', 'number_ref', 'rollup'];
const DAY = 86_400_000;

const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    'cache-dir': { type: 'string' },
    'exclude-slice': { type: 'string' },
    out: { type: 'string' },
    summary: { type: 'string' },
    'per-type': { type: 'string', default: '12' },
    seed: { type: 'string' },
  },
});
for (const name of [
  'manifest',
  'cache-dir',
  'exclude-slice',
  'out',
  'summary',
]) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const outDir = resolve(values.out);
for (let dir = outDir; dir !== resolve(dir, '..'); dir = resolve(dir, '..')) {
  if (existsSync(join(dir, '.git')))
    throw new Error('--out must be outside any git work tree');
}
if (existsSync(outDir) && readdirSync(outDir).length)
  throw new Error(`${outDir} is not empty`);

const sliceBytes = readFileSync(resolve(values['exclude-slice']));
const slice = new Set(JSON.parse(sliceBytes).repos);
const cohort = JSON.parse(readFileSync(resolve(values.manifest), 'utf8'));
const development = [...cohort.repos, ...(cohort.alternates ?? [])]
  .filter((e) => RUNNABLE.has(e.status) && !slice.has(e.repo))
  .map((e) => e.repo);
const cache = resolve(values['cache-dir']);
const seed = values.seed ?? randomBytes(32).toString('hex');
const perType = Number(values['per-type']);

let counter = 0;
const random = () =>
  createHash('sha256').update(`${seed}:${counter++}`).digest().readUInt32BE(0) /
  2 ** 32;
const shuffle = (items) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// ---- sample: per landed_by type, round-robin across the repos that have it ----
const rowsByRepo = new Map();
for (const repo of development) {
  const dir = join(cache, repo.replace('/', '__'));
  const rows = gunzipSync(readFileSync(join(dir, 'features.jsonl.gz')))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  rowsByRepo.set(
    repo,
    rows.filter((row) => row.as_of_basis !== null),
  );
}
const sample = [];
for (const type of TYPES) {
  const pools = shuffle(development)
    .map((repo) =>
      shuffle(rowsByRepo.get(repo).filter((row) => row.landed_by === type)),
    )
    .filter((pool) => pool.length);
  for (
    let i = 0;
    sample.filter((row) => row.landed_by === type).length < perType &&
    pools.some((pool) => pool.length);
    i++
  ) {
    const pool = pools[i % pools.length];
    if (pool.length) sample.push(pool.pop());
  }
}

// ---- independent sources ----
function gh(path) {
  const text = execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      '--slurp',
      '-H',
      'Accept: application/vnd.github+json',
      path,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 ** 2 },
  );
  return JSON.parse(text).flat();
}
function ghOne(path) {
  return JSON.parse(
    execFileSync(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github+json', path],
      { encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 },
    ),
  );
}
function git(repo, args) {
  return execFileSync(
    'git',
    [
      '--no-lazy-fetch',
      '-C',
      join(cache, repo.replace('/', '__'), 'repo.git'),
      ...args,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 ** 3,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
}
function isAncestor(repo, ancestor, descendant) {
  try {
    git(repo, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
function branchOf(repo) {
  return JSON.parse(
    readFileSync(
      join(cache, repo.replace('/', '__'), 'enumeration.json'),
      'utf8',
    ),
  ).branch;
}

const AGENT =
  /co-authored-by:[^\n]*(claude|anthropic\.com|copilot|cursor|codex|openai\.com|devin|gemini|aider|openhands)|generated (with|by) \[?(claude|cursor|copilot|codex|devin|gemini|aider)|🤖 generated/i;
const AGENT_BRANCH =
  /^(claude|copilot|cursor|codex|devin|gemini|aider|openhands)[/-]/i;
const AGENT_LOGIN =
  /^(copilot-swe-agent|copilot|devin-ai-integration|cursor|openhands-agent|claude|codex)(\[bot\])?$/i;

function independent(row) {
  const {
    repo,
    pr_number: number,
    as_of: asOf,
    base_sha: base,
    merge_sha: merge,
  } = row;
  const cutoff = Date.parse(asOf);
  const pull = ghOne(`repos/${repo}/pulls/${number}`);
  const timeline = gh(`repos/${repo}/issues/${number}/timeline?per_page=100`);
  const commits = gh(`repos/${repo}/pulls/${number}/commits?per_page=100`);

  const dismissedAt = new Map(
    timeline
      .filter((e) => e.event === 'review_dismissed')
      .map((e) => [
        e.dismissed_review?.review_id,
        {
          at: Date.parse(e.created_at),
          state: e.dismissed_review?.state?.toUpperCase(),
        },
      ]),
  );
  // The REST timeline omits some COMMENTED reviews, so reviews come from the reviews endpoint.
  const reviews = gh(`repos/${repo}/pulls/${number}/reviews?per_page=100`)
    .filter((e) => e.submitted_at && Date.parse(e.submitted_at) <= cutoff)
    .map((e) => {
      const dismissal = dismissedAt.get(e.id);
      let state = String(e.state).toUpperCase();
      if (dismissal && dismissal.at > cutoff && state === 'DISMISSED')
        state = dismissal.state ?? state;
      return {
        state,
        at: Date.parse(e.submitted_at),
        login: e.user?.login ?? null,
      };
    });

  const labels = new Set();
  for (const e of timeline
    .filter(
      (x) =>
        (x.event === 'labeled' || x.event === 'unlabeled') &&
        Date.parse(x.created_at) <= cutoff,
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (e.event === 'labeled') labels.add(e.label?.name);
    else labels.delete(e.label?.name);
  }
  const renames = timeline
    .filter((e) => e.event === 'renamed')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const seenRenames = renames.filter((e) => Date.parse(e.created_at) <= cutoff);
  const title =
    renames.length === 0
      ? pull.title
      : seenRenames.length
        ? seenRenames.at(-1).rename.to
        : renames[0].rename.from;

  const created = Date.parse(pull.created_at);
  const first = reviews.length ? Math.min(...reviews.map((r) => r.at)) : null;

  // git, by plain commands rather than the history index
  const numstat = git(repo, ['diff', '--no-renames', '--numstat', base, merge])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const added = numstat.reduce((sum, [a]) => sum + (Number(a) || 0), 0);
  const deleted = numstat.reduce((sum, [, d]) => sum + (Number(d) || 0), 0);
  const changed = numstat.map((parts) => parts.slice(2).join('\t'));
  // A commit's time is when it landed: the running maximum of committer times along the
  // integration branch's first-parent line, never its own commit date. History ends at base,
  // or, for a rollup member whose base is off that line, at the line commit just before the
  // rollup landed. The window is everything reachable from that end but not from the last
  // line commit before as_of minus 90 days. --full-history keeps side-branch commits that
  // git's default simplification would drop.
  const since = cutoff - 90 * DAY;
  const line = git(repo, [
    'log',
    '--first-parent',
    '--reverse',
    '--format=%H %ct',
    `refs/heads/${branchOf(repo)}`,
  ])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' '));
  let end = line.findIndex(([sha]) => sha === base);
  if (end === -1) {
    let lo = 0;
    let hi = line.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (isAncestor(repo, base, line[mid][0])) hi = mid;
      else lo = mid + 1;
    }
    end = lo - 1;
  }
  let before = null;
  let latest = 0;
  for (const [sha, seconds] of line.slice(0, end + 1)) {
    latest = Math.max(latest, Number(seconds) * 1000);
    if (latest >= since) break;
    before = sha;
  }
  const recent =
    changed.length && end >= 0
      ? new Set(
          git(repo, [
            'rev-list',
            '--no-merges',
            '--full-history',
            line[end][0],
            ...(before ? [`^${before}`] : []),
            '--',
            ...changed.slice(0, 500),
          ])
            .split('\n')
            .filter(Boolean),
        ).size
      : 0;

  const own = commits.filter(
    (c) =>
      c.author?.login &&
      c.author.login === pull.user?.login &&
      c.commit?.author?.email,
  );
  const emails = [
    ...new Set(own.map((c) => c.commit.author.email.toLowerCase())),
  ];
  let prior = null;
  if (emails.length) {
    const shas = new Set();
    for (const email of emails) {
      for (const sha of git(repo, [
        'rev-list',
        '--no-merges',
        '-i',
        '--fixed-strings',
        `--author=<${email}>`,
        base,
      ])
        .split('\n')
        .filter(Boolean))
        shas.add(sha);
    }
    prior = shas.size;
  }

  const markerCommit = commits.some(
    (c) =>
      AGENT.test(c.commit?.message ?? '') ||
      AGENT_LOGIN.test(c.author?.login ?? ''),
  );
  const markerBranch = AGENT_BRANCH.test(pull.head?.ref ?? '');
  const markerAccount = AGENT_LOGIN.test(pull.user?.login ?? '');
  const bodyUnchanged =
    row.features['feature.content.body_sha256'] === sha256(pull.body ?? '');
  const markerBody = bodyUnchanged && AGENT.test(pull.body ?? '');

  return {
    'feature.author.is_bot': pull.user?.type === 'Bot',
    'feature.process.hours_open': Number(
      ((cutoff - created) / 3_600_000).toFixed(4),
    ),
    'feature.process.review_count': reviews.length,
    'feature.process.approvals': reviews.filter((r) => r.state === 'APPROVED')
      .length,
    'feature.process.changes_requested': reviews.filter(
      (r) => r.state === 'CHANGES_REQUESTED',
    ).length,
    'feature.process.distinct_reviewers': new Set(
      reviews.map((r) => r.login).filter(Boolean),
    ).size,
    'feature.process.hours_to_first_review':
      first !== null && first >= created
        ? Number(((first - created) / 3_600_000).toFixed(4))
        : null,
    'feature.process.github_label_count': labels.size,
    'feature.content.title_sha256': sha256(title),
    'feature.shape.files_touched': changed.length,
    'feature.shape.lines_added': added,
    'feature.shape.lines_deleted': deleted,
    'feature.history.file_commits_90d': recent,
    'feature.author.repo_commits_prior': prior,
    'feature.agent.marker_present':
      markerCommit || markerBranch || markerAccount || markerBody,
    github_additions: pull.additions,
    github_deletions: pull.deletions,
    github_changed_files: pull.changed_files,
    body_unchanged_since_merge: bodyUnchanged,
    pr_commits_listed: commits.length,
  };
}

// Columns with exact agreement expected, and those where the independent method is a
// documented approximation (`git --author` over all ancestors, and the agent detector's
// own simpler patterns).
const EXACT = [
  'feature.author.is_bot',
  'feature.process.hours_open',
  'feature.process.review_count',
  'feature.process.approvals',
  'feature.process.changes_requested',
  'feature.process.distinct_reviewers',
  'feature.process.hours_to_first_review',
  'feature.process.github_label_count',
  'feature.content.title_sha256',
  'feature.shape.files_touched',
  'feature.shape.lines_added',
  'feature.shape.lines_deleted',
  'feature.history.file_commits_90d',
];
const APPROXIMATE = [
  'feature.author.repo_commits_prior',
  'feature.agent.marker_present',
];

mkdirSync(outDir, { recursive: true, mode: 0o700 });
const results = [];
for (const [i, row] of sample.entries()) {
  process.stderr.write(`info: PR ${i + 1}/${sample.length}\n`);
  try {
    const mine = independent(row);
    const comparisons = {};
    for (const column of [...EXACT, ...APPROXIMATE]) {
      const published = row.features[column];
      const value = mine[column];
      comparisons[column] = {
        published,
        independent: value,
        agree: JSON.stringify(published) === JSON.stringify(value),
        skipped: published === null && value === null,
      };
    }
    results.push({
      repo: row.repo,
      pr_number: row.pr_number,
      landed_by: row.landed_by,
      as_of_basis: row.as_of_basis,
      comparisons,
      context: mine,
    });
  } catch (error) {
    results.push({
      repo: row.repo,
      pr_number: row.pr_number,
      landed_by: row.landed_by,
      error: String(error.message).slice(0, 300),
    });
  }
}
writeFileSync(
  join(outDir, 'spot-check.json'),
  `${JSON.stringify({ seed, results }, null, 2)}\n`,
  { mode: 0o600 },
);

const checked = results.filter((r) => !r.error);
const columns = {};
for (const column of [...EXACT, ...APPROXIMATE]) {
  const list = checked.map((r) => r.comparisons[column]);
  columns[column] = {
    expectation: EXACT.includes(column) ? 'exact' : 'approximate',
    compared: list.length,
    agree: list.filter((c) => c.agree).length,
  };
}
const summary = {
  procedure: 'hok-3023-spot-check',
  excluded_slice_sha256: createHash('sha256').update(sliceBytes).digest('hex'),
  sampled_prs: sample.length,
  checked_prs: checked.length,
  failed_prs: results.length - checked.length,
  development_repos_sampled: new Set(sample.map((r) => r.repo)).size,
  landed_by_types_sampled: new Set(sample.map((r) => r.landed_by)).size,
  columns,
};
writeFileSync(resolve(values.summary), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\n`);
