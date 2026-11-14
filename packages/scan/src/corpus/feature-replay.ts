/**
 * `hokusai-scan corpus-feature-replay` (HOK-3023): the leakage audit on real PRs.
 *
 * For sampled PRs in development repos only, each row is extracted four ways:
 *   full       captured evidence and the whole default branch, as `extract` does
 *   replay     evidence cut at `as_of`, CI cut at `as_of`, post-merge record fields
 *              blanked, and git history cut at the PR's own landing commit
 *   perturbed  full evidence plus fabricated post-merge reviews, dismissals, labels,
 *              renames, body edits, CI failures and record fields
 *   control    full evidence plus one fabricated review just before `as_of`
 * `replay` and `perturbed` must be byte-identical to `full`, and `control` must differ:
 * a harness that cannot see a pre-merge change could not see a leak either.
 *
 * Sampled PR numbers stay in the private `--out` directory. Stdout holds pooled
 * counts only, and logs name development repos by position, because the list of
 * development repos would reveal the sealed evaluation slice.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CohortRepo } from './manifest.js';
import type { CorpusPrRecord } from './enumerate.js';
import { CI_CAPTURE_FROM, chunkNumbers, readCapturedBatch } from './feature-capture.js';
import { buildHistoryIndex, gitColumns, type HistoryIndex } from './feature-git.js';
import { authorEmails, landingMessage, loadEvidenceChunk, readRecords } from './feature-run.js';
import { extractPrFeatures, reviewsAt, labelsAt, truncateEvidenceAt, type CiEvidence, type FeatureRow, type PrEvidence } from './features.js';

export const REPLAY_VERSION = 'rr-feature-replay/1.0.0';
const SECOND = 1000;

/** True when `path`, or any directory above it, holds a `.git` entry. */
export function insideGitWorkTree(path: string): boolean {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

const shift = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString();

/** The CI results as they stood at `as_of`: unfinished and later results removed. */
export function truncateCiAt(ci: CiEvidence | null, asOf: string): CiEvidence | null {
  if (!ci) return null;
  const cutoff = Date.parse(asOf);
  return { ...ci, contexts: ci.contexts.filter((context) => context.at !== null && Date.parse(context.at) <= cutoff) };
}

/** The corpus record with every post-merge or enumeration-time field emptied. */
export function blankPostMergeRecord(record: CorpusPrRecord): CorpusPrRecord {
  return { ...record, relanded_merge_shas: [], labels: [], closing_issues: [], title: '', body: '' };
}

/** Evidence with fabricated activity after `as_of`, as GitHub would report it today. */
export function withPostMergeActivity(evidence: PrEvidence, asOf: string): PrEvidence {
  // After the merge and after every captured event, as a real later edit would be.
  const latest = Math.max(
    Date.parse(asOf),
    ...[...evidence.renames, ...evidence.body_edits, ...evidence.label_events, ...evidence.dismissals].map((event) => Date.parse(event.at)),
    ...evidence.reviews.flatMap((review) => (review.submitted_at ? [Date.parse(review.submitted_at)] : [])),
  );
  const after = new Date(latest + SECOND).toISOString();
  const later = new Date(latest + 30 * 86_400 * SECOND).toISOString();
  const labels = labelsAt(evidence, asOf) ?? [];
  const lastTitle = evidence.renames.length ? evidence.renames.at(-1)!.to : evidence.title;
  return {
    ...evidence,
    title: 'CANARY TITLE',
    body: 'CANARY BODY',
    reviews: [
      // Existing reviews, dismissed after the merge.
      ...evidence.reviews.map((review) => (review.state === 'DISMISSED' ? review : { ...review, state: 'DISMISSED' })),
      { id: 'canary-approve', state: 'APPROVED', submitted_at: after, author: 'canary-reviewer' },
      { id: 'canary-changes', state: 'CHANGES_REQUESTED', submitted_at: later, author: 'canary-reviewer-2' },
    ],
    dismissals: [
      ...evidence.dismissals,
      ...evidence.reviews.filter((review) => review.state !== 'DISMISSED').map((review) => ({ at: after, previous_state: review.state, review_id: review.id })),
    ],
    label_events: [
      ...evidence.label_events,
      { at: after, action: 'added' as const, label: 'canary-label' },
      ...labels.map((label) => ({ at: later, action: 'removed' as const, label })),
    ],
    renames: [...evidence.renames, { at: after, from: lastTitle, to: 'CANARY TITLE' }],
    body_edits: [
      ...(evidence.body_edits.length ? evidence.body_edits : [{ at: evidence.created_at, body: evidence.body }]),
      { at: after, body: 'CANARY BODY' },
    ],
  };
}

export function withPostMergeCi(ci: CiEvidence | null, number: number, asOf: string): CiEvidence {
  return {
    pr_number: number,
    contexts: [...(ci?.contexts ?? []), { at: shift(asOf, SECOND), failed: true }, { at: null, failed: false }],
  };
}

export function withPostMergeRecord(record: CorpusPrRecord): CorpusPrRecord {
  return { ...record, relanded_merge_shas: ['f'.repeat(40)], labels: ['canary-label'], closing_issues: [999999999], title: 'CANARY TITLE', body: 'CANARY BODY' };
}

/** One review added just before `as_of`, which every honest extractor must see. */
export function withPreMergeReview(evidence: PrEvidence, asOf: string): PrEvidence {
  const at = Date.parse(asOf) - SECOND >= Date.parse(evidence.created_at) ? shift(asOf, -SECOND) : asOf;
  return { ...evidence, reviews: [...evidence.reviews, { id: 'control-review', state: 'APPROVED', submitted_at: at, author: 'control-reviewer' }] };
}

/** Columns whose values differ between two rows; row identity included. */
export function differingColumns(a: FeatureRow, b: FeatureRow): string[] {
  const out: string[] = [];
  for (const key of ['manifest_version', 'repo', 'pr_number', 'merge_sha', 'base_sha', 'landed_by', 'as_of', 'as_of_basis'] as const) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
  }
  const columns = new Set([...Object.keys(a.features), ...Object.keys(b.features)]);
  for (const column of columns) if (JSON.stringify(a.features[column]) !== JSON.stringify(b.features[column])) out.push(column);
  return out;
}

