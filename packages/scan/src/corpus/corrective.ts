/**
 * Corrective-rework detection for an enumerated corpus repo (HOK-3267):
 * P1 (revert) and P2 (repair reference) fix events, linked to the originals
 * they repair, as `@hokusai/core` corrective-rework records.
 *
 * Fix events come from two places:
 *   - PRs: the cohort's own records plus PRs merged after the cohort window
 *     up to as-of, so late originals still see their fixes
 *   - revert-shaped first-parent commits from git, which catch merge bots
 *     that push reverts directly (pytorch: ~3,700 revert commits, 99 revert PRs)
 *
 * P1 links a revert to the commit or PR it names. P2 links a PR that cites an
 * original (by number, URL or SHA) and carries a fix signal, or that closes
 * an issue which cited the original after the original merged (an earlier
 * citation is a tracking issue, not a bug report).
 *
 * Every link is kept as a candidate; automatic exclusions reject some with a
 * typed code. Accepted candidates become repair pairs, measured with git.
 *
 * Pure: git is injected. Titles, bodies and commit messages are read here and
 * never copied into records (decision-record contract §4.3).
 */

import {
  CORRECTIVE_REWORK_DEFINITION_VERSION,
  PROXY_CONFIDENCE,
  canonicalHash,
  correctiveCandidateId,
  deriveCorrectiveLabel,
  ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  type ArbiterSurvivalLabelV1,
  type CandidateEvidence,
  type CorrectiveCandidateV1,
  type CorrectiveEnvelope,
  type CorrectiveProxy,
  type CorrectiveReworkLabelV1,
  type ExclusionCode,
  type FixChangeRef,
  type OriginalChangeRef,
  type RepairPairV1,
} from '@hokusai/core';
import type { CrossReference, GitRunner } from '../survival-labeller.js';
import type { CorpusPrRecord } from './enumerate.js';

export const CORRECTIVE_LABELLER_VERSION = '1.0.0';

/** Fixes later than the longest horizon can never make a row corrective. */
export const MAX_FIX_LAG_SECONDS = 60 * 86_400;

/** Originals with more added lines than this get `line_survival: null` (vendored code, generated files). */
export const LINE_SURVIVAL_MAX_LINES = 20_000;

/** A revert-shaped first-parent commit read from git. */
export interface RevertCommit {
  sha: string;
  parents: string[];
  epoch: number;
  subject: string;
  body: string;
}

/** A change that may fix an original: a PR, or a commit pushed without one. */
export interface FixEvent {
  pr: CorpusPrRecord | null;
  sha: string;
  /** Pre-fix state: the PR's base_sha, or the commit's first parent. */
  parentSha: string;
  epoch: number;
  title: string;
  body: string;
  labels: readonly string[];
  closingIssues: readonly number[];
  authorLogin: string | null;
}

// ── Reading fix events ─────────────────────────────────────────────────────

