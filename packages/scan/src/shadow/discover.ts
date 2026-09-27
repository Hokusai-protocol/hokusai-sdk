/**
 * Discover merged PRs from git history.
 */

import type { GitRunner } from '../survival-labeller.js';
import { extractPrNumber } from '../diff-parsing.js';
import { ShadowError } from './errors.js';

export interface DiscoveredMerge {
  mergeSha: string; // 40-hex
  parentSha: string; // 40-hex
  mergedAtEpoch: number; // Unix timestamp
  prNumber: number | null;
}

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Check if a SHA is an ancestor of a ref. Returns false if the SHA is missing. */
export async function isAncestor(
  runGit: GitRunner,
  sha: string,
  ref: string,
): Promise<boolean> {
  try {
    const result = await runGit(['merge-base', '--is-ancestor', sha, ref]);
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
  pendingTotal: number;
}

/** Discover merged PRs from git history. */
export async function discoverMerges(opts: DiscoverMergesOptions): Promise<DiscoverMergesResult> {
  const { runGit, ref, cursor, bootstrapDays, now, maxPrs } = opts;

  const merges: DiscoveredMerge[] = [];
  let cursorReset = false;
  let gitRevRange = '';

  // Determine git range
  if (cursor === null) {
    // First run: use bootstrap window
    const cutoffTime = new Date(now().getTime() - bootstrapDays * 86400 * 1000);
    const isoDate = cutoffTime.toISOString();
    gitRevRange = `--since=${isoDate}`;
  } else {
    // Check if cursor is an ancestor of ref
    const isAncestorResult = await isAncestor(runGit, cursor, ref);

    if (isAncestorResult) {
      // Use the range from cursor to ref
      gitRevRange = `${cursor}..${ref}`;
    } else {
      // Cursor is missing or not an ancestor: reset and use bootstrap window
      cursorReset = true;
      const cutoffTime = new Date(now().getTime() - bootstrapDays * 86400 * 1000);
      const isoDate = cutoffTime.toISOString();
      gitRevRange = `--since=${isoDate}`;
    }
  }

  // Get first-parent commits
  const format = '%H%x09%P%x09%ct%x09%s';
  const args = ['log', '--first-parent', '--reverse', `--pretty=format:${format}`, gitRevRange, ref];

  const result = await runGit(args);
  if (result.exitCode !== 0) {
    throw new ShadowError('NOT_A_GIT_REPO');
  }

  // Parse output
  const lines = result.stdout.split('\n').filter(l => l.length > 0);
  const now_epoch = Math.floor(now().getTime() / 1000);
  const cutoff_epoch = now_epoch - bootstrapDays * 86400;

  for (const line of lines) {
    const [mergeSha, parents, ctStr, subject] = line.split('\t');

    if (!mergeSha || !parents || !ctStr) {
      continue;
    }

    const mergedAtEpoch = parseInt(ctStr, 10);

    // Filter by time if we're using bootstrap window
    if (cursorReset || cursor === null) {
      if (mergedAtEpoch < cutoff_epoch) {
        continue;
      }
    }

    // Handle root commits
    const parentShas = parents.split(' ').filter(p => p.length > 0);
    const parentSha = parentShas.length > 0 ? parentShas[0] : EMPTY_TREE_SHA;

    // Extract PR number
    const prNumber = extractPrNumber(subject ?? '');

    merges.push({
      mergeSha,
      parentSha,
      mergedAtEpoch,
      prNumber,
    });

    // Respect max_prs limit
    if (merges.length >= maxPrs) {
      break;
    }
  }

  // Get pending total for first-parent from oldest candidate to ref
  let pendingTotal = 0;
  if (merges.length > 0) {
    const oldestSha = merges[0].mergeSha;
    const countResult = await runGit([
      'rev-list',
      '--first-parent',
      '--count',
      `${oldestSha}..${ref}`,
    ]);
    if (countResult.exitCode === 0) {
      pendingTotal = parseInt(countResult.stdout.trim(), 10);
    } else {
      pendingTotal = merges.length; // fallback
    }
  } else {
    pendingTotal = 0;
  }

  return {
    merges,
    cursorReset,
    pendingTotal,
  };
}