/** A deterministic stream of floats in [0, 1) from a hex seed. */
function rng(seed: string, label: string): () => number {
  let counter = 0;
  return () => {
    const digest = createHash('sha256').update(`${seed}:${label}:${counter++}`).digest();
    return digest.readUInt32BE(0) / 2 ** 32;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface Tally {
  sampled: number;
  replay_identical: number;
  perturbed_identical: number;
  control_changed: number;
  /** PRs where a current-state reading (all reviews, labels now) differs from the merge-time one. */
  leaky_reading_differs: number;
}

const emptyTally = (): Tally => ({ sampled: 0, replay_identical: 0, perturbed_identical: 0, control_changed: 0, leaky_reading_differs: 0 });

function add(into: Tally, from: Tally): void {
  for (const key of Object.keys(into) as (keyof Tally)[]) into[key] += from[key];
}

export interface RepoReplay {
  repo: string;
  cuts: number;
  totals: Tally;
  by_landed_by: Record<string, Tally>;
  items: { pr_number: number; landed_by: string; cut_sha: string; replay: string[]; perturbed: string[]; control_changed: boolean; leaky_reading_differs: boolean }[];
}

/**
 * Picks `cuts` PRs per repo (at least one of each `landed_by` present), cuts git at
 * each one's landing commit, and replays it plus up to `perCut - 1` PRs that landed
 * shortly before it.
 */
export function replayRepo(input: { repo: string; repoDir: string; seed: string; cuts: number; perCut: number; log: (line: string) => void; label: string }): RepoReplay {
  const { repo, repoDir, seed, log, label } = input;
  const { branch } = JSON.parse(readFileSync(join(repoDir, 'enumeration.json'), 'utf8')) as { branch: string };
  const records = readRecords(repoDir);
  const gitDir = join(repoDir, 'repo.git');
  const scratch = join(repoDir, '.feature-index-replay');
  const merges = new Set(records.map((record) => record.merge_sha));

  log(`info: ${label}: indexing full history`);
  const full = buildHistoryIndex(gitDir, `refs/heads/${branch}`, scratch, merges);
  const line: string[] = [];
  for (const [sha, position] of full.firstParentPosition) line[position] = sha;

  const landing = (record: CorpusPrRecord) => full.landingPosition.get(record.merge_sha);
  const placed = records.filter((record) => landing(record) !== undefined).sort((a, b) => landing(a)! - landing(b)!);
  const random = rng(seed, repo);
  const types = [...new Set(placed.map((record) => record.landed_by))].sort();
  const anchors: CorpusPrRecord[] = [];
  for (const type of types) anchors.push(shuffled(placed.filter((record) => record.landed_by === type), random)[0]!);
  for (const record of shuffled(placed, random)) {
    if (anchors.length >= Math.max(input.cuts, types.length)) break;
    if (!anchors.includes(record)) anchors.push(record);
  }

  const evidenceCache = new Map<number, PrEvidence | null>();
  const ciCache = new Map<number, CiEvidence | null>();
  const chunks = chunkNumbers(records.map((record) => record.pr_number));
  const chunkOf = new Map<number, number[]>();
  for (const chunk of chunks) for (const number of chunk) chunkOf.set(number, chunk);
  const ciNumbers = records.filter((record) => record.merged_at >= CI_CAPTURE_FROM).map((record) => record.pr_number);
  const ciChunkOf = new Map<number, number[]>();
  for (const chunk of chunkNumbers(ciNumbers)) for (const number of chunk) ciChunkOf.set(number, chunk);
  const load = (number: number) => {
    if (!evidenceCache.has(number)) {
      for (const [pr, value] of loadEvidenceChunk(repoDir, chunkOf.get(number)!).evidence) evidenceCache.set(pr, value);
    }
    const ciChunk = ciChunkOf.get(number);
    if (!ciCache.has(number)) {
      if (ciChunk) for (const item of readCapturedBatch<CiEvidence>(repoDir, 'ci', ciChunk)?.items ?? []) ciCache.set(item.pr_number, item.value);
      if (!ciCache.has(number)) ciCache.set(number, null);
    }
    return { evidence: evidenceCache.get(number)!, ci: ciCache.get(number)! };
  };

  const row = (index: HistoryIndex, record: CorpusPrRecord, evidence: PrEvidence | null, ci: CiEvidence | null) =>
    extractPrFeatures({
      record,
      evidence,
      ci,
      landingMessage: landingMessage(record, index),
      git: gitColumns({ index, gitDir, record, authorEmails: authorEmails(record, evidence) }),
    });

  const result: RepoReplay = { repo, cuts: anchors.length, totals: emptyTally(), by_landed_by: {}, items: [] };
  anchors.forEach((anchor, cutNumber) => {
    const cutPosition = landing(anchor)!;
    const cutSha = line[cutPosition]!;
    log(`info: ${label}: cut ${cutNumber + 1}/${anchors.length}`);
    const cut = buildHistoryIndex(gitDir, cutSha, scratch, merges);
    const before = placed.filter((record) => record !== anchor && landing(record)! <= cutPosition && landing(record)! >= cutPosition - 300);
    const sample = [anchor, ...shuffled(before, random).slice(0, input.perCut - 1)];
    for (const record of sample) {
      const { evidence, ci } = load(record.pr_number);
      const asOf = record.merged_at;
      const tally = emptyTally();
      tally.sampled = 1;
      const baseline = row(full, record, evidence, ci);
      const replay = differingColumns(baseline, row(cut, blankPostMergeRecord(record), evidence ? truncateEvidenceAt(evidence, asOf) : null, truncateCiAt(ci, asOf)));
      const perturbed = evidence
        ? differingColumns(baseline, row(full, withPostMergeRecord(record), withPostMergeActivity(evidence, asOf), withPostMergeCi(ci, record.pr_number, asOf)))
        : differingColumns(baseline, row(full, withPostMergeRecord(record), null, ci));
      const controlChanged = evidence ? differingColumns(baseline, row(full, record, withPreMergeReview(evidence, asOf), ci)).length > 0 : false;
      const leaky = evidence
        ? evidence.reviews.length !== reviewsAt(evidence, asOf).length || JSON.stringify([...record.labels].sort()) !== JSON.stringify(labelsAt(evidence, asOf))
        : false;
      if (replay.length === 0) tally.replay_identical = 1;
      if (perturbed.length === 0) tally.perturbed_identical = 1;
      if (controlChanged) tally.control_changed = 1;
      if (leaky) tally.leaky_reading_differs = 1;
      add(result.totals, tally);
      add((result.by_landed_by[record.landed_by] ??= emptyTally()), tally);
      result.items.push({ pr_number: record.pr_number, landed_by: record.landed_by, cut_sha: cutSha, replay, perturbed, control_changed: controlChanged, leaky_reading_differs: leaky });
    }
  });
  return result;
}

export interface ReplayIO {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export function runFeatureReplay(input: {
  entries: readonly CohortRepo[];
  cacheRoot: string;
  slicePath: string;
  outDir: string;
  seed?: string;
  cuts: number;
  perCut: number;
  io: ReplayIO;
  log: (line: string) => void;
}): { exitCode: number } {
  const { io, log } = input;
  let sliceRepos: Set<string>;
  let sliceSha: string;
  try {
    const bytes = readFileSync(input.slicePath);
    sliceSha = createHash('sha256').update(bytes).digest('hex');
    const slice = JSON.parse(bytes.toString('utf8')) as { repos?: unknown };
    if (!Array.isArray(slice.repos) || !slice.repos.length || !slice.repos.every((r) => typeof r === 'string')) throw new Error('--exclude-slice has no repos list');
    sliceRepos = new Set(slice.repos);
    if (insideGitWorkTree(input.outDir)) throw new Error('--out must be outside any git work tree; sampled PRs would reveal development repos');
    if (existsSync(input.outDir) && readdirSync(input.outDir).length) throw new Error(`${input.outDir} is not empty`);
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  const development = input.entries.filter((entry) => !sliceRepos.has(entry.repo));
  const seed = input.seed ?? randomBytes(32).toString('hex');
  mkdirSync(input.outDir, { recursive: true });

  const totals = emptyTally();
  const byLandedBy: Record<string, Tally> = {};
  let failures = 0;
  development.forEach((entry, position) => {
    const label = `development repo ${position + 1}/${development.length}`;
    try {
      const result = replayRepo({ repo: entry.repo, repoDir: join(input.cacheRoot, entry.repo.replace('/', '__')), seed, cuts: input.cuts, perCut: input.perCut, log, label });
      writeFileSync(join(input.outDir, `replay-${position + 1}.json`), `${JSON.stringify(result, null, 2)}\n`);
      add(totals, result.totals);
      for (const [type, tally] of Object.entries(result.by_landed_by)) add((byLandedBy[type] ??= emptyTally()), tally);
    } catch (error) {
      failures++;
      log(`error: ${label}: ${(error as Error).message.slice(0, 200)}`);
    }
  });

  const summary = {
    replay_version: REPLAY_VERSION,
    excluded_slice_sha256: sliceSha,
    development_repos: development.length,
    failed_repos: failures,
    seed,
    totals,
    by_landed_by: Object.fromEntries(Object.entries(byLandedBy).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(join(input.outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  io.writeStdout(`${JSON.stringify(summary)}\n`);
  const passed = failures === 0 && totals.sampled > 0 && totals.replay_identical === totals.sampled && totals.perturbed_identical === totals.sampled;
  return { exitCode: passed ? 0 : 1 };
}
