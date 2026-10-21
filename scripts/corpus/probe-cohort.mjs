#!/usr/bin/env node
/**
 * Probe the HOK-3022 cohort before any label run.
 *
 * The manifest predeclares repos and their expected merge conventions from
 * memory; this measures them. For every repo (cohort + alternates) it asks the
 * GitHub GraphQL API, never a clone, for:
 *   - merged PRs in the last 12 months of the window, reverts, closed-unmerged
 *   - a 100-PR sample spread over the window: base branch, fix signals,
 *     closing-issue links, backports, agent attribution
 *   - a 100-commit default-branch sample: share mapped to a merged PR
 * and checks the manifest's `selection_thresholds`. Results go to
 * `fixtures/arbiter/corpus/hok-3022-probe.json`; a markdown table goes to
 * stdout. PR bodies and commit messages are read in memory only and never
 * written (decision-record contract §4.3).
 *
 * Usage: node scripts/corpus/probe-cohort.mjs [--repo owner/name] [--retry-errors] [--no-write]
 * Requires `gh` authenticated and `pnpm --filter @hokusai/scan build`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributePullRequest } from '../../packages/scan/dist/index.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const manifestPath = path.join(
  repoRoot,
  'fixtures/arbiter/corpus/hok-3022-cohort.json',
);
const outputPath = path.join(
  repoRoot,
  'fixtures/arbiter/corpus/hok-3022-probe.json',
);
const PROBE_VERSION = '0.1.0';

const FIX_TITLE = /\b(?:fix(?:e[sd])?|bug|regression|hotfix)\b|^fix(?:\(|:)/i;
const FIX_LABEL = /bug|fix|regression/i;
const REVERT_TITLE = /^revert\b/i;
const BACKPORT = /backport|cherry[- ]?pick/i;
/** Bots that move code around rather than write it; never counted as agents. */
const INFRA_BOT =
  /dependabot|renovate|backport|cherry|kibanamachine|miss-islington|k8s-infra|github-actions|mergebot|bors|craig|rust-timer|copybara|elastic-vault/i;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

function graphql(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables))
    args.push('-F', `${key}=${value}`);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const raw = execFileSync('gh', args, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(raw).data;
    } catch (error) {
      const stderr = String(error.stderr ?? error.message);
      if (
        attempt < 4 &&
        /rate limit|secondary|502|503|timeout|ETIMEDOUT/i.test(stderr)
      ) {
        const waitMs = 2000 * 2 ** attempt;
        process.stderr.write(
          `  retrying in ${waitMs}ms: ${stderr.split('\n')[0]}\n`,
        );
        execFileSync('sleep', [String(waitMs / 1000)]);
        continue;
      }
      throw new Error(stderr.trim());
    }
  }
}

const COUNTS_QUERY = `query($owner:String!,$name:String!,$merged:String!,$reverts:String!,$unmerged:String!){
  repository(owner:$owner,name:$name){
    defaultBranchRef{name} createdAt isArchived licenseInfo{spdxId}
    ignoreRevs: object(expression:"HEAD:.git-blame-ignore-revs"){ __typename }
  }
  merged: search(type:ISSUE, query:$merged, first:1){ issueCount }
  reverts: search(type:ISSUE, query:$reverts, first:1){ issueCount }
  unmerged: search(type:ISSUE, query:$unmerged, first:1){ issueCount }
}`;

const PR_SAMPLE_QUERY = `query($q:String!,$n:Int!){
  search(type:ISSUE, query:$q, first:$n){ nodes { ... on PullRequest {
    number title baseRefName headRefName mergedAt body headRefOid
    mergeCommit{ oid }
    author{ login __typename }
    labels(first:20){ nodes{ name } }
    closingIssuesReferences{ totalCount }
    commits(last:5){ nodes{ commit{ message } } }
  } } }
}`;

// Pages of 25: associatedPullRequests on 100 commits times out (502) on llvm-sized repos.
const COMMIT_SAMPLE_QUERY = `query($owner:String!,$name:String!,$ref:String!,$since:GitTimestamp!,$until:GitTimestamp!,$after:String){
  repository(owner:$owner,name:$name){ ref(qualifiedName:$ref){ target{ ... on Commit {
    history(first:25, since:$since, until:$until, after:$after){ pageInfo{ endCursor hasNextPage } nodes {
      oid parents{ totalCount }
      associatedPullRequests(first:3){ nodes{ number merged mergeCommit{ oid } } }
    } }
  } } } }
}`;

