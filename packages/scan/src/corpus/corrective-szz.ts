/**
 * P3 (SZZ) and issue metadata for corrective-rework detection (HOK-3267).
 *
 * SZZ: for a fix that closes a bug issue, blame the lines it deletes or
 * modifies, at its parent, back to the originals that introduced them.
 * `git blame --first-parent` attributes each line to the first-parent
 * commit that landed it, which is a PR's merge commit (or one of a rebase
 * merge's commits), so blamed SHAs map to PRs without a per-commit lookup.
 * Blame is bounded with `--since` to the longest horizon before the fix:
 * older lines can never make a row corrective.
 *
 * Pure: git and GraphQL are injected.
 */

import type { GitRunner } from '../survival-labeller.js';
import type { CorpusPrRecord, GraphqlRunner } from './enumerate.js';

/** Test files: excluded from blame, counted separately in repair pairs. */
export const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|testing)\/|(?:^|\/)test_[^/]*$|[._-](?:test|spec)s?\.[^/]+$|_test\.go$|Tests?\.(?:java|kt|cs|swift)$/;

/**
 * Generated or mechanical files: lockfiles and dependency manifests, snapshots, generated clients,
 * test data, translation catalogues and images. Their lines are rewritten wholesale by tools,
 * so blaming them links unrelated PRs. Excluded from blame and from fix size.
 */
export const GENERATED_PATH = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.(?:mod|sum)|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:__snapshots__|__generated__|generated|openapi-gen|testdata|translations)\/|\.(?:snap|pb\.go|pb\.cc|pb\.h|min\.js|png|jpe?g|gif|svg|ico)$|[._]generated\.[^/]+$/;

/** Fixes past these sizes are tangled with other work; their candidates are rejected as `fix_too_large`. */
export const SZZ_MAX_FILES = 20;
export const SZZ_MAX_CHANGED_LINES = 500;
/** Fixes past these sizes are not blamed at all (vendored drops, mass renames). */
export const SZZ_SKIP_FILES = 100;
export const SZZ_SKIP_CHANGED_LINES = 5_000;

// ── Issue metadata ─────────────────────────────────────────────────────────

export interface IssueMeta {
  url: string;
  labels: string[];
  /** GitHub issue type (`Bug`, `Task`, …) where the repo uses them. */
  type: string | null;
}

/** Issues per GraphQL query. */
export const ISSUE_BATCH = 50;

/** Labels and type of each issue number; PR numbers and missing issues are absent from the map. */
export function prefetchIssueMeta(
  repo: string,
  numbers: readonly number[],
  graphql: GraphqlRunner,
  cache?: { get(key: string): unknown; set(key: string, value: unknown): void },
): Map<number, IssueMeta> {
  const [owner, name] = repo.split('/') as [string, string];
  const out = new Map<number, IssueMeta>();
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i += ISSUE_BATCH) {
    const batch = unique.slice(i, i + ISSUE_BATCH);
    const key = `issues1:${batch.join(',')}`;
    let rows = cache?.get(key) as [number, IssueMeta | null][] | undefined;
    if (!rows) {
      const fields = batch
        .map((n) => `i${n}: issueOrPullRequest(number:${n}){ __typename ... on Issue { url issueType{ name } labels(first:50){ nodes{ name } } } }`)
        .join('\n');
      const data = graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name }) as {
        repository: Record<string, { __typename: string; url?: string; issueType?: { name: string } | null; labels?: { nodes: { name: string }[] } } | null>;
      };
      rows = batch.map((n) => {
        const node = data.repository[`i${n}`];
        if (!node || node.__typename !== 'Issue' || !node.url) return [n, null];
        return [n, { url: node.url, labels: (node.labels?.nodes ?? []).map((l) => l.name), type: node.issueType?.name ?? null }];
      });
      cache?.set(key, rows);
    }
    for (const [n, meta] of rows) if (meta) out.set(n, meta);
  }
  return out;
}

const BUG_LABEL = /^(?:(?:type|kind|t|c|issue|category)\s*[:/-]\s*)?bug$|^bug[- ]unreleased$|^potential bug$|^(?:(?:type|kind|c|i)\s*[:/-]\s*)?(?:crash|ice)$/i;
const REGRESSION_LABEL = /regress|^incident\b/i;
const NOT_REGRESSION = /\b(?:not|non)[- ]?(?:a[- ])?regression/i;

/** Labels that mark the issue as a regression or incident (P4). */
export function regressionLabels(issue: IssueMeta): string[] {
  return issue.labels.filter((l) => REGRESSION_LABEL.test(l) && !NOT_REGRESSION.test(l));
}

/** A bug report: issue type Bug, a bug-style label, or a regression label. `bug-bash`, `debug*` and the like do not count. */
export function isBugIssue(issue: IssueMeta): boolean {
  return issue.type === 'Bug' || issue.labels.some((l) => BUG_LABEL.test(l)) || regressionLabels(issue).length > 0;
}