/** Revert-shaped first-parent commits in [from, until), oldest first. */
export function readRevertCommits(runGit: GitRunner, branch: string, from: Date, until: Date): RevertCommit[] {
  const result = runGit([
    'log', '--first-parent', '--reverse', '-i', '-E',
    '--grep=^revert\\b', '--grep=^this reverts commit', '--grep=^reverted https://',
    `--since=${from.toISOString()}`, `--until=${until.toISOString()}`,
    '--pretty=format:%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e',
    branch,
  ]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot read reverts on ${branch}: ${result.stderr.trim()}`);
  const out: RevertCommit[] = [];
  for (const entry of result.stdout.split('\x1e')) {
    const [sha = '', parents = '', epochText = '', subject = '', body = ''] = entry.replace(/^\n/, '').split('\x1f');
    const epoch = Number.parseInt(epochText, 10);
    if (!/^[0-9a-f]{40}$/.test(sha) || !Number.isFinite(epoch) || epoch * 1000 < from.getTime() || epoch * 1000 >= until.getTime()) continue;
    out.push({ sha, parents: parents.trim().split(/\s+/).filter(Boolean), epoch, subject, body });
  }
  return out;
}

/**
 * One event per fix-source PR, plus one per revert commit that landed no
 * known PR. A revert commit that did land a PR (a squashed revert PR) adds its
 * message to that PR's event instead, so it is never counted twice.
 */
export function collectFixEvents(fixPrs: readonly CorpusPrRecord[], revertCommits: readonly RevertCommit[]): FixEvent[] {
  const events: FixEvent[] = [];
  const bySha = new Map<string, FixEvent>();
  for (const pr of fixPrs) {
    const event: FixEvent = {
      pr,
      sha: pr.landed_sha ?? pr.merge_sha,
      parentSha: pr.base_sha,
      epoch: Math.floor(Date.parse(pr.merged_at) / 1000),
      title: pr.title,
      body: pr.body ?? '',
      labels: pr.labels,
      closingIssues: pr.closing_issues,
      authorLogin: pr.author_login,
    };
    events.push(event);
    bySha.set(pr.merge_sha, event);
    if (pr.landed_sha) bySha.set(pr.landed_sha, event);
  }
  for (const commit of revertCommits) {
    const landed = bySha.get(commit.sha);
    if (landed) {
      landed.body = `${landed.body}\n${commit.subject}\n${commit.body}`;
      continue;
    }
    events.push({
      pr: null,
      sha: commit.sha,
      parentSha: commit.parents[0] ?? commit.sha,
      epoch: commit.epoch,
      title: commit.subject,
      body: commit.body,
      labels: [],
      closingIssues: [],
      authorLogin: null,
    });
  }
  return events;
}

// ── Signals ────────────────────────────────────────────────────────────────

/** `Revert "…"`, or a revert inside a ticket-style title (`Fixed #1 -- Reverted "…"`). */
const REVERT_TITLE = /^\s*(?:\[[^\]]*\]\s*)?revert\b|\brevert(?:ed|s)?\s+"/i;
const REVERTS_COMMIT = /^\s*this reverts commit ([0-9a-f]{7,40})/gim;
const REVERT_OF_REVERT = /^\s*(?:\[[^\]]*\]\s*)?(?:revert\s+"revert\b|re-?land\b|reapply\b|re-?apply\b)/i;
const FIX_TITLE = /^\s*(?:\[[^\]]*\]\s*)*(?:[\w.-]+(?:\([^)]*\))?!?:\s*)?(?:hot)?fix(?:e[sd])?\b|^\s*(?:\[[^\]]*\]\s*)*bug ?fix\b/i;
const FIX_LABEL = /\b(?:bug|regression|hotfix)\b|^fix$|^type: ?fix$|^kind\/(?:bug|regression)$/i;
/**
 * Regression wording just before a citation ("Regression in <sha>", "broken
 * since #123", "a crash introduced by #123"). A fix title or label alone is
 * not enough: django titles every ticket commit "Fixed #N", and fix PRs cite
 * earlier PRs they build on, discuss or include.
 */
