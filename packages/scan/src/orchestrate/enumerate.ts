import type { GitRunner } from '../survival-labeller.js';
import { extractPrNumber } from '../diff-parsing.js';
import { isAncestor } from '../shadow/discover.js';

export interface WindowMerge {
  mergeSha: string;
  parentSha: string;
  mergedAtEpoch: number;
  prNumber: number | null;
  headSha: string;
}
export interface EnumerateWindowOptions {
  runGit: GitRunner;
  branch: string;
  from: Date;
  to: Date;
  cursor?: string | null;
  maxPrs?: number;
}
export interface EnumerateWindowResult { merges: WindowMerge[]; cursorReset: boolean }
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** First-parent merge-window walk, oldest first. Raw subjects are parsed then discarded. */
export function enumerateWindow(options: EnumerateWindowOptions): EnumerateWindowResult {
  const { runGit, branch, from, to, cursor = null, maxPrs = Number.MAX_SAFE_INTEGER } = options;
  const cutoff = Math.floor(from.getTime() / 1000);
  const end = Math.floor(to.getTime() / 1000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getTime() > to.getTime() || cutoff > end) throw new RangeError('Invalid merge window');
  let reset = false;
  let bootstrap = cursor === null;
  if (cursor !== null && !isAncestor(runGit, cursor, branch)) { reset = true; bootstrap = true; }
  const fmt = '%H%x09%P%x09%ct%x09%s';
  const args = bootstrap
    ? ['log', '--first-parent', '--reverse', `--pretty=format:${fmt}`, ...(cutoff > 0 ? [`--since=${from.toISOString()}`] : []), branch]
    : ['log', '--first-parent', '--reverse', `--pretty=format:${fmt}`, `${cursor}..${branch}`];
  const result = runGit(args);
  if (result.exitCode !== 0) throw new Error('Unable to enumerate integration branch history');
  const merges: WindowMerge[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [sha, parentsText = '', epochText = '', ...subjectParts] = line.split('\t');
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const epoch = Number.parseInt(epochText, 10);
    if (!Number.isFinite(epoch) || epoch < cutoff || epoch > end) continue;
    const parents = parentsText.trim().split(/\s+/).filter(Boolean);
    const parentSha = parents[0] ?? EMPTY_TREE_SHA;
    const subject = subjectParts.join('\t');
    merges.push({ mergeSha: sha, parentSha, mergedAtEpoch: epoch, prNumber: extractPrNumber(subject), headSha: parents[1] ?? sha });
  }
  const cap = Math.max(0, Math.floor(maxPrs));
  return { merges: cap < merges.length ? merges.slice(-cap) : merges, cursorReset: reset };
}