/** Path from a `--- a/path` or `+++ b/path` header line; null for `/dev/null`. Git appends a tab to paths containing spaces. */
export function diffHeaderPath(line: string): string | null {
  const name = line.slice(4).replace(/\t$/, '');
  return name === '/dev/null' ? null : name.replace(/^[ab]\//, '');
}

// ── Blame ──────────────────────────────────────────────────────────────────

/**
 * First-parent SHA → the one original it landed. Squash and merge commits
 * map by merge SHA, relands by their SHAs, and rebase merges by every
 * first-parent commit between base and merge. SHAs shared by several PRs
 * (bors batches, rollup landings) are dropped: blame cannot split them.
 */
export function buildLandingIndex(runGit: GitRunner, branch: string, originals: readonly CorpusPrRecord[]): Map<string, CorpusPrRecord> {
  const owners = new Map<string, Set<CorpusPrRecord>>();
  const own = (sha: string, pr: CorpusPrRecord) => {
    const set = owners.get(sha) ?? new Set();
    set.add(pr);
    owners.set(sha, set);
  };
  const rebased = originals.filter((pr) => pr.member_commits > 1);
  let position: Map<string, number> | null = null;
  let order: string[] = [];
  if (rebased.length) {
    const result = runGit(['rev-list', '--first-parent', '--reverse', branch]);
    if (result.exitCode !== 0) throw new Error(`szz: cannot list ${branch}: ${result.stderr.trim()}`);
    order = result.stdout.split('\n').filter(Boolean);
    position = new Map(order.map((sha, i) => [sha, i]));
  }
  for (const pr of originals) {
    if (pr.landed_sha && pr.landed_sha !== pr.merge_sha) continue; // rollup member: first-parent blame sees the rollup, not the member
    own(pr.merge_sha, pr);
    for (const sha of pr.relanded_merge_shas ?? []) own(sha, pr);
    if (pr.member_commits > 1 && position) {
      const from = position.get(pr.base_sha);
      const to = position.get(pr.merge_sha);
      if (from !== undefined && to !== undefined) for (let i = from + 1; i < to; i++) own(order[i]!, pr);
    }
  }
  const out = new Map<string, CorpusPrRecord>();
  for (const [sha, set] of owners) if (set.size === 1) out.set(sha, [...set][0]!);
  return out;
}

export type SzzResult =
  | { status: 'skipped'; files: number; changedLines: number }
  | { status: 'blamed'; tooLarge: boolean; files: number; changedLines: number; blamed: Map<CorpusPrRecord, number> };

/** Lines the fix deletes or modifies, blamed back to originals that landed them since `sinceEpoch`. */
export function blameFix(
  runGit: GitRunner,
  fix: { parentSha: string; tipSha: string },
  landing: ReadonlyMap<string, CorpusPrRecord>,
  sinceEpoch: number,
): SzzResult {
  // Submodule pointer bumps have no lines to blame, and blaming a gitlink asks the promisor remote for a commit it doesn't have.
  const diff = runGit(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--ignore-submodules', fix.parentSha, fix.tipSha]);
  if (diff.exitCode !== 0) throw new Error(`szz: cannot diff ${fix.parentSha}..${fix.tipSha}: ${diff.stderr.trim()}`);
  const ranges = new Map<string, [number, number][]>();
  // Old path (blame target) and either path (size): new files count toward size but have nothing to blame.
  let oldFile: string | null = null;
  let anyFile: string | null = null;
  // `---`/`+++` are headers only before a file's first hunk; after it they are content (a deleted `-- comment`).
  let inHeader = false;
  let changedLines = 0;
  const touched = new Set<string>();
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      oldFile = anyFile = null;
      inHeader = true;
      continue;
    }
    if (inHeader && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      const path = diffHeaderPath(line);
      if (path === null) continue;
      if (line.startsWith('--- ')) oldFile = path;
      anyFile ??= path;
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (hunk) inHeader = false;
    if (!hunk || !anyFile || TEST_PATH.test(anyFile) || GENERATED_PATH.test(anyFile)) continue;
    const start = Number(hunk[1]);
    const deleted = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const added = hunk[3] === undefined ? 1 : Number(hunk[3]);
    touched.add(anyFile);
    changedLines += deleted + added;
    if (oldFile && deleted > 0) {
      const list = ranges.get(oldFile) ?? [];
      list.push([start, start + deleted - 1]);
      ranges.set(oldFile, list);
    }
  }
  const files = touched.size;
  if (files > SZZ_SKIP_FILES || changedLines > SZZ_SKIP_CHANGED_LINES) return { status: 'skipped', files, changedLines };
  const blamed = new Map<CorpusPrRecord, number>();
  for (const [path, list] of ranges) {
    const result = runGit([
      'blame', '--first-parent', '-w', '-M', '-C', '--line-porcelain', `--since=@${sinceEpoch}`,
      ...list.flatMap(([a, b]) => ['-L', `${a},${b}`]),
      fix.parentSha, '--', path,
    ]);
    if (result.exitCode !== 0) throw new Error(`szz: cannot blame ${path} at ${fix.parentSha}: ${result.stderr.trim()}`);
    let sha: string | null = null;
    let boundary = false;
    for (const line of result.stdout.split('\n')) {
      const header = line.match(/^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/);
      if (header) {
        sha = header[1]!;
        boundary = false;
      } else if (line === 'boundary') {
        boundary = true;
      } else if (line.startsWith('\t')) {
        const original = sha && !boundary ? landing.get(sha) : undefined;
        if (original && line.slice(1).trim()) blamed.set(original, (blamed.get(original) ?? 0) + 1);
        sha = null;
      }
    }
  }
  return { status: 'blamed', tooLarge: files > SZZ_MAX_FILES || changedLines > SZZ_MAX_CHANGED_LINES, files, changedLines, blamed };
}
