/**
 * Corpus enumeration (HOK-3265): every merged PR that landed on a public
 * repo's default branch inside the cohort window, joined to the first-parent
 * commits that landed it.
 *
 * Two sources, cross-checked:
 *   - git: the default branch's first-parent history in the window (the
 *     lineage S2 v1.1.0 walks in `direct` mode)
 *   - GitHub GraphQL: merged PRs in the window, with the metadata later
 *     phases need (labels, closing issues, author, head SHA)
 *
 * A first-parent commit is mapped when a PR's merge commit is that commit,
 * when its subject/trailer names a PR (bors, merge bots), or when it is an
 * earlier commit of a rebase-merged PR. `mapped_share` is the acceptance
 * metric: ≥95% per kept repo.
 *
 * Pure: git and GraphQL are injected, so the boundary test applies. Titles
 * and bodies are returned for the local cache only and must never be
 * written to corpus outputs (decision-record contract §4.3).
 */

import type { GitRunner } from '../survival-labeller.js';
import { extractCorpusPrNumbers } from './pr-refs.js';

export type GraphqlRunner = (query: string, variables: Record<string, string | number | null>) => unknown;

export interface CorpusEnumerateDeps {
  runGit: GitRunner;
  graphql: GraphqlRunner;
  /** Resumable cache for finished GraphQL slices; keys are stable per window. */
  cache?: { get(key: string): unknown; set(key: string, value: unknown): void };
  onDiagnostic?: (line: string) => void;
  /**
   * Merged PR numbers GitHub associates with a commit (REST `commits/{sha}/pulls`).
   * Used on a sample of unmapped commits to split enumerator misses from
   * direct pushes that never had a PR. Omit to skip the audit.
   */
  pullsForCommit?: (sha: string) => number[];
}

/** Unmapped commits checked against GitHub per repo; spread evenly across the window. */
export const UNMAPPED_AUDIT_SAMPLE = 50;

export interface CorpusEnumerateTarget {
  /** `owner/name`. */
  repo: string;
  /** Local ref holding the default branch history. */
  branch: string;
  /** Base-branch names that count as the default branch (renames inside the window). */
  defaultBranchNames: readonly string[];
  from: Date;
  until: Date;
}

export type LandedBy = 'merge_commit' | 'squash' | 'rebase' | 'number_ref';

export interface CorpusPrRecord {
  repo: string;
  pr_number: number;
  pr_url: string;
  merged_at: string;
  base_ref: string | null;
  head_sha: string | null;
  /** First-parent commit that landed the PR. */
  merge_sha: string;
  /** First parent of the PR's earliest first-parent commit: the pre-change state. */
  base_sha: string;
  /** First-parent commits the PR contributed (>1 only for rebase merges). */
  member_commits: number;
  landed_by: LandedBy;
  /** The merge SHA landed more than one PR (bors batches); labels share it. */
  batched: boolean;
  author_login: string | null;
  author_type: string | null;
  labels: string[];
  closing_issues: number[];
  /** Local cache only. */
  title: string;
  /** Local cache only. */
  body: string;
}

export interface CorpusEnumerationStats {
  repo: string;
  branch: string;
  window: { from: string; until: string };
  first_parent_commits: number;
  mapped_commits: number;
  mapped_share: number | null;
  /** Unmapped commits checked with `pullsForCommit`, and how many of those GitHub ties to a merged PR (misses). */
  unmapped_audited: number;
  unmapped_audited_with_pr: number;
  /** Estimated share of PR-landed first-parent commits the enumerator mapped. The acceptance metric (≥0.95). */
  pr_recall_est: number | null;
  /** Estimated share of first-parent commits pushed directly, with no PR (release managers, security fixes). */
  direct_push_share_est: number | null;
  prs: number;
  batched_commits: number;
  rebase_prs: number;
  number_ref_prs: number;
  /** Merged PRs the API reports that never landed on the first-parent walk (other base branches, mostly). */
  api_prs_not_on_branch: number;
  /** The subset that targeted the default branch: a mapping gap worth inspecting, not a backport. */
  api_prs_not_on_branch_default_base: number;
  /** Up to 20 unmapped first-parent SHAs, for spot checks. No subjects. */
  unmapped_sample: string[];
}

