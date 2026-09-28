/**
 * Discover merged PRs from local git history (no GitHub API).
 *
 * Discovery walks the integration branch's first-parent history from the
 * stored cursor (`last_seen_merge_sha`). A missing or non-ancestor cursor
 * falls back to a bounded `bootstrapDays` window instead of crashing.
 * Commit subjects are parsed for a PR number and then dropped immediately;
 * they never leave this module (Arbiter S5).
 */

import type { GitRunner } from '../survival-labeller.js';
import { extractPrNumber } from '../diff-parsing.js';
import { ShadowError } from './errors.js';

export interface DiscoveredMerge {
  mergeSha: string; // 40-hex
  parentSha: string; // 40-hex (empty-tree SHA for root commits)
  mergedAtEpoch: number; // Unix timestamp
  prNumber: number | null;
}

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Check if a SHA is an ancestor of a ref. Returns false if the SHA is missing. */
export function isAncestor(runGit: GitRunner, sha: string, ref: string): boolean {
  try {
    const result = runGit(['merge-base', '--is-ancestor', sha, ref]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export interface DiscoverMergesOptions {
  runGit: GitRunner;
  ref: string;
  cursor: string | null; // last_seen_merge_sha
  bootstrapDays: number;
  now: () => Date;
  maxPrs: number;
}

export interface DiscoverMergesResult {
  merges: DiscoveredMerge[];
  cursorReset: boolean;
}

/** Discover merged PRs from git history, oldest first, capped at maxPrs. */
export function discoverMerges(opts: DiscoverMergesOptions): DiscoverMergesResult {
  const { runGit, ref, cursor, bootstrapDays, now, maxPrs } = opts;

  const merges: DiscoveredMerge[] = [];
  let cursorReset = false;
  let useBootstrapWindow = cursor === null;

  if (cursor !== null && !isAncestor(runGit, cursor, ref)) {
    // Cursor is missing or not an ancestor (rewritten history): reset.
    cursorReset = true;
    useBootstrapWindow = true;
  }

  const cutoffEpoch = Math.floor(now().getTime() / 1000) - bootstrapDays * 86400;
  const format = '%H%x09%P%x09%ct%x09%s';
  const args = useBootstrapWindow
    ? [
        'log',
        '--first-parent',
        '--reverse',
        `--pretty=format:${format}`,
        `--since=${new Date(cutoffEpoch * 1000).toISOString()}`,
        ref,
      ]
    : ['log', '--first-parent', '--reverse', `--pretty=format:${format}`, `${cursor}..${ref}`];

  const result = runGit(args);
  if (result.exitCode !== 0) {
    throw new ShadowError('NOT_A_GIT_REPO');
  }

  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [mergeSha, parentsText = '', epochText = '', ...subjectParts] = line.split('\t');
    if (!mergeSha || !/^[0-9a-f]{40}$/.test(mergeSha)) continue;

    const mergedAtEpoch = Number.parseInt(epochText, 10);
    if (!Number.isFinite(mergedAtEpoch)) continue;

    // `--since` filters on commit date already; re-filter in code so the
    // injected clock, not git's wall clock, is authoritative.
    if (useBootstrapWindow && mergedAtEpoch < cutoffEpoch) continue;

    const parents = parentsText.trim().split(/\s+/).filter(Boolean);
    const parentSha = parents[0] ?? EMPTY_TREE_SHA;

    // The subject is parsed for a PR number and dropped here (S5 privacy).
    const subject = subjectParts.join('\t');
    const prNumber = extractPrNumber(subject);

    merges.push({ mergeSha, parentSha, mergedAtEpoch, prNumber });
    if (merges.length >= maxPrs) break;
  }

  return { merges, cursorReset };
}