const REGRESSION_CONTEXT = /\b(?:regress\w*|broke(?:n)?|breaks|breakage|caused by|introduced (?:in|by)|bug (?:in|from|introduced)|crash\w*|fail\w*)\b[^.\n]{0,30}$/i;
const BACKPORT = /^\s*(?:\[[^\]]*\]\s*)*\[?(?:backport|cherry[- ]?pick)\b|\(cherry picked from commit [0-9a-f]{7,40}\)/im;
const BACKPORT_LABEL = /^(?:backport|cherry[- ]?pick)/i;
const DEPENDENCY_BOT = /^(?:dependabot(?:-preview)?|renovate(?:-bot)?|greenkeeper|pyup-bot|snyk-bot|depfu)(?:\[bot\])?$/i;
/** Collateral and process reverts, from the reason a merge bot records ("Reverted <url> on behalf of <user> due to <reason>"). */
const REVERT_REASON = /\bdue to\b([^\n]*)/i;
const NON_DEFECT_REASON =
  /merge conflict|conflicts? with|(?:to|in order to)(?: be able to)? (?:cleanly )?revert|dependen(?:cy|t) (?:of|on)|depends on|land ?race|stack (?:is )?in a (?:weird|bad|broken) state|wait(?:ing)? for .{0,40}(?:confirm|approv|review)|before merging|needs? to (?:be )?land(?:ed)? internally|ghfirst|diff train/i;

function evidence(kind: CandidateEvidence['kind'], ref: string | null = null, count: number | null = null): CandidateEvidence {
  return { kind, ref, count };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Originals resolvable from fix text: by PR number and by commit SHA prefix. */
class OriginalIndex {
  readonly byNumber = new Map<number, CorpusPrRecord>();
  private readonly byPrefix = new Map<string, { sha: string; pr: CorpusPrRecord }[]>();

  constructor(originals: readonly CorpusPrRecord[]) {
    for (const pr of originals) {
      this.byNumber.set(pr.pr_number, pr);
      for (const sha of new Set([pr.merge_sha, pr.landed_sha, pr.head_sha, ...(pr.relanded_merge_shas ?? [])])) {
        if (!sha) continue;
        const bucket = this.byPrefix.get(sha.slice(0, 7)) ?? [];
        bucket.push({ sha, pr });
        this.byPrefix.set(sha.slice(0, 7), bucket);
      }
    }
  }

  /** The one original a SHA or SHA prefix names; null when unknown or ambiguous. */
  bySha(token: string): { sha: string; pr: CorpusPrRecord } | null {
    const hits = (this.byPrefix.get(token.slice(0, 7)) ?? []).filter((h) => h.sha.startsWith(token));
    const prs = new Set(hits.map((h) => h.pr));
    return prs.size === 1 ? hits[0]! : null;
  }
}

/** PR numbers this repo's text cites: `#N` (not `other/repo#N`), `owner/repo#N`, and PR/issue URLs. */
function citedNumbers(text: string, repo: string): { n: number; index: number }[] {
  const out: { n: number; index: number }[] = [];
  const pattern = new RegExp(
    `https://github\\.com/${escapeRegExp(repo)}/(?:pull|issues)/(\\d+)|\\b${escapeRegExp(repo)}#(\\d+)\\b|(?:^|[^\\w/.#-])#(\\d+)\\b`,
    'gi',
  );
  for (const m of text.matchAll(pattern)) out.push({ n: Number(m[1] ?? m[2] ?? m[3]), index: m.index ?? 0 });
  return out;
}

/** Hex tokens that could be SHAs: 7–40 chars with at least one letter, so plain numbers never match. */
function shaTokens(text: string): { token: string; index: number }[] {
  const out: { token: string; index: number }[] = [];
  for (const m of text.matchAll(/\b([0-9a-f]{7,40})\b/g)) if (/[a-f]/.test(m[1]!)) out.push({ token: m[1]!, index: m.index ?? 0 });
  return out;
}

// ── Candidate detection ────────────────────────────────────────────────────

export interface DetectCandidatesInput {
  /** `owner/name`. */
  repo: string;
  originals: readonly CorpusPrRecord[];
  events: readonly FixEvent[];
  /** Cross-referenced events per original PR number (issues and PRs that mentioned it, and when). */
  crossReferences: ReadonlyMap<number, readonly CrossReference[]>;
  envelope: CorrectiveEnvelope;
}

interface Draft {
  original: CorpusPrRecord;
  event: FixEvent;
  proxy: CorrectiveProxy;
  evidence: CandidateEvidence[];
  exclusion: ExclusionCode | null;
}

/** Every P1/P2 candidate link, accepted or rejected; one per (original, fix, proxy). */
export function detectCandidates(input: DetectCandidatesInput): { candidates: CorrectiveCandidateV1[]; events: Map<string, FixEvent> } {
  const index = new OriginalIndex(input.originals);
  const drafts = new Map<string, Draft>();
  const eventsById = new Map<string, FixEvent>();
  const issueCiters = issueCitations(input.repo, input.originals, input.crossReferences);

  const add = (original: CorpusPrRecord, event: FixEvent, proxy: CorrectiveProxy, items: CandidateEvidence[], exclusion: ExclusionCode | null) => {
    if (original.pr_url === event.pr?.pr_url) return;
    const lag = event.epoch - Math.floor(Date.parse(original.merged_at) / 1000);
    if (lag < 1 || lag > MAX_FIX_LAG_SECONDS) return;
    const id = correctiveCandidateId(original, { pr_url: event.pr?.pr_url ?? null, sha: event.sha }, proxy);
    eventsById.set(id, event);
    const draft = drafts.get(id);
    if (!draft) {
      drafts.set(id, { original, event, proxy, evidence: [...items], exclusion });
      return;
    }
    for (const item of items) if (!draft.evidence.some((e) => e.kind === item.kind && e.ref === item.ref)) draft.evidence.push(item);
    draft.exclusion ??= exclusion;
  };

  for (const event of input.events) {
    const text = `${event.title}\n${event.body}`;
    const common = commonExclusion(event);
    if (isRevert(event)) {
      const exclusion = common ?? revertExclusion(event);
      for (const target of revertTargets(event, text, input.repo, index)) {
        const ofRevert = REVERT_TITLE.test(target.original.title) ? 'revert_of_revert' : null;
        add(target.original, event, 'revert', [target.evidence], ofRevert ?? exclusion);
      }
      continue;
    }
    // P2: a citation of the original in regression wording, or a closed issue that reported it.
    // Fix titles and labels are recorded as supporting evidence only.
    const signals: CandidateEvidence[] = [];
    if (FIX_TITLE.test(event.title)) signals.push(evidence('fix_title_prefix'));
    for (const label of event.labels) if (FIX_LABEL.test(label)) signals.push(evidence('fix_label', label));
    const cited = new Map<CorpusPrRecord, CandidateEvidence[]>();
    const cite = (original: CorpusPrRecord, item: CandidateEvidence, at: number) => {
      if (!REGRESSION_CONTEXT.test(text.slice(Math.max(0, at - 60), at))) return;
      const items = cited.get(original) ?? [];
      items.push(item, evidence('regression_in_marker'));
      cited.set(original, items);
    };
    for (const { n, index: at } of citedNumbers(text, input.repo)) {
      const original = index.byNumber.get(n);
      if (original) cite(original, evidence('cites_original_pr', original.pr_url), at);
    }
    for (const { token, index: at } of shaTokens(text)) {
      const hit = index.bySha(token);
      if (hit) cite(hit.pr, evidence('cites_original_sha', hit.sha), at);
    }
    for (const issue of event.closingIssues) {
      for (const { original, url } of issueCiters.get(issue) ?? []) {
        if (original.pr_url === event.pr?.pr_url) continue;
        const items = cited.get(original) ?? [];
        items.push(evidence('closes_issue_citing_original', url));
        cited.set(original, items);
      }
    }
    for (const [original, items] of cited) add(original, event, 'repair_reference', dedupeEvidence([...items, ...signals]), common);
  }

  const candidates = [...drafts.entries()].map(([id, d]): CorrectiveCandidateV1 => ({
    schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
    record_type: 'candidate',
    candidate_id: id,
    original: originalRef(d.original),
    fix: fixRef(d.event),
    lag_seconds: d.event.epoch - Math.floor(Date.parse(d.original.merged_at) / 1000),
    proxy: d.proxy,
    confidence: PROXY_CONFIDENCE[d.proxy],
    evidence: d.evidence,
    status: d.exclusion ? 'rejected' : 'accepted',
    exclusion_code: d.exclusion,
    envelope: input.envelope,
  }));
  candidates.sort((a, b) => a.original.merged_at.localeCompare(b.original.merged_at) || a.candidate_id.localeCompare(b.candidate_id));
  return { candidates, events: eventsById };
}

function isRevert(event: FixEvent): boolean {
  return REVERT_TITLE.test(event.title) || /^\s*this reverts commit [0-9a-f]{7,40}/im.test(event.body) || /^\s*reverts [\w.-]+\/[\w.-]+#\d+/im.test(event.body);
}

function commonExclusion(event: FixEvent): ExclusionCode | null {
  if (event.authorLogin && DEPENDENCY_BOT.test(event.authorLogin)) return 'dependency_bot';
  if (BACKPORT.test(`${event.title}\n${event.body}`) || event.labels.some((l) => BACKPORT_LABEL.test(l))) return 'backport';
  return null;
}

function revertExclusion(event: FixEvent): ExclusionCode | null {
  if (REVERT_OF_REVERT.test(event.title)) return 'revert_of_revert';
  const reason = event.body.match(REVERT_REASON)?.[1];
  if (reason && NON_DEFECT_REASON.test(reason)) return 'revert_non_defect';
  return null;
}

/** What a revert names: reverted commits, `Reverts owner/repo#N`, a bot's `Reverted <PR url>`, or a PR number in the title. */
function revertTargets(event: FixEvent, text: string, repo: string, index: OriginalIndex): { original: CorpusPrRecord; evidence: CandidateEvidence }[] {
  const out: { original: CorpusPrRecord; evidence: CandidateEvidence }[] = [];
  const seen = new Set<CorpusPrRecord>();
  const push = (original: CorpusPrRecord | undefined, item: CandidateEvidence) => {
    if (original && !seen.has(original)) {
      seen.add(original);
      out.push({ original, evidence: item });
    }
  };
  for (const m of text.matchAll(REVERTS_COMMIT)) {
    const hit = index.bySha(m[1]!);
    if (hit) push(hit.pr, evidence('revert_message', hit.sha));
  }
  const prRef = new RegExp(`^\\s*reverts? ${escapeRegExp(repo)}#(\\d+)|^\\s*reverted https://github\\.com/${escapeRegExp(repo)}/pull/(\\d+)`, 'gim');
  for (const m of text.matchAll(prRef)) {
    const original = index.byNumber.get(Number(m[1] ?? m[2]));
    push(original, evidence('reverts_pr_reference', original?.pr_url ?? null));
  }
  // Then a reverted SHA cited without git's wording, then the quoted subject's PR number (`Revert "Title (#123)"`).
  if (!out.length) {
    for (const { token } of shaTokens(text)) {
      const hit = index.bySha(token);
      if (hit) push(hit.pr, evidence('revert_message', hit.sha));
    }
  }
  if (!out.length) {
    const quoted = event.title.match(/^\s*(?:\[[^\]]*\]\s*)?revert\s+"(.*)"/i)?.[1];
    for (const { n } of quoted ? citedNumbers(quoted, repo) : []) {
      const original = index.byNumber.get(n);
      push(original, evidence('reverts_pr_reference', original?.pr_url ?? null));
    }
  }
  return out;
}

/** Issue number → originals it cited after they merged (earlier citations are tracking issues, not reports). */
function issueCitations(
  repo: string,
  originals: readonly CorpusPrRecord[],
  crossReferences: ReadonlyMap<number, readonly CrossReference[]>,
): Map<number, { original: CorpusPrRecord; url: string }[]> {
  const out = new Map<number, { original: CorpusPrRecord; url: string }[]>();
  const issuePrefix = `https://github.com/${repo}/issues/`;
  for (const original of originals) {
    const merged = Math.floor(Date.parse(original.merged_at) / 1000);
    for (const ref of crossReferences.get(original.pr_number) ?? []) {
      if (!ref.url.startsWith(issuePrefix) || ref.createdAtEpoch <= merged) continue;
      const issue = Number(ref.url.slice(issuePrefix.length));
      if (!Number.isInteger(issue)) continue;
      const list = out.get(issue) ?? [];
      if (!list.some((e) => e.original === original)) list.push({ original, url: ref.url });
      out.set(issue, list);
    }
  }
  return out;
}

function dedupeEvidence(items: CandidateEvidence[]): CandidateEvidence[] {
  const seen = new Set<string>();
  return items.filter((e) => {
    const key = `${e.kind}\0${e.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function originalRef(pr: CorpusPrRecord): OriginalChangeRef {
  return { pr_url: pr.pr_url, merge_sha: pr.merge_sha, merged_at: utc(Date.parse(pr.merged_at)) };
}

function fixRef(event: FixEvent): FixChangeRef {
  return { pr_url: event.pr?.pr_url ?? null, sha: event.sha, merged_at: utc(event.epoch * 1000) };
}

/** Second-precision UTC, the form GitHub reports. */
function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── Repair pairs ───────────────────────────────────────────────────────────

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|testing)\/|(?:^|\/)test_[^/]*$|[._-](?:test|spec)s?\.[^/]+$|_test\.go$|Tests?\.(?:java|kt|cs|swift)$/;

/** The pair an accepted candidate materializes, measured from git. */
export function buildRepairPair(candidate: CorrectiveCandidateV1, original: CorpusPrRecord, fix: FixEvent, runGit: GitRunner): RepairPairV1 {
  const originalFiles = changedFiles(runGit, original.base_sha, original.merge_sha);
  // A rollup member's landing commit carries the whole rollup; its own commit is merge_sha.
  const fixChanges = changedFiles(runGit, fix.parentSha, fix.pr?.merge_sha ?? fix.sha);
  const originalPaths = new Set(originalFiles.map((f) => f.path));
  const fixPaths = new Set(fixChanges.map((f) => f.path));
  const tests = { added: 0, modified: 0, deleted: 0 };
  for (const f of fixChanges) {
    if (!TEST_PATH.test(f.path)) continue;
    if (f.status === 'A') tests.added++;
    else if (f.status === 'D') tests.deleted++;
    else tests.modified++;
  }
  return {
    schema_version: candidate.schema_version,
    record_type: 'repair_pair',
    candidate_id: candidate.candidate_id,
    original: candidate.original,
    fix: candidate.fix,
    lag_seconds: candidate.lag_seconds,
    proxy: candidate.proxy,
    confidence: candidate.confidence,
    files: {
      original: [...originalPaths].sort(),
      fix: [...fixPaths].sort(),
      fix_only: [...fixPaths].filter((p) => !originalPaths.has(p)).sort(),
      original_only: [...originalPaths].filter((p) => !fixPaths.has(p)).sort(),
      fix_preexisting: existingPaths(runGit, original.merge_sha, [...fixPaths]).sort(),
    },
    line_survival: lineSurvival(runGit, original, fix.parentSha),
    fix_tests: tests,
    // Review metadata is not in the corpus cache; null means not collected.
    original_review: { reviewed: null, review_count: null, reviewer_count: null, first_review_latency_seconds: null },
    graph_distance: null,
    envelope: candidate.envelope,
  };
}

function changedFiles(runGit: GitRunner, from: string, to: string): { status: string; path: string }[] {
  const result = runGit(['diff', '--name-status', '--no-renames', '-z', from, to]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot diff ${from}..${to}: ${result.stderr.trim()}`);
  const parts = result.stdout.split('\0').filter(Boolean);
  const out: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i]!.charAt(0), path: parts[i + 1]! });
  return out;
}