/** Four equal slices across the window, so the sample is not all from one month. */
function windowSlices(from, until, count) {
  const start = Date.parse(from);
  const span = (Date.parse(until) - start) / count;
  return Array.from({ length: count }, (_, i) => {
    const a = new Date(start + span * i).toISOString().slice(0, 10);
    const b = new Date(start + span * (i + 1) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    return `${a}..${b}`;
  });
}

const share = (part, whole) =>
  whole === 0 ? null : Number((part / whole).toFixed(3));

function probeRepo(repo, manifest) {
  const [owner, name] = repo.split('/');
  const { merged_from: from, merged_until: until } = manifest.window;
  const yearFrom = new Date(Date.parse(until) - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const year = `${yearFrom}..${until}`;

  const counts = graphql(COUNTS_QUERY, {
    owner,
    name,
    merged: `repo:${repo} is:pr is:merged merged:${year}`,
    reverts: `repo:${repo} is:pr is:merged merged:${year} in:title revert`,
    unmerged: `repo:${repo} is:pr is:closed is:unmerged closed:${year}`,
  });
  const meta = counts.repository;
  const defaultBranch = meta.defaultBranchRef?.name ?? null;
  // A default branch renamed inside the window (rust-lang: master -> main) is declared in the manifest.
  const entry = [...manifest.repos, ...manifest.alternates].find((r) => r.repo === repo);
  const defaultNames = new Set([defaultBranch, ...(entry?.default_branch_aliases ?? [])]);

  const prs = windowSlices(from, until, 4).flatMap((slice) =>
    graphql(PR_SAMPLE_QUERY, {
      q: `repo:${repo} is:pr is:merged merged:${slice} sort:created-asc`,
      n: 25,
    }).search.nodes.filter(Boolean),
  );
  let baseIsDefault = 0,
    fixSignal = 0,
    revert = 0,
    closesIssue = 0,
    backport = 0,
    infraBot = 0,
    agent = 0;
  for (const pr of prs) {
    const labels = pr.labels.nodes.map((label) => label.name);
    const login = pr.author?.login ?? '';
    if (defaultNames.has(pr.baseRefName)) baseIsDefault += 1;
    if (
      FIX_TITLE.test(pr.title) ||
      labels.some((label) => FIX_LABEL.test(label)) ||
      /regression in [0-9a-f]{7,}/i.test(pr.body ?? '')
    )
      fixSignal += 1;
    if (REVERT_TITLE.test(pr.title)) revert += 1;
    if (pr.closingIssuesReferences.totalCount > 0) closesIssue += 1;
    if (
      BACKPORT.test(pr.title) ||
      labels.some((label) => BACKPORT.test(label)) ||
      !defaultNames.has(pr.baseRefName)
    )
      backport += 1;
    const isInfraBot = INFRA_BOT.test(login);
    if (isInfraBot) infraBot += 1;
    const attribution = attributePullRequest({
      number: pr.number,
      authorLogin: login || null,
      authorType: pr.author?.__typename ?? null,
      headRef: pr.headRefName,
      labels,
      mergedAt: pr.mergedAt,
      commitMessages: pr.commits.nodes.map((node) => node.commit.message),
      body: pr.body,
      headSha: pr.headRefOid,
    });
    if (attribution.agent.status === 'agent' && !isInfraBot) agent += 1;
  }

  // One month in the middle of the window keeps the commit sample comparable across repos.
  const mid = new Date((Date.parse(from) + Date.parse(until)) / 2);
  const commits = [];
  for (let page = 0, after = null; defaultBranch && page < 4; page += 1) {
    const history = graphql(COMMIT_SAMPLE_QUERY, {
      owner,
      name,
      ref: `refs/heads/${defaultBranch}`,
      since: mid.toISOString(),
      until: new Date(mid.getTime() + 30 * 86_400_000).toISOString(),
      ...(after ? { after } : {}),
    }).repository.ref.target.history;
    commits.push(...history.nodes);
    if (!history.pageInfo.hasNextPage) break;
    after = history.pageInfo.endCursor;
  }
  let mapped = 0,
    isMergeCommit = 0,
    twoParent = 0;
  for (const commit of commits) {
    const merged = commit.associatedPullRequests.nodes.filter(
      (pr) => pr.merged,
    );
    if (merged.length) mapped += 1;
    if (merged.some((pr) => pr.mergeCommit?.oid === commit.oid))
      isMergeCommit += 1;
    if (commit.parents.totalCount > 1) twoParent += 1;
  }

  const metrics = {
    merged_prs_per_year: counts.merged.issueCount,
    revert_prs_per_year: counts.reverts.issueCount,
    closed_unmerged_per_year: counts.unmerged.issueCount,
    pr_sample_size: prs.length,
    base_is_default_share: share(baseIsDefault, prs.length),
    fix_signal_share: share(fixSignal, prs.length),
    revert_share: share(revert, prs.length),
    closes_issue_share: share(closesIssue, prs.length),
    backport_share: share(backport, prs.length),
    infra_bot_share: share(infraBot, prs.length),
    agent_share: share(agent, prs.length),
    commit_sample_size: commits.length,
    pr_mapped_commit_share: share(mapped, commits.length),
    pr_merge_commit_share: share(isMergeCommit, commits.length),
    two_parent_commit_share: share(twoParent, commits.length),
  };
  return {
    repo,
    default_branch: defaultBranch,
    created_at: meta.createdAt,
    archived: meta.isArchived,
    license: meta.licenseInfo?.spdxId ?? null,
    has_blame_ignore_revs: meta.ignoreRevs !== null,
    observed_merge_convention: classifyConvention(metrics),
    metrics,
    failures: checkThresholds(metrics, manifest.selection_thresholds),
  };
}

/** Rough read of how PRs land; the enumerator still has to confirm it per repo. */
function classifyConvention(m) {
  if (m.commit_sample_size === 0) return 'unknown';
  if (m.pr_mapped_commit_share < 0.5) return 'off_github_or_bot_landed';
  if (m.two_parent_commit_share >= 0.3) return 'merge_commit';
  if (m.pr_merge_commit_share >= 0.8) return 'squash';
  return 'rebase_or_mixed';
}

function checkThresholds(m, t) {
  const failures = [];
  if (m.merged_prs_per_year < t.min_merged_prs_per_year)
    failures.push(
      `merged_prs_per_year ${m.merged_prs_per_year} < ${t.min_merged_prs_per_year}`,
    );
  if ((m.base_is_default_share ?? 0) < t.min_base_is_default_share)
    failures.push(
      `base_is_default_share ${m.base_is_default_share} < ${t.min_base_is_default_share}`,
    );
  if ((m.pr_mapped_commit_share ?? 0) < t.min_pr_mapped_commit_share)
    failures.push(
      `pr_mapped_commit_share ${m.pr_mapped_commit_share} < ${t.min_pr_mapped_commit_share}`,
    );
  if ((m.fix_signal_share ?? 0) < t.min_fix_signal_share)
    failures.push(
      `fix_signal_share ${m.fix_signal_share} < ${t.min_fix_signal_share}`,
    );
  return failures;
}

function markdownTable(results) {
  const rows = [
    '| repo | PRs/yr | reverts/yr | convention | base=default | PR-mapped commits | fix signal | closes issue | agent | ignore-revs | verdict |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const pct = (value) =>
    value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`;
  for (const r of results) {
    if (r.error) {
      rows.push(
        `| ${r.repo} | error: ${r.error.split('\n')[0].slice(0, 80)} |||||||||| ✗ |`,
      );
      continue;
    }
    const m = r.metrics;
    rows.push(
      `| ${r.repo} | ${m.merged_prs_per_year} | ${m.revert_prs_per_year} | ${r.observed_merge_convention} | ${pct(m.base_is_default_share)} | ${pct(m.pr_mapped_commit_share)} | ${pct(m.fix_signal_share)} | ${pct(m.closes_issue_share)} | ${pct(m.agent_share)} | ${r.has_blame_ignore_revs ? 'yes' : 'no'} | ${r.failures.length ? `✗ ${r.failures.join('; ')}` : '✓'} |`,
    );
  }
  return rows.join('\n');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const only = argValue('--repo');
const retryErrors = process.argv.includes('--retry-errors');
const previous =
  (retryErrors || only) && existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf8'))
    : null;
const failed = new Set(
  previous?.results.filter((r) => r.error).map((r) => r.repo) ?? [],
);
const targets = [
  ...manifest.repos.map((r) => r.repo),
  ...manifest.alternates.map((r) => r.repo),
].filter(
  (repo) => (!only || repo === only) && (!retryErrors || failed.has(repo)),
);
const results = [];
for (const repo of targets) {
  process.stderr.write(`probing ${repo}\n`);
  try {
    results.push(probeRepo(repo, manifest));
  } catch (error) {
    results.push({ repo, error: error.message });
  }
}

// --retry-errors and --repo re-probe a subset and merge it back into the last results in place.
const merged = previous
  ? previous.results.map((r) => results.find((x) => x.repo === r.repo) ?? r)
  : results;
if (!process.argv.includes('--no-write')) {
  const output = {
    probe_version: PROBE_VERSION,
    manifest_version: manifest.manifest_version,
    probed_at: new Date().toISOString(),
    window: manifest.window,
    thresholds: manifest.selection_thresholds,
    results: merged,
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}
process.stdout.write(`${markdownTable(merged)}\n`);