interface ApiPr {
  number: number;
  url: string;
  mergedAt: string | null;
  baseRefName: string | null;
  headRefOid: string | null;
  title: string;
  body: string | null;
  mergeCommit: { oid: string } | null;
  author: { login: string; __typename: string } | null;
  labels: { nodes: { name: string }[] };
  closingIssuesReferences: { nodes: { number: number }[] };
  commits: { totalCount: number };
}

interface SearchPage {
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
  /** Non-PR search hits come back as empty objects. */
  nodes: (ApiPr | Record<string, never>)[];
}

interface FirstParentCommit {
  sha: string;
  parents: string[];
  epoch: number;
  prNumbers: number[];
}

const PR_FIELDS = `number url mergedAt baseRefName headRefOid title body
  mergeCommit{ oid } author{ login __typename }
  labels(first:30){ nodes{ name } }
  closingIssuesReferences(first:10){ nodes{ number } }
  commits{ totalCount }`;

const SEARCH_QUERY = `query($q:String!,$after:String){
  search(type:ISSUE, query:$q, first:50, after:$after){
    issueCount pageInfo{ endCursor hasNextPage }
    nodes{ ... on PullRequest { ${PR_FIELDS} } }
  }
}`;

const COUNT_QUERY = `query($q:String!){ search(type:ISSUE, query:$q, first:1){ issueCount } }`;

/** GitHub search returns at most 1,000 results per query. */
const SEARCH_CAP = 1000;
const DAY_MS = 86_400_000;
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function enumerateCorpusRepo(
  target: CorpusEnumerateTarget,
  deps: CorpusEnumerateDeps,
): { records: CorpusPrRecord[]; stats: CorpusEnumerationStats } {
  const commits = readFirstParent(target, deps.runGit);
  const apiPrs = fetchMergedPrs(target, deps);
  const byNumber = new Map(apiPrs.map((pr) => [pr.number, pr]));
  const byMergeSha = new Map<string, ApiPr[]>();
  for (const pr of apiPrs) {
    if (!pr.mergeCommit) continue;
    const list = byMergeSha.get(pr.mergeCommit.oid) ?? [];
    list.push(pr);
    byMergeSha.set(pr.mergeCommit.oid, list);
  }

  // PRs a commit names but the merged search did not return: merge bots that
  // close rather than merge (pytorch), or merges dated outside the window.
  const missing = [...new Set(commits.flatMap((c) => c.prNumbers))].filter((n) => !byNumber.has(n));
  for (const pr of fetchPrsByNumber(target.repo, missing, deps)) byNumber.set(pr.number, pr);

  const records: CorpusPrRecord[] = [];
  const mapped = new Set<string>();
  const used = new Set<number>();
  let batchedCommits = 0;
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!;
    const viaSha = byMergeSha.get(commit.sha) ?? [];
    const viaRef = commit.prNumbers.map((n) => byNumber.get(n)).filter((pr): pr is ApiPr => !!pr);
    const prs = [...new Map([...viaSha, ...viaRef].map((pr) => [pr.number, pr])).values()].filter((pr) => !used.has(pr.number));
    if (prs.length === 0) continue;
    mapped.add(commit.sha);
    const batched = prs.length > 1;
    if (batched) batchedCommits++;
    for (const pr of prs) {
      used.add(pr.number);
      // A rebase merge lands each PR commit on first-parent; GitHub's merge
      // commit is the last one. Claim the unmapped commits just before it.
      let first = i;
      const isMergeCommit = commit.parents.length > 1;
      if (!batched && !isMergeCommit && viaSha.includes(pr) && pr.commits.totalCount > 1) {
        for (let k = 1; k < pr.commits.totalCount && first - 1 >= 0 && !mapped.has(commits[first - 1]!.sha) && commits[first - 1]!.prNumbers.length === 0; k++) {
          first--;
          mapped.add(commits[first]!.sha);
        }
      }
      const members = i - first + 1;
      records.push({
        repo: target.repo,
        pr_number: pr.number,
        pr_url: pr.url,
        merged_at: pr.mergedAt ?? new Date(commit.epoch * 1000).toISOString(),
        base_ref: pr.baseRefName,
        head_sha: pr.headRefOid,
        merge_sha: commit.sha,
        base_sha: commits[first]!.parents[0] ?? EMPTY_TREE_SHA,
        member_commits: members,
        landed_by: !viaSha.includes(pr) ? 'number_ref' : isMergeCommit ? 'merge_commit' : members > 1 ? 'rebase' : 'squash',
        batched,
        author_login: pr.author?.login ?? null,
        author_type: pr.author?.__typename ?? null,
        labels: pr.labels.nodes.map((label) => label.name),
        closing_issues: pr.closingIssuesReferences.nodes.map((issue) => issue.number),
        title: pr.title,
        body: pr.body ?? '',
      });
    }
  }

  const defaultNames = new Set(target.defaultBranchNames);
  const unmapped = commits.filter((c) => !mapped.has(c.sha));
  const audit = auditUnmapped(unmapped, deps.pullsForCommit);
  const stats: CorpusEnumerationStats = {
    repo: target.repo,
    branch: target.branch,
    window: { from: target.from.toISOString(), until: target.until.toISOString() },
    first_parent_commits: commits.length,
    mapped_commits: mapped.size,
    mapped_share: commits.length ? Number((mapped.size / commits.length).toFixed(4)) : null,
    unmapped_audited: audit.checked,
    unmapped_audited_with_pr: audit.withPr,
    pr_recall_est: audit.estimate(mapped.size, commits.length).recall,
    direct_push_share_est: audit.estimate(mapped.size, commits.length).directPush,
    prs: records.length,
    batched_commits: batchedCommits,
    rebase_prs: records.filter((r) => r.landed_by === 'rebase').length,
    number_ref_prs: records.filter((r) => r.landed_by === 'number_ref').length,
    api_prs_not_on_branch: apiPrs.filter((pr) => !used.has(pr.number)).length,
    api_prs_not_on_branch_default_base: apiPrs.filter((pr) => !used.has(pr.number) && pr.baseRefName !== null && defaultNames.has(pr.baseRefName)).length,
    unmapped_sample: unmapped.slice(0, 20).map((c) => c.sha),
  };
  records.sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.pr_number - b.pr_number);
  return { records, stats };
}

