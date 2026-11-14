/**
 * Git columns for merge-time features (HOK-3023), as of each PR's `base_sha`.
 *
 * Per-PR `git log` would take days on llvm, so one pass builds an in-memory index
 * of the default branch. The leakage gate is position, not date: a commit counts
 * only if it landed at or before `base_sha` on the first-parent line, and commit
 * dates, which authors and bots can set, are never read. Time windows use landing
 * position too.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isTestFile } from '../candidate-features.js';
import { fileComplexity, getExtension } from '../static-features.js';
import { isFixSubject } from './corrective.js';
import type { CorpusPrRecord } from './enumerate.js';
import type { GitFeatureColumns } from './features.js';

const DAY_MS = 86_400_000;
const WINDOW_MS = 90 * DAY_MS;
const OUTPUT_LIMIT = 1024 ** 3;
/** Larger source is nearly always generated, and regex scanning it is slow. */
const MAX_COMPLEXITY_FILE_BYTES = 2 * 1024 ** 2;
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function gitBuffer(gitDir: string, args: readonly string[], input?: string): { ok: boolean; stdout: Buffer } {
  // No lazy fetch: corpus-label backfilled every blob, so a miss must not turn into network traffic.
  const result = spawnSync('git', ['--no-lazy-fetch', '-C', gitDir, ...args], {
    maxBuffer: OUTPUT_LIMIT,
    stdio: ['pipe', 'pipe', 'ignore'],
    ...(input === undefined ? {} : { input }),
  });
  return { ok: result.status === 0, stdout: result.stdout ?? Buffer.alloc(0) };
}

