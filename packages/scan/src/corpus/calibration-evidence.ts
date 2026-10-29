/**
 * Evidence for each calibration item (HOK-3269): what a labeller, person or
 * model, reads to judge it. The original PR's title, body and diff; each
 * candidate fix's; and the later PRs within the horizon that touched the
 * original's files. That last list is what makes negatives labellable: a
 * labeller reviews a short list instead of searching the repo's history.
 *
 * Titles and bodies come from the local-only enumeration cache, so evidence
 * stays in the private sample directory. Pure: git is injected.
 */

import type { GitRunner } from '../survival-labeller.js';
import type { CorpusPrRecord } from './enumerate.js';
import type { SampleItem } from './calibration.js';

/** Diffs past this many characters are cut, and marked as cut; vendored drops and mass renames tell a labeller nothing more. */
export const EVIDENCE_DIFF_MAX_CHARS = 60_000;
/** Related PRs listed per item, earliest first. */
export const EVIDENCE_RELATED_MAX = 15;
/** Files of the original passed to the related-PR search; the rest are dropped from it (and counted). */
export const EVIDENCE_RELATED_MAX_FILES = 50;

export interface ChangeEvidence {
  url: string;
  title: string | null;
  body: string | null;
  merged_at: string | null;
  files: string[];
  diff: string;
  diff_truncated: boolean;
}

export interface ItemEvidence {
  item_id: string;
  original: ChangeEvidence;
  fixes: ChangeEvidence[];
  /** Later PRs, within the horizon, that touched the original's files; candidate fixes are left out. */
  related: { url: string; title: string | null; merged_at: string }[];
  /** Original files left out of the related-PR search. */
  related_files_dropped: number;
}

function git(runGit: GitRunner, args: string[]): string {
  const result = runGit(args);
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim().split('\n').pop()}`);
  return result.stdout;
}

function cap(diff: string): { diff: string; diff_truncated: boolean } {
  return diff.length > EVIDENCE_DIFF_MAX_CHARS ? { diff: `${diff.slice(0, EVIDENCE_DIFF_MAX_CHARS)}\n[diff truncated at ${EVIDENCE_DIFF_MAX_CHARS} characters]`, diff_truncated: true } : { diff, diff_truncated: false };
}

function change(runGit: GitRunner, url: string, from: string, to: string, pr: CorpusPrRecord | undefined): ChangeEvidence {
  const files = git(runGit, ['diff', '--name-only', '--no-renames', from, to]).split('\n').filter(Boolean);
  return {
    url,
    title: pr?.title ?? null,
    body: pr?.body ?? null,
    merged_at: pr?.merged_at ?? null,
    files,
    ...cap(git(runGit, ['diff', '--no-color', '--no-ext-diff', '--stat', '--patch', from, to])),
  };
}

/** Everything a labeller reads for one item. `prs` holds originals and fix sources; `bySha` maps first-parent SHAs to the PR that landed them. */
export function buildItemEvidence(
  item: SampleItem,
  context: { branch: string; horizonDays: number; prs: ReadonlyMap<string, CorpusPrRecord>; bySha: ReadonlyMap<string, CorpusPrRecord> },
  runGit: GitRunner,
): ItemEvidence {
  const pr = context.prs.get(item.pr_url);
  if (!pr) throw new Error(`${item.item_id}: original not in the enumeration cache`);
  const original = change(runGit, pr.pr_url, pr.base_sha, pr.merge_sha, pr);

  const fixUrls = [...new Set(item.candidates.map((c) => c.fix_url))].sort();
  const fixes = fixUrls.map((url) => {
    const fixPr = context.prs.get(url);
    if (fixPr) return change(runGit, url, fixPr.base_sha, fixPr.merge_sha, fixPr);
    const sha = url.match(/\/commit\/([0-9a-f]{40})$/)?.[1];
    if (!sha) throw new Error(`${item.item_id}: fix ${url} is neither an enumerated PR nor a commit`);
    return change(runGit, url, `${sha}^`, sha, undefined);
  });

  const searched = original.files.slice(0, EVIDENCE_RELATED_MAX_FILES);
  const since = new Date(pr.merged_at);
  const until = new Date(since.getTime() + context.horizonDays * 86_400_000);
  const related: ItemEvidence['related'] = [];
  if (searched.length) {
    const log = git(runGit, ['log', '--first-parent', '--format=%H %cI', `--since=${since.toISOString()}`, `--until=${until.toISOString()}`, context.branch, '--', ...searched]);
    const seen = new Set([pr.pr_url, ...fixUrls]);
    const later = log
      .split('\n')
      .filter(Boolean)
      .map((line) => context.bySha.get(line.split(' ')[0]!))
      .filter((r): r is CorpusPrRecord => !!r && r.merged_at > pr.merged_at)
      .sort((a, b) => a.merged_at.localeCompare(b.merged_at));
    for (const r of later) {
      if (seen.has(r.pr_url) || related.length >= EVIDENCE_RELATED_MAX) continue;
      seen.add(r.pr_url);
      related.push({ url: r.pr_url, title: r.title, merged_at: r.merged_at });
    }
  }
  return { item_id: item.item_id, original, fixes, related, related_files_dropped: original.files.length - searched.length };
}