function auditUnmapped(unmapped: FirstParentCommit[], pullsForCommit: ((sha: string) => number[]) | undefined) {
  const step = Math.max(1, unmapped.length / UNMAPPED_AUDIT_SAMPLE);
  const sample = pullsForCommit ? Array.from({ length: Math.min(UNMAPPED_AUDIT_SAMPLE, unmapped.length) }, (_, i) => unmapped[Math.floor(i * step)]!) : [];
  const withPr = sample.filter((c) => pullsForCommit!(c.sha).length > 0).length;
  const round = (value: number) => Number(value.toFixed(4));
  return {
    checked: sample.length,
    withPr,
    estimate(mappedCount: number, total: number): { recall: number | null; directPush: number | null } {
      if (total === 0) return { recall: null, directPush: null };
      if (unmapped.length === 0) return { recall: 1, directPush: 0 };
      if (sample.length === 0) return { recall: null, directPush: null };
      const missed = (unmapped.length * withPr) / sample.length;
      return { recall: round(mappedCount / (mappedCount + missed)), directPush: round((unmapped.length - missed) / total) };
    },
  };
}

/** First-parent commits in the window, oldest first, read month by month to bound output size. */
function readFirstParent(target: CorpusEnumerateTarget, runGit: GitRunner): FirstParentCommit[] {
  const commits: FirstParentCommit[] = [];
  const seen = new Set<string>();
  const start = target.from.getTime();
  const end = target.until.getTime();
  for (let lo = start; lo < end; lo += 30 * DAY_MS) {
    const hi = Math.min(lo + 30 * DAY_MS, end);
    const result = runGit([
      'log', '--first-parent', '--reverse',
      `--since=${new Date(lo).toISOString()}`, `--until=${new Date(hi).toISOString()}`,
      '--pretty=format:%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e',
      target.branch,
    ]);
    if (result.exitCode !== 0) throw new Error(`corpus: cannot read first-parent history of ${target.branch}: ${result.stderr.trim()}`);
    for (const entry of result.stdout.split('\x1e')) {
      const [sha = '', parents = '', epochText = '', subject = '', body = ''] = entry.replace(/^\n/, '').split('\x1f');
      if (!/^[0-9a-f]{40}$/.test(sha) || seen.has(sha)) continue;
      const epoch = Number.parseInt(epochText, 10);
      // --since/--until filter on committer date too, but bound explicitly: slices must not overlap.
      if (!Number.isFinite(epoch) || epoch * 1000 < lo || epoch * 1000 >= hi) continue;
      seen.add(sha);
      commits.push({ sha, parents: parents.trim().split(/\s+/).filter(Boolean), epoch, prNumbers: extractCorpusPrNumbers(subject, body, target.repo) });
    }
  }
  return commits;
}