/** Streams records split by `separator` from a command's output, which can exceed any string limit. */
function forEachGitRecord(gitDir: string, args: readonly string[], scratch: string, separator: number, onRecord: (record: string) => void): void {
  const out = openSync(scratch, 'w');
  try {
    const result = spawnSync('git', ['--no-lazy-fetch', '-C', gitDir, ...args], { stdio: ['ignore', out, 'pipe'], maxBuffer: 16 * 1024 ** 2 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim().split('\n').pop()}`);
  } finally {
    closeSync(out);
  }
  const fd = openSync(scratch, 'r');
  try {
    const chunk = Buffer.alloc(32 * 1024 ** 2);
    let carry = Buffer.alloc(0);
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) {
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, read)]) : Buffer.from(chunk.subarray(0, read));
      let start = 0;
      for (let end = data.indexOf(separator, start); end !== -1; end = data.indexOf(separator, start)) {
        if (end > start) onRecord(data.toString('utf8', start, end));
        start = end + 1;
      }
      carry = data.subarray(start);
    }
    if (carry.length) onRecord(carry.toString('utf8'));
  } finally {
    closeSync(fd);
    rmSync(scratch, { force: true });
  }
}

export class HistoryIndex {
  /** First-parent position of each commit on the line. */
  readonly firstParentPosition = new Map<string, number>();
  /** Position at which each reachable commit landed on the line. */
  readonly landingPosition = new Map<string, number>();
  /** Running maximum of landing times, so a mis-dated commit cannot reorder a window. */
  readonly landingTimes: number[] = [];
  readonly landingMessages = new Map<string, string>();

  private readonly commitPosition: number[] = [];
  private readonly commitAuthor: number[] = [];
  private readonly commitIsFix: boolean[] = [];
  private readonly authorIds = new Map<string, number>();
  private readonly authorCommits: number[][] = [];
  private readonly files = new Map<string, number[]>();
  private readonly commitIds = new Map<string, number>();

  addLandingLine(lines: readonly { sha: string; epochSeconds: number }[]): void {
    let latest = 0;
    lines.forEach((line, position) => {
      this.firstParentPosition.set(line.sha, position);
      latest = Math.max(latest, line.epochSeconds * 1000);
      this.landingTimes.push(latest);
    });
  }

  addCommit(sha: string, email: string, subject: string, paths: readonly string[]): void {
    const position = this.landingPosition.get(sha);
    if (position === undefined) return;
    const key = email.trim().toLowerCase();
    let author = this.authorIds.get(key);
    if (author === undefined) {
      author = this.authorIds.size;
      this.authorIds.set(key, author);
      this.authorCommits.push([]);
    }
    const id = this.commitPosition.length;
    this.commitIds.set(sha, id);
    this.commitPosition.push(position);
    this.commitAuthor.push(author);
    this.commitIsFix.push(isFixSubject(subject));
    this.authorCommits[author]!.push(position);
    for (const path of paths) {
      const list = this.files.get(path);
      if (list) list.push(id);
      else this.files.set(path, [id]);
    }
  }

  /** Sorts by landing position. Call once, after every commit is added. */
  seal(): void {
    for (const list of this.files.values()) list.sort((a, b) => this.commitPosition[a]! - this.commitPosition[b]!);
    for (const list of this.authorCommits) list.sort((a, b) => a - b);
  }

  /** The newest line position whose history is certainly within `base_sha`'s ancestors. */
  basePosition(baseSha: string): number | null {
    if (baseSha === EMPTY_TREE_SHA) return -1;
    const direct = this.firstParentPosition.get(baseSha);
    if (direct !== undefined) return direct;
    // A rollup member's parent sits on a side branch. Everything before its landing is an
    // ancestor; earlier members of the same rollup are left out, which can only undercount.
    const landed = this.landingPosition.get(baseSha);
    return landed === undefined ? null : landed - 1;
  }

  private firstAtOrAfter(list: readonly number[], position: number, read: (value: number) => number): number {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (read(list[middle]!) < position) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** The first line position that landed inside the 90 days before `asOfMs`. */
  private windowStart(asOfMs: number): number {
    return this.firstAtOrAfter(this.landingTimes, asOfMs - WINDOW_MS, (time) => time);
  }

  historyColumns(input: {
    basePosition: number;
    asOfMs: number;
    changedFiles: readonly string[];
    existingFiles: readonly string[];
    authorEmails: readonly string[] | null;
  }): GitFeatureColumns {
    const { basePosition, asOfMs } = input;
    const windowStart = this.windowStart(asOfMs);
    const position = (id: number) => this.commitPosition[id]!;
    const recent = new Set<number>();
    for (const path of input.changedFiles) {
      const list = this.files.get(path);
      if (!list) continue;
      const from = this.firstAtOrAfter(list, windowStart, position);
      const to = this.firstAtOrAfter(list, basePosition + 1, position);
      for (let i = from; i < to; i++) recent.add(list[i]!);
    }

    let newestFileMs: number | null = null;
    for (const path of input.existingFiles) {
      const first = this.files.get(path)?.[0];
      if (first === undefined || position(first) > basePosition) continue;
      const created = this.landingTimes[position(first)]!;
      newestFileMs = newestFileMs === null ? created : Math.max(newestFileMs, created);
    }

    const authorIds = (input.authorEmails ?? []).flatMap((email) => {
      const id = this.authorIds.get(email.trim().toLowerCase());
      return id === undefined ? [] : [id];
    });
    let repoCommits = 0;
    for (const id of authorIds) {
      const list = this.authorCommits[id]!;
      repoCommits += this.firstAtOrAfter(list, basePosition + 1, (value) => value);
    }
    const touched = new Set<number>();
    if (authorIds.length) {
      const ids = new Set(authorIds);
      for (const path of input.changedFiles) {
        const list = this.files.get(path);
        if (!list) continue;
        const to = this.firstAtOrAfter(list, basePosition + 1, position);
        for (let i = 0; i < to; i++) if (ids.has(this.commitAuthor[list[i]!]!)) touched.add(list[i]!);
      }
    }

    return {
      'feature.history.file_commits_90d': recent.size,
      'feature.history.file_authors_90d': new Set([...recent].map((id) => this.commitAuthor[id]!)).size,
      'feature.history.file_fix_commits_90d': [...recent].filter((id) => this.commitIsFix[id]).length,
      'feature.history.newest_file_age_days': newestFileMs === null ? null : Number((Math.max(0, asOfMs - newestFileMs) / DAY_MS).toFixed(2)),
      'feature.author.repo_commits_prior': input.authorEmails === null ? null : repoCommits,
      'feature.author.touched_file_commits_prior': input.authorEmails === null ? null : touched.size,
    };
  }

  /** Author email of a non-merge commit in the index, for a PR whose own commits are unknown. */
  commitEmail(sha: string): string | null {
    const id = this.commitIds.get(sha);
    if (id === undefined) return null;
    const author = this.commitAuthor[id]!;
    for (const [email, value] of this.authorIds) if (value === author) return email;
    return null;
  }
}

export function buildHistoryIndex(gitDir: string, tip: string, scratchPrefix: string, messagesFor: ReadonlySet<string>): HistoryIndex {
  const index = new HistoryIndex();
  const line: { sha: string; epochSeconds: number }[] = [];
  forEachGitRecord(gitDir, ['log', '--first-parent', '--reverse', '--format=%H%x1f%ct%x1f%B%x1e', tip], `${scratchPrefix}.line`, 0x1e, (record) => {
    const [sha = '', epoch = '0', message = ''] = record.replace(/^\n/, '').split('\x1f');
    line.push({ sha, epochSeconds: Number(epoch) });
    if (messagesFor.has(sha)) index.landingMessages.set(sha, message.trim());
  });
  index.addLandingLine(line);

  const parents = new Map<string, string[]>();
  forEachGitRecord(gitDir, ['rev-list', '--parents', tip], `${scratchPrefix}.parents`, 0x0a, (record) => {
    const [sha = '', ...rest] = record.split(' ');
    parents.set(sha, rest);
  });
  // Oldest first, so each commit is credited to the first line position that reaches it.
  line.forEach(({ sha }, position) => {
    const stack = [sha];
    while (stack.length) {
      const current = stack.pop()!;
      if (index.landingPosition.has(current)) continue;
      index.landingPosition.set(current, position);
      for (const parent of parents.get(current) ?? []) stack.push(parent);
    }
  });
  parents.clear();

  forEachGitRecord(
    gitDir,
    ['log', '--no-merges', '--no-renames', '-z', '--name-only', '--format=%x1e%H%x1f%ae%x1f%s%x1f', tip],
    `${scratchPrefix}.files`,
    0x1e,
    (record) => {
      const [sha = '', email = '', subject = '', files = ''] = record.split('\x1f');
      // With -z, git writes a newline before each commit's first path.
      index.addCommit(sha, email, subject, files.split('\0').map((path) => path.replace(/^\n/, '')).filter(Boolean));
    },
  );
  index.seal();
  return index;
}

export interface DiffFacts {
  files: { path: string; status: string; oldOid: string; newOid: string; added: number; deleted: number }[];
  diffSha256: string | null;
}

/** Parses `git diff --raw --numstat -z`. Binary files count as zero lines. */
export function parseRawNumstat(output: string): DiffFacts['files'] {
  const tokens = output.split('\0');
  const files = new Map<string, DiffFacts['files'][number]>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token) continue;
    if (token.startsWith(':')) {
      const [, , oldOid = '', newOid = '', status = ''] = token.slice(1).split(' ');
      const path = tokens[++i] ?? '';
      files.set(path, { path, status: status.charAt(0), oldOid, newOid, added: 0, deleted: 0 });
      continue;
    }
    const [added = '0', deleted = '0', ...rest] = token.split('\t');
    const file = files.get(rest.join('\t'));
    if (file) {
      file.added = Number(added) || 0;
      file.deleted = Number(deleted) || 0;
    }
  }
  return [...files.values()];
}

const DIFF_FLAGS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', '--full-index'];

export function readDiff(gitDir: string, baseSha: string, mergeSha: string): DiffFacts | null {
  const facts = gitBuffer(gitDir, ['diff', ...DIFF_FLAGS, '--abbrev=40', '--raw', '--numstat', '-z', baseSha, mergeSha]);
  if (!facts.ok) return null;
  const patch = gitBuffer(gitDir, ['diff', ...DIFF_FLAGS, '-p', baseSha, mergeSha]);
  return {
    files: parseRawNumstat(facts.stdout.toString('utf8')),
    diffSha256: patch.ok ? createHash('sha256').update(patch.stdout).digest('hex') : null,
  };
}

const ZERO_OID = /^0+$/;

/** `COMPLEXITY_METRIC_ID` at the merge minus the base; null when no changed file is analyzable. */
export function complexityDelta(gitDir: string, files: DiffFacts['files']): number | null {
  const measured = files.filter((file) => fileComplexity('', getExtension(file.path)) !== null);
  if (measured.length === 0) return null;
  const oids = [...new Set(measured.flatMap((file) => [file.oldOid, file.newOid]).filter((oid) => !ZERO_OID.test(oid)))];
  if (oids.length === 0) return null;
  const output = gitBuffer(gitDir, ['cat-file', '--batch'], `${oids.join('\n')}\n`);
  if (!output.ok) return null;

  const blobs = new Map<string, Buffer | 'oversized'>();
  for (let offset = 0; offset < output.stdout.length; ) {
    const newline = output.stdout.indexOf(0x0a, offset);
    if (newline === -1) return null;
    const [oid = '', type = '', size = ''] = output.stdout.toString('utf8', offset, newline).split(' ');
    if (type === 'missing' || (type !== 'blob' && type !== 'commit')) return null;
    const bytes = Number(size);
    blobs.set(oid, bytes > MAX_COMPLEXITY_FILE_BYTES ? 'oversized' : output.stdout.subarray(newline + 1, newline + 1 + bytes));
    offset = newline + 1 + bytes + 1;
  }

  let delta = 0;
  let any = false;
  for (const file of measured) {
    const extension = getExtension(file.path);
    const oldBlob = ZERO_OID.test(file.oldOid) ? null : blobs.get(file.oldOid);
    const newBlob = ZERO_OID.test(file.newOid) ? null : blobs.get(file.newOid);
    // A path too large on either side is skipped on both, so the delta stays comparable.
    if (oldBlob === 'oversized' || newBlob === 'oversized') continue;
    if (oldBlob === undefined || newBlob === undefined) return null;
    delta += (newBlob ? fileComplexity(newBlob.toString('utf8'), extension) ?? 0 : 0) - (oldBlob ? fileComplexity(oldBlob.toString('utf8'), extension) ?? 0 : 0);
    any = true;
  }
  return any ? delta : null;
}

export function gitColumns(input: {
  index: HistoryIndex;
  gitDir: string;
  record: CorpusPrRecord;
  authorEmails: readonly string[] | null;
}): GitFeatureColumns {
  const { index, gitDir, record } = input;
  const asOfMs = Date.parse(record.merged_at);
  const diff = readDiff(gitDir, record.base_sha, record.merge_sha);
  const shape: GitFeatureColumns = diff
    ? {
        'feature.shape.files_touched': diff.files.length,
        'feature.shape.lines_added': diff.files.reduce((sum, file) => sum + file.added, 0),
        'feature.shape.lines_deleted': diff.files.reduce((sum, file) => sum + file.deleted, 0),
        'feature.shape.loc_touched': diff.files.reduce((sum, file) => sum + file.added + file.deleted, 0),
        'feature.shape.tests_changed': diff.files.some((file) => isTestFile(file.path)),
        'feature.shape.complexity_delta': complexityDelta(gitDir, diff.files),
        'feature.content.diff_sha256': diff.diffSha256,
        'feature.history.new_files': diff.files.filter((file) => file.status === 'A').length,
      }
    : {};
  const basePosition = index.basePosition(record.base_sha);
  if (!diff || basePosition === null) return shape;

  const emails = input.authorEmails ?? (() => {
    const email = index.commitEmail(record.merge_sha);
    return email ? [email] : null;
  })();
  return {
    ...shape,
    ...index.historyColumns({
      basePosition,
      asOfMs,
      changedFiles: diff.files.map((file) => file.path),
      existingFiles: diff.files.filter((file) => file.status !== 'A').map((file) => file.path),
      authorEmails: emails,
    }),
  };
}
