/**
 * PR numbers a first-parent commit landed, across the merge conventions in
 * the HOK-3022 cohort. `extractPrNumber` (diff-parsing.ts) covers the two
 * GitHub-native shapes; public repos add bot and merge-queue shapes:
 *
 *   squash            "Fix the thing (#123)"
 *   merge commit      "Merge pull request #123 from org/branch"
 *   bors / homu       "Auto merge of #123 - user:branch, r=reviewer"   (rust-lang)
 *   bors batched      "Merge #123 #456 #789"                           (cockroach craig[bot])
 *   rollup            "Rollup merge of #123 - user:branch, r=reviewer" (rust-lang)
 *   merge bot trailer "Pull Request resolved: https://github.com/o/r/pull/123" (pytorch)
 *
 * Batched merges return every member. Callers treat a commit that landed
 * more than one PR as `batched` so labels can say the merge SHA is shared.
 */

const SQUASH = /\(#(\d+)\)\s*$/;
const MERGE_PR = /^merge pull request #(\d+)\b/i;
const BORS_AUTO = /^(?:auto merge|rollup merge) of #(\d+)\b/i;
const BORS_BATCH = /^merge((?:\s+#\d+)+)\s*$/i;

/** Distinct PR numbers landed by one first-parent commit, in first-seen order. */
export function extractCorpusPrNumbers(subject: string, body: string, repo: string): number[] {
  const found: number[] = [];
  const add = (value: string | undefined) => {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0 && !found.includes(n)) found.push(n);
  };
  const trimmed = subject.trim();
  const batch = trimmed.match(BORS_BATCH);
  if (batch) {
    for (const match of batch[1]!.matchAll(/#(\d+)/g)) add(match[1]);
  } else {
    add((trimmed.match(MERGE_PR) ?? trimmed.match(BORS_AUTO) ?? trimmed.match(SQUASH))?.[1]);
  }
  // Only the repo's own PR URL counts: bodies routinely cite other repos' PRs.
  const trailer = new RegExp(`^Pull Request resolved:\\s*https://github\\.com/${escapeRegExp(repo)}/pull/(\\d+)\\s*$`, 'im');
  add(body.match(trailer)?.[1]);
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