/** Merged PRs in the window, splitting date ranges until each fits under the search cap. */
function fetchMergedPrs(target: CorpusEnumerateTarget, deps: CorpusEnumerateDeps): ApiPr[] {
  const out = new Map<number, ApiPr>();
  const pending: [number, number][] = [[target.from.getTime(), target.until.getTime() - DAY_MS]];
  while (pending.length) {
    const [lo, hi] = pending.shift()!;
    const range = `${isoDay(lo)}..${isoDay(hi)}`;
    const q = `repo:${target.repo} is:pr is:merged merged:${range}`;
    const cacheKey = `merged:${range}`;
    const cached = deps.cache?.get(cacheKey) as ApiPr[] | undefined;
    if (cached) {
      for (const pr of cached) out.set(pr.number, pr);
      continue;
    }
    const count = (deps.graphql(COUNT_QUERY, { q }) as { search: { issueCount: number } }).search.issueCount;
    if (count > SEARCH_CAP) {
      if (hi <= lo) throw new Error(`corpus: more than ${SEARCH_CAP} PRs merged on ${isoDay(lo)}; cannot slice further`);
      const mid = lo + Math.floor((hi - lo) / DAY_MS / 2) * DAY_MS;
      pending.unshift([lo, mid], [mid + DAY_MS, hi]);
      continue;
    }
    const slice: ApiPr[] = [];
    for (let after: string | null = null; ; ) {
      const page: SearchPage = (deps.graphql(SEARCH_QUERY, { q, after }) as { search: SearchPage }).search;
      slice.push(...page.nodes.filter((node): node is ApiPr => typeof (node as Partial<ApiPr>).number === 'number'));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    deps.cache?.set(cacheKey, slice);
    deps.onDiagnostic?.(`info: ${target.repo} ${range}: ${slice.length} merged PRs`);
    for (const pr of slice) out.set(pr.number, pr);
  }
  return [...out.values()];
}

/** PRs by number, 50 per aliased query. Closed-unmerged PRs come back too (merge bots). */
function fetchPrsByNumber(repo: string, numbers: number[], deps: CorpusEnumerateDeps): ApiPr[] {
  const [owner, name] = repo.split('/') as [string, string];
  const out: ApiPr[] = [];
  for (let i = 0; i < numbers.length; i += 50) {
    const batch = numbers.slice(i, i + 50);
    const cacheKey = `by-number:${batch.join(',')}`;
    let prs = deps.cache?.get(cacheKey) as ApiPr[] | undefined;
    if (!prs) {
      const fields = batch.map((n) => `pr${n}: pullRequest(number:${n}){ ${PR_FIELDS} }`).join('\n');
      const data = deps.graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name }) as {
        repository: Record<string, ApiPr | null>;
      };
      prs = Object.values(data.repository).filter((pr): pr is ApiPr => pr !== null);
      deps.cache?.set(cacheKey, prs);
    }
    out.push(...prs);
  }
  return out;
}
