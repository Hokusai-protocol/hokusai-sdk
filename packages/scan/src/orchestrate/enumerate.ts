import type { GitRunner, MergedPrRef } from '../survival-labeller.js';
import { extractPrNumber } from '../diff-parsing.js';
import { isAncestor } from '../shadow/discover.js';

export interface EnumeratedMerge extends Omit<MergedPrRef, 'prUrl'> { prUrl: string }
/** First-parent history, oldest first. Unnumbered commits are omitted. */
export function enumerateWindow(input: { runGit: GitRunner; branch: string; owner: string; repo: string; from: Date; asOf: Date; cursor?: string | null }): { merges: EnumeratedMerge[]; cursorReset: boolean; skipped: number; tip: string } {
  const { runGit, branch } = input;
  const cursorReset = !!input.cursor && !isAncestor(runGit, input.cursor, branch);
  const cursor = cursorReset ? null : input.cursor;
  const tipResult = runGit(['rev-parse', branch]);
  if (tipResult.exitCode !== 0) throw new Error(`Cannot resolve integration branch: ${branch}`);
  const tip = tipResult.stdout.trim();
  const since = input.from.getTime() > 0 ? [`--since=${input.from.toISOString()}`] : [];
  const args = ['log', '--first-parent', '--reverse', '--pretty=format:%H%x09%P%x09%ct%x09%s', ...(cursor ? [] : since), ...(cursor ? [`${cursor}..${branch}`] : [branch])];
  const result = runGit(args);
  if (result.exitCode !== 0) throw new Error(`Cannot enumerate integration branch: ${branch}`);
  const merges: EnumeratedMerge[] = [];
  let skipped = 0;
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;
    const [mergeSha, parentText = '', epochText = '', ...subjectParts] = line.split('\t');
    if (!mergeSha || !/^[0-9a-f]{40}$/.test(mergeSha)) continue;
    const mergedAtEpoch = Number(epochText);
    if (!Number.isInteger(mergedAtEpoch) || mergedAtEpoch * 1000 < input.from.getTime() || mergedAtEpoch * 1000 > input.asOf.getTime()) continue;
    const subject = subjectParts.join('\t');
    const prNumber = extractPrNumber(subject);
    if (prNumber === null) { skipped++; continue; }
    const parents = parentText.split(' ').filter(Boolean);
    merges.push({ prNumber, mergeSha, parentSha: parents[0] ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904', headSha: parents[1] ?? mergeSha, mergedAtEpoch, subject, prUrl: `https://github.com/${input.owner}/${input.repo}/pull/${prNumber}` });
  }
  return { merges, cursorReset, skipped, tip };
}