function existingPaths(runGit: GitRunner, sha: string, paths: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < paths.length; i += 200) {
    const result = runGit(['ls-tree', '-r', '--name-only', '-z', sha, '--', ...paths.slice(i, i + 200)]);
    if (result.exitCode !== 0) throw new Error(`corrective: cannot list ${sha}: ${result.stderr.trim()}`);
    out.push(...result.stdout.split('\0').filter(Boolean));
  }
  return out;
}

/**
 * Share of the original's added lines still present when the fix starts.
 * Lines the original added and the stretch from its merge to the fix's
 * parent removed are matched by content, per file, as multisets.
 */
function lineSurvival(runGit: GitRunner, original: CorpusPrRecord, fixParent: string): number | null {
  const added = diffLines(runGit, original.base_sha, original.merge_sha, '+');
  let total = 0;
  for (const lines of added.values()) for (const count of lines.values()) total += count;
  if (total === 0 || total > LINE_SURVIVAL_MAX_LINES) return null;
  const removed = diffLines(runGit, original.merge_sha, fixParent, '-', [...added.keys()]);
  let lost = 0;
  for (const [path, lines] of removed) {
    const mine = added.get(path);
    if (!mine) continue;
    for (const [line, count] of lines) lost += Math.min(count, mine.get(line) ?? 0);
  }
  return Math.round((1 - lost / total) * 10_000) / 10_000;
}

/** Non-blank added (`+`) or removed (`-`) lines per file, trimmed, as counts. */
function diffLines(runGit: GitRunner, from: string, to: string, side: '+' | '-', paths?: readonly string[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (paths && paths.length === 0) return out;
  const result = runGit(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', from, to, ...(paths ? ['--', ...paths] : [])]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot diff ${from}..${to}: ${result.stderr.trim()}`);
  let file: Map<string, number> | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // The side that names the file: `+++ b/path` for additions, `--- a/path` for removals.
      if (line.startsWith(side === '+' ? '+++ ' : '--- ')) {
        const name = line.slice(4);
        if (name === '/dev/null') file = null;
        else {
          const path = name.replace(/^[ab]\//, '');
          file = out.get(path) ?? new Map();
          out.set(path, file);
        }
      }
      continue;
    }
    if (!file || !line.startsWith(side)) continue;
    const content = line.slice(1).trim();
    if (content) file.set(content, (file.get(content) ?? 0) + 1);
  }
  return out;
}

// ── Corrective rows ────────────────────────────────────────────────────────

/** One corrective row per S2 row, derived only from accepted repair pairs. */
export function deriveCorrectiveRows(
  s2Rows: readonly ArbiterSurvivalLabelV1[],
  pairs: readonly RepairPairV1[],
  envelope: Omit<CorrectiveEnvelope, 'schema_version'>,
): CorrectiveReworkLabelV1[] {
  const byOriginal = new Map<string, RepairPairV1[]>();
  for (const pair of pairs) {
    const list = byOriginal.get(pair.original.pr_url) ?? [];
    list.push(pair);
    byOriginal.set(pair.original.pr_url, list);
  }
  return s2Rows.map((row) =>
    deriveCorrectiveLabel({
      prUrl: row.prUrl,
      horizon_days: row.horizon_days,
      base_label_hash: canonicalHash(row),
      base_label_present: row.outcome.report_outcome !== null,
      repair_pairs: byOriginal.get(row.prUrl) ?? [],
      envelope,
    }),
  );
}

export function correctiveEnvelope(branch: string, asOf: Date, now: Date): CorrectiveEnvelope {
  return {
    schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
    definition_version: CORRECTIVE_REWORK_DEFINITION_VERSION,
    labeller_version: CORRECTIVE_LABELLER_VERSION,
    integration_branch: branch,
    as_of: utc(asOf.getTime()),
    computed_at: utc(now.getTime()),
  };
}

// ── Per repo ───────────────────────────────────────────────────────────────

export interface CorrectiveCorpusRepoInput {
  /** `owner/name`. */
  repo: string;
  branch: string;
  /** The cohort: PRs that can be originals. */
  originals: readonly CorpusPrRecord[];
  /** PRs merged after the cohort window, up to as-of: fix sources only. */
  laterPrs: readonly CorpusPrRecord[];
  /** Start of the cohort window; reverts are read from here to as-of. */
  from: Date;
  asOf: Date;
  crossReferences: ReadonlyMap<number, readonly CrossReference[]>;
  s2Rows: readonly ArbiterSurvivalLabelV1[];
}

export interface CorrectiveCorpusRepoDeps {
  runGit: GitRunner;
  now: () => Date;
  onDiagnostic?: (line: string) => void;
}

export interface CorrectiveCorpusRepoResult {
  candidates: CorrectiveCandidateV1[];
  repairPairs: RepairPairV1[];
  corrective: CorrectiveReworkLabelV1[];
  /** Accepted candidates git could not measure; they get no pair, so their originals read as not corrective. */
  failedPairs: string[];
}

export function correctiveCorpusRepo(input: CorrectiveCorpusRepoInput, deps: CorrectiveCorpusRepoDeps): CorrectiveCorpusRepoResult {
  const envelope = correctiveEnvelope(input.branch, input.asOf, deps.now());
  const reverts = readRevertCommits(deps.runGit, input.branch, input.from, input.asOf);
  const events = collectFixEvents([...input.originals, ...input.laterPrs], reverts);
  deps.onDiagnostic?.(`info: ${input.repo}: ${events.length} fix events (${reverts.length} revert commits)`);
  const { candidates, events: eventsById } = detectCandidates({
    repo: input.repo,
    originals: input.originals,
    events,
    crossReferences: input.crossReferences,
    envelope,
  });
  const byUrl = new Map(input.originals.map((pr) => [pr.pr_url, pr]));
  const repairPairs: RepairPairV1[] = [];
  const failedPairs: string[] = [];
  const accepted = candidates.filter((c) => c.status === 'accepted');
  for (const [i, candidate] of accepted.entries()) {
    if (i > 0 && i % 500 === 0) deps.onDiagnostic?.(`info: ${input.repo}: measured ${i}/${accepted.length} repair pairs`);
    try {
      repairPairs.push(buildRepairPair(candidate, byUrl.get(candidate.original.pr_url)!, eventsById.get(candidate.candidate_id)!, deps.runGit));
    } catch (error) {
      failedPairs.push(candidate.candidate_id);
      deps.onDiagnostic?.(`error: ${input.repo}: cannot measure pair ${candidate.candidate_id}: ${String(error).slice(0, 200)}`);
    }
  }
  return { candidates, repairPairs, corrective: deriveCorrectiveRows(input.s2Rows, repairPairs, envelope), failedPairs };
}

/** Aggregate counts for the summary file and the sanity report. No raw content. */
export function summarizeCorrective(result: CorrectiveCorpusRepoResult, originals: number) {
  const count = <T>(items: readonly T[], key: (item: T) => string) =>
    items.reduce<Record<string, number>>((acc, item) => ((acc[key(item)] = (acc[key(item)] ?? 0) + 1), acc), {});
  const byHorizon: Record<string, { rows: number; true: number; false: number; null: number; true_share: number | null }> = {};
  for (const row of result.corrective) {
    const h = (byHorizon[row.horizon_days] ??= { rows: 0, true: 0, false: 0, null: 0, true_share: null });
    h.rows++;
    h[String(row.corrective) as 'true' | 'false' | 'null']++;
  }
  for (const h of Object.values(byHorizon)) h.true_share = h.true + h.false ? Math.round((h.true / (h.true + h.false)) * 10_000) / 10_000 : null;
  const flagged = new Set(result.repairPairs.map((p) => p.original.pr_url));
  return {
    candidates: result.candidates.length,
    candidates_by_proxy_status: count(result.candidates, (c) => `${c.proxy}:${c.status}`),
    exclusions: count(result.candidates.filter((c) => c.exclusion_code), (c) => c.exclusion_code!),
    repair_pairs: result.repairPairs.length,
    direct_push_fixes: result.repairPairs.filter((p) => p.fix.pr_url === null).length,
    failed_pairs: result.failedPairs.length,
    originals,
    originals_with_fix_60d: flagged.size,
    originals_with_fix_60d_share: originals ? Math.round((flagged.size / originals) * 10_000) / 10_000 : null,
    corrective_by_horizon: byHorizon,
  };
}
