/**
 * `hokusai-scan corpus-enumerate` (HOK-3265): enumerate every runnable cohort
 * repo into a local corpus cache.
 *
 * Per repo, under `<cache-dir>/<owner>__<name>/`:
 *   repo.git/         bare, blobless clone (commits only; later phases fetch blobs on demand)
 *   graphql/          finished GraphQL slices, so an interrupted run resumes
 *   prs.jsonl         CorpusPrRecord rows — LOCAL ONLY: carries titles and bodies
 *   enumeration.json  stats only (no raw content); safe to publish
 *
 * `hokusai-scan corpus-label` (HOK-3266) then labels an enumerated repo:
 *   git backfill      fetches every blob once, so diffs never lazy-fetch
 *   graphql/          cross-reference batches cached alongside enumeration
 *   s2.jsonl.gz       S2 v1.1.0 rows, one per PR × horizon (derived; no raw content).
 *                     Gzip, ~20× smaller: each PR's line_ranges repeat across its horizons
 *   s2.summary.json   row counts, report_outcome base rates, failures, timing
 *
 * `hokusai-scan corpus-corrective` (HOK-3267) then finds fixes for a labelled repo:
 *   fix-prs.jsonl            PRs merged after the window up to as-of, as fix sources — LOCAL ONLY
 *   candidates.jsonl.gz      every proposed original→fix link, accepted or rejected
 *   repair_pairs.jsonl.gz    one per accepted candidate
 *   corrective.jsonl.gz      one per S2 row (derived; no raw content)
 *   corrective.summary.json  counts by proxy, exclusion and horizon
 *
 * `hokusai-scan corpus-report` (HOK-3268) then summarizes the persisted outputs once, into `--out`:
 *   corpus-report.json   per repo × horizon summaries, sanity flags and the rate spread per merge convention
 *   corpus-report.md     the same as a table
 *   run-manifest.json    run ID, label versions, and the SHA-256 and row count of every input file
 * A flag is resolved by a note in `--notes` (explained, or the repo dropped); unresolved flags exit 1.
 *
 * `hokusai-scan corpus-calibration-sample` (HOK-3269) draws the calibration sample into a
 * private `--out` directory outside any git work tree, never overwriting a drawn sample:
 *   sample.json          plan, seed, input hashes, cells and items (PR URLs) — PRIVATE
 * Repos in `--exclude-slice` (the HOK-3028 evaluation slice) are dropped before the draw; the
 * slice file is read here only, and nothing about it but its SHA-256 is written or printed.
 * `hokusai-scan corpus-calibration-evidence --sample <dir>` then gathers what labellers read:
 *   evidence.jsonl       per item: original and fix titles, bodies and diffs, related later PRs — PRIVATE
 *   sheet-h.csv          the blank human-audit sheet — PRIVATE once labelled
 * Model labellers (scripts/corpus/label-calibration.mjs) write sheet-a.csv and sheet-b.csv.
 * `hokusai-scan corpus-calibration-score --sample <dir>` then scores the three sheets:
 *   calibration-results.json  every estimate, with real repo names — PRIVATE
 *   calibration-table.md      the shareable table, repos pseudonymized
 * Invalid labels exit 2 with the item IDs; unlabelled items are counted and the table marked INCOMPLETE.
 *
 * stdout: one stats JSON line per repo. Exit 0 when every repo enumerated,
 * 2 on invalid input, 3 when any repo failed upstream (others still finish).
 * No ambient process state is read here; the caller supplies `cwd`, and `gh`
 * supplies GitHub auth.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { execArgvCommand } from '../shell-utils.js';
import { GIT_OUTPUT_MAX_BUFFER, type GitRunner } from '../survival-labeller.js';
import { HORIZONS, type ArbiterSurvivalLabelV1, type CorrectiveCandidateV1, type CorrectiveReworkLabelV1 } from '@hokusai/core';
import { summarizeLabels } from '../survival-labeller.js';
import {
  CALIBRATION_SAMPLER_VERSION,
  CALIBRATION_STRATA,
  classifyCalibrationRepo,
  drawCalibrationSample,
  parseCalibrationPlan,
  parseCsv,
  parseLabelSheet,
  renderCalibrationMarkdown,
  renderLabelSheet,
  scoreCalibrationRun,
  type CalibrationPlan,
  type PopulationUnit,
  type SampleCell,
  type SampleItem,
} from './calibration.js';
import { buildItemEvidence, type ItemEvidence } from './calibration-evidence.js';
import { GOLD_PASS_SHARE, insertGoldRows, parseGoldSet, renderGoldSheet, scoreGold, splitGoldRows, type GoldResult } from './calibration-gold.js';
import { correctiveCorpusRepo, summarizeCorrective } from './corrective.js';
import { prefetchIssueMeta } from './corrective-szz.js';
import { enumerateCorpusRepo, type CorpusPrRecord, type GraphqlRunner } from './enumerate.js';
import { labelCorpusRepo, prefetchCrossReferences, prefetchedGithubClient } from './label.js';
import { parseCohortManifest, runnableRepos, type CohortRepo } from './manifest.js';
import { CORPUS_REPORT_VERSION, conventionSpread, renderCorpusReportMarkdown, sanityFlags, summarizeCorpusRepo, type ConventionFinding, type FlagNote, type RepoSummary } from './report.js';

interface ReportNotes {
  notes: FlagNote[];
  convention_findings: ConventionFinding[];
}

export interface CorpusCliIO {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  cwd: string;
  /** Blocking sleep for backoff; injectable for tests. */
  sleep?: (ms: number) => void;
}

const OPTIONS = {
  manifest: { type: 'string' },
  'cache-dir': { type: 'string' },
  repo: { type: 'string' },
  'as-of': { type: 'string' },
  out: { type: 'string' },
  notes: { type: 'string' },
  plan: { type: 'string' },
  'exclude-slice': { type: 'string' },
  seed: { type: 'string' },
  sample: { type: 'string' },
  gold: { type: 'string' },
  sheet: { type: 'string' },
} as const;

export const CORPUS_COMMANDS = [
  'corpus-enumerate',
  'corpus-label',
  'corpus-corrective',
  'corpus-report',
  'corpus-calibration-sample',
  'corpus-calibration-evidence',
  'corpus-calibration-score',
  'corpus-calibration-gold',
  'corpus-calibration-screen',
] as const;

const RETRYABLE = /HTTP 50[234]|secondary rate limit|abuse|timed? ?out|ETIMEDOUT|ECONNRESET|was submitted too quickly|Something went wrong while executing your query|connection reset by peer|unexpected EOF|error connecting to|could not resolve host|unexpected end of JSON input/i;
const RATE_LIMITED = /rate limit (?:already )?exceeded|RATE_LIMITED/i;

/** Seconds until the GraphQL and REST core windows both reset (GitHub's own clock); 60 when unknown. */
function secondsUntilReset(): number {
  const result = execArgvCommand('gh', ['api', 'rate_limit', '--jq', '[.resources.graphql, .resources.core] | map(select(.remaining < 50) | .reset) | max // 0'], { encoding: 'utf8' });
  const reset = Number(result.stdout.trim());
  if (result.exitCode !== 0 || !Number.isFinite(reset) || reset === 0) return 60;
  return Math.max(30, reset - Math.floor(Date.now() / 1000) + 5);
}

const blockingSleep = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** `gh api graphql` with backoff: 5xx and secondary limits retry, primary limits wait for the window. */
export function createGhGraphql(sleep: (ms: number) => void, log: (line: string) => void): GraphqlRunner {
  return (query, variables) => {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (value === null) continue;
      args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
    }
    for (let attempt = 0; ; attempt++) {
      const result = execArgvCommand('gh', args, { encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      // gh exits 1 on any GraphQL error but still prints the partial response.
      // NOT_FOUND is per-alias (deleted PRs named by merge-bot trailers): keep the rest as null.
      const parsed = parseGraphqlResponse(result.stdout);
      if (parsed?.data && (parsed.errors ?? []).every((error) => error.type === 'NOT_FOUND')) return parsed.data;
      if (result.exitCode === 0 && parsed?.errors?.length) throw new Error(`GitHub GraphQL error: ${parsed.errors[0]!.message}`);
      const stderr = result.stderr || result.stdout;
      if (RATE_LIMITED.test(stderr) && attempt < 48) {
        const wait = secondsUntilReset();
        log(`warn: GitHub rate limit reached; waiting ${wait}s for the window to reset`);
        sleep(wait * 1000);
        continue;
      }
      if (RETRYABLE.test(stderr) && attempt < 6) {
        const wait = 2000 * 2 ** attempt;
        log(`warn: GitHub ${stderr.split('\n')[0]?.slice(0, 80)}; retrying in ${wait / 1000}s`);
        sleep(wait);
        continue;
      }
      throw new Error(`GitHub request failed: ${stderr.split('\n')[0]?.slice(0, 200)}`);
    }
  };
}

function parseGraphqlResponse(stdout: string): { data?: unknown; errors?: { type?: string; message: string }[] } | null {
  try {
    return JSON.parse(stdout) as { data?: unknown; errors?: { type?: string; message: string }[] };
  } catch {
    return null;
  }
}

/**
 * REST `commits/{sha}/pulls`: PRs GitHub ties to a commit, merged or not.
 * Merge bots close PRs instead of merging them (pytorch), so a merged-only
 * filter would undercount misses. Same backoff as GraphQL.
 */
function createGhPullsForCommit(repo: string, sleep: (ms: number) => void, log: (line: string) => void) {
  return (sha: string): number[] => {
    for (let attempt = 0; ; attempt++) {
      const result = execArgvCommand('gh', ['api', `repos/${repo}/commits/${sha}/pulls`, '--jq', '[.[] | .number]'], { encoding: 'utf8' });
      if (result.exitCode === 0) return JSON.parse(result.stdout || '[]') as number[];
      if (RATE_LIMITED.test(result.stderr) && attempt < 48) {
        const wait = secondsUntilReset();
        log(`warn: GitHub rate limit reached; waiting ${wait}s for the window to reset`);
        sleep(wait * 1000);
        continue;
      }
      if (RETRYABLE.test(result.stderr) && attempt < 6) {
        log(`warn: GitHub ${result.stderr.split('\n')[0]?.slice(0, 80)}; retrying`);
        sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`GitHub request failed: ${result.stderr.split('\n')[0]?.slice(0, 200)}`);
    }
  };
}

/** Uncompressed bytes per gzip member; standard readers (zcat, Node, Python) read concatenated members as one stream. */
const GZIP_MEMBER_BYTES = 32 * 1024 * 1024;

/**
 * JSONL one row at a time: a corpus repo's rows can exceed V8's maximum
 * string length (next.js). With `gzip`, rows are compressed in fixed-size
 * members so the writer stays synchronous and memory-bounded.
 */
export function writeJsonl(path: string, rows: readonly unknown[], options: { gzip?: boolean; memberBytes?: number } = {}): { bytes: number; writtenBytes: number; largestRowBytes: number } {
  const fd = openSync(path, 'w');
  let bytes = 0;
  let writtenBytes = 0;
  let largestRowBytes = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  const flush = () => {
    if (pendingBytes === 0) return;
    const chunk = gzipSync(Buffer.concat(pending));
    writeSync(fd, chunk);
    writtenBytes += chunk.length;
    pending = [];
    pendingBytes = 0;
  };
  try {
    for (const row of rows) {
      const line = Buffer.from(`${JSON.stringify(row)}\n`);
      bytes += line.length;
      largestRowBytes = Math.max(largestRowBytes, line.length);
      if (!options.gzip) {
        writeSync(fd, line);
        writtenBytes += line.length;
        continue;
      }
      pending.push(line);
      pendingBytes += line.length;
      if (pendingBytes >= (options.memberBytes ?? GZIP_MEMBER_BYTES)) flush();
    }
    flush();
  } finally {
    closeSync(fd);
  }
  return { bytes, writtenBytes, largestRowBytes };
}

function fileCache(dir: string) {
  mkdirSync(dir, { recursive: true });
  const path = (key: string) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  return {
    get: (key: string) => (existsSync(path(key)) ? (JSON.parse(readFileSync(path(key), 'utf8')) as unknown) : undefined),
    set: (key: string, value: unknown) => writeFileSync(path(key), JSON.stringify(value)),
  };
}

/** Bare blobless clone, refreshed to the remote default branch; returns a git runner bound to it. */
function syncClone(repo: string, dir: string, defaultBranch: string): GitRunner {
  const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BUFFER });
  const url = `https://github.com/${repo}.git`;
  // Large clones fail transiently (index-pack, resets); retry from scratch a few times.
  for (let attempt = 1; !existsSync(join(dir, 'HEAD')); attempt++) {
    const cloned = execArgvCommand('git', ['clone', '--bare', '--filter=blob:none', '--no-tags', url, dir], { encoding: 'utf8' });
    if (cloned.exitCode === 0) break;
    rmSync(dir, { recursive: true, force: true });
    if (attempt >= 3) throw new Error(`git clone failed: ${cloned.stderr.trim().split('\n').pop()}`);
  }
  const fetched = runGit(['fetch', '--no-tags', '--filter=blob:none', 'origin', `+refs/heads/${defaultBranch}:refs/heads/${defaultBranch}`]);
  if (fetched.exitCode !== 0) throw new Error(`git fetch failed: ${fetched.stderr.trim().split('\n').pop()}`);
  return runGit;
}

export function runCorpusCli(command: string, argv: readonly string[], io: CorpusCliIO): { exitCode: number } {
  if (!(CORPUS_COMMANDS as readonly string[]).includes(command)) {
    io.writeStderr(`error: unknown corpus command ${command}; expected one of ${CORPUS_COMMANDS.join(', ')}\n`);
    return { exitCode: 2 };
  }
  type Values = { manifest?: string; 'cache-dir'?: string; repo?: string; 'as-of'?: string; out?: string; notes?: string; plan?: string; 'exclude-slice'?: string; seed?: string; sample?: string; gold?: string; sheet?: string };
  let values: Values;
  let entries: CohortRepo[];
  let manifestBytes: Buffer;
  let window: { from: Date; until: Date };
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  if (command === 'corpus-calibration-score') {
    if (!values.sample) {
      io.writeStderr('error: corpus-calibration-score needs --sample <dir>\n');
      return { exitCode: 2 };
    }
    return runCalibrationScore(resolve(io.cwd, values.sample), io);
  }
  if (command === 'corpus-calibration-gold') {
    if (!values.sample || !values.gold) {
      io.writeStderr('error: corpus-calibration-gold needs --sample <dir> and --gold <gold.json>\n');
      return { exitCode: 2 };
    }
    return runCalibrationGold(resolve(io.cwd, values.sample), resolve(io.cwd, values.gold), io);
  }
  if (command === 'corpus-calibration-screen') {
    if (!values.gold || !!values.out === !!values.sheet) {
      io.writeStderr('error: corpus-calibration-screen needs --gold <gold.json> and either --out <blank sheet> or --sheet <filled sheet>\n');
      return { exitCode: 2 };
    }
    return runCalibrationScreen(resolve(io.cwd, values.gold), values.out ? resolve(io.cwd, values.out) : undefined, values.sheet ? resolve(io.cwd, values.sheet) : undefined, io);
  }
  try {
    if (!values.manifest || !values['cache-dir']) throw new Error('--manifest and --cache-dir are required');
    manifestBytes = readFileSync(resolve(io.cwd, values.manifest));
    const manifest = parseCohortManifest(JSON.parse(manifestBytes.toString('utf8')));
    entries = runnableRepos(manifest, values.repo);
    window = { from: new Date(`${manifest.window.merged_from}T00:00:00Z`), until: new Date(`${manifest.window.merged_until}T00:00:00Z`) };
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }

  const log = (line: string) => io.writeStderr(`${line}\n`);
  if (command === 'corpus-calibration-sample') {
    if (!values.plan || !values['exclude-slice'] || !values.out) {
      io.writeStderr('error: corpus-calibration-sample needs --plan <json>, --exclude-slice <slice manifest> and --out <private dir>\n');
      return { exitCode: 2 };
    }
    if (values.seed !== undefined && !/^[0-9a-f]{64}$/.test(values.seed)) {
      io.writeStderr('error: --seed must be 64 lowercase hex characters\n');
      return { exitCode: 2 };
    }
    return runCalibrationSample(entries, manifestBytes, resolve(io.cwd, values['cache-dir']), resolve(io.cwd, values.plan), resolve(io.cwd, values['exclude-slice']), resolve(io.cwd, values.out), values.seed, io, log);
  }
  if (command === 'corpus-calibration-evidence') {
    if (!values.sample) {
      io.writeStderr('error: corpus-calibration-evidence needs --sample <dir>\n');
      return { exitCode: 2 };
    }
    return runCalibrationEvidence(resolve(io.cwd, values['cache-dir']), resolve(io.cwd, values.sample), io, log);
  }
  if (command === 'corpus-report') {
    const asOf = values['as-of'] ? new Date(values['as-of']) : null;
    if (!asOf || !Number.isFinite(asOf.getTime()) || !values.out) {
      io.writeStderr('error: corpus-report needs --as-of <iso> and --out <dir>\n');
      return { exitCode: 2 };
    }
    let notes: ReportNotes = { notes: [], convention_findings: [] };
    try {
      if (values.notes) {
        const parsed = JSON.parse(readFileSync(resolve(io.cwd, values.notes), 'utf8')) as Partial<ReportNotes>;
        notes = { notes: parsed.notes ?? [], convention_findings: parsed.convention_findings ?? [] };
      }
    } catch (error) {
      io.writeStderr(`error: --notes: ${(error as Error).message}\n`);
      return { exitCode: 2 };
    }
    return runReport(entries, resolve(io.cwd, values['cache-dir']), asOf, manifestBytes, notes, resolve(io.cwd, values.out), io, log);
  }
  const graphql = createGhGraphql(io.sleep ?? blockingSleep, log);
  const cacheRoot = resolve(io.cwd, values['cache-dir']);
  if (command === 'corpus-label' || command === 'corpus-corrective') {
    const asOf = values['as-of'] ? new Date(values['as-of']) : new Date();
    if (!Number.isFinite(asOf.getTime())) {
      io.writeStderr('error: --as-of must be an ISO-8601 timestamp\n');
      return { exitCode: 2 };
    }
    if (command === 'corpus-corrective') return runCorrective(entries, cacheRoot, window, asOf, graphql, io, log);
    return runLabel(entries, cacheRoot, asOf, graphql, io, log);
  }
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split('/') as [string, string];
    const repoDir = join(cacheRoot, `${owner}__${name}`);
    try {
      mkdirSync(repoDir, { recursive: true });
      const meta = graphql('query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ defaultBranchRef{ name } } }', { owner, name }) as {
        repository: { defaultBranchRef: { name: string } | null };
      };
      const branch = meta.repository.defaultBranchRef?.name;
      if (!branch) throw new Error('repository has no default branch');
      log(`info: ${entry.repo}: syncing clone of ${branch}`);
      const runGit = syncClone(entry.repo, join(repoDir, 'repo.git'), branch);
      const { records, stats } = enumerateCorpusRepo(
        { repo: entry.repo, branch, defaultBranchNames: [branch, ...(entry.default_branch_aliases ?? [])], ...window },
        { runGit, graphql, cache: fileCache(join(repoDir, 'graphql')), onDiagnostic: log, pullsForCommit: createGhPullsForCommit(entry.repo, io.sleep ?? blockingSleep, log) },
      );
      writeJsonl(join(repoDir, 'prs.jsonl'), records);
      writeFileSync(join(repoDir, 'enumeration.json'), `${JSON.stringify(stats, null, 2)}\n`);
      io.writeStdout(`${JSON.stringify(stats)}\n`);
      log(`info: ${entry.repo}: ${stats.prs} PRs, mapped_share ${stats.mapped_share}, pr_recall_est ${stats.pr_recall_est}, direct_push_share_est ${stats.direct_push_share_est}`);
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, error: (error as Error).message })}\n`);
      log(`error: ${entry.repo}: ${(error as Error).message}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}

function runLabel(
  entries: CohortRepo[],
  cacheRoot: string,
  asOf: Date,
  graphql: GraphqlRunner,
  io: CorpusCliIO,
  log: (line: string) => void,
): { exitCode: number } {
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split('/') as [string, string];
    const repoDir = join(cacheRoot, `${owner}__${name}`);
    const started = Date.now();
    try {
      const statsPath = join(repoDir, 'enumeration.json');
      if (!existsSync(statsPath)) throw new Error('not enumerated yet; run corpus-enumerate first');
      const { branch } = JSON.parse(readFileSync(statsPath, 'utf8')) as { branch: string };
      const records = readFileSync(join(repoDir, 'prs.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CorpusPrRecord);
      const gitDir = join(repoDir, 'repo.git');
      const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', gitDir, ...args], { encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      log(`info: ${entry.repo}: backfilling blobs`);
      const backfill = runGit(['backfill']);
      if (backfill.exitCode !== 0) throw new Error(`git backfill failed: ${backfill.stderr.trim().split('\n').pop()}`);
      log(`info: ${entry.repo}: prefetching cross-references for ${records.length} PRs`);
      const crossReferences = prefetchCrossReferences(entry.repo, records.map((r) => r.pr_number), graphql, fileCache(join(repoDir, 'graphql')));
      log(`info: ${entry.repo}: labelling`);
      const { rows, failed } = labelCorpusRepo(
        { owner, repo: name, branch, repoDir: gitDir, records, horizons: HORIZONS },
        { runGit, github: prefetchedGithubClient(crossReferences), now: () => asOf, onDiagnostic: log },
      );
      const written = writeJsonl(join(repoDir, 's2.jsonl.gz'), rows, { gzip: true });
      const summary = {
        repo: entry.repo,
        as_of: asOf.toISOString(),
        prs: records.length,
        rows: rows.length,
        failed_prs: failed.length,
        failed_sample: failed.slice(0, 20),
        s2_bytes: written.bytes,
        s2_gzip_bytes: written.writtenBytes,
        largest_row_bytes: written.largestRowBytes,
        wall_clock_seconds: Math.round((Date.now() - started) / 1000),
        base_rates: summarizeLabels(entry.repo, rows),
      };
      writeFileSync(join(repoDir, 's2.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      io.writeStdout(`${JSON.stringify(summary)}\n`);
      if (failed.length) failures++;
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, error: (error as Error).message })}\n`);
      log(`error: ${entry.repo}: ${(error as Error).message}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Rows of a gzip JSONL file written by {@link writeJsonl}, one gzip member at
 * a time. Large repos' S2 files decompress past V8's string and buffer
 * limits, so the file is never inflated whole. Members carry no optional
 * header fields (gzipSync), so each is a 10-byte header, a raw deflate
 * stream and an 8-byte trailer.
 */
export function* readGzipJsonlMembers<T>(path: string): Generator<T> {
  const raw = readFileSync(path);
  for (let offset = 0; offset < raw.length; ) {
    if (raw[offset] !== 0x1f || raw[offset + 1] !== 0x8b || raw[offset + 3] !== 0) throw new Error(`${path}: unexpected gzip member header at byte ${offset}`);
    const { buffer, engine } = inflateRawSync(raw.subarray(offset + 10), { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    offset += 10 + engine.bytesWritten + 8;
    for (const line of buffer.toString('utf8').split('\n')) if (line) yield JSON.parse(line) as T;
  }
}

function runCorrective(
  entries: CohortRepo[],
  cacheRoot: string,
  window: { from: Date; until: Date },
  asOf: Date,
  graphql: GraphqlRunner,
  io: CorpusCliIO,
  log: (line: string) => void,
): { exitCode: number } {
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split('/') as [string, string];
    const repoDir = join(cacheRoot, `${owner}__${name}`);
    const started = Date.now();
    try {
      const s2Path = join(repoDir, 's2.jsonl.gz');
      if (!existsSync(s2Path)) throw new Error('not labelled yet; run corpus-label first');
      const { branch } = JSON.parse(readFileSync(join(repoDir, 'enumeration.json'), 'utf8')) as { branch: string };
      const originals = readJsonl<CorpusPrRecord>(join(repoDir, 'prs.jsonl'));
      const gitDir = join(repoDir, 'repo.git');
      const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', gitDir, ...args], { encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      const cache = fileCache(join(repoDir, 'graphql'));
      // Fixes for late originals land after the window closes; enumerate them up to as-of.
      const laterPath = join(repoDir, 'fix-prs.jsonl');
      let laterPrs: CorpusPrRecord[] = [];
      if (existsSync(laterPath)) laterPrs = readJsonl<CorpusPrRecord>(laterPath);
      else if (window.until < asOf) {
        log(`info: ${entry.repo}: enumerating fix sources ${window.until.toISOString()}..${asOf.toISOString()}`);
        ({ records: laterPrs } = enumerateCorpusRepo(
          { repo: entry.repo, branch, defaultBranchNames: [branch, ...(entry.default_branch_aliases ?? [])], from: window.until, until: asOf },
          { runGit, graphql, cache, onDiagnostic: log },
        ));
        writeJsonl(laterPath, laterPrs);
      }
      log(`info: ${entry.repo}: loading cross-references and S2 rows`);
      const crossReferences = prefetchCrossReferences(entry.repo, originals.map((r) => r.pr_number), graphql, cache);
      const closing = [...originals, ...laterPrs].flatMap((pr) => pr.closing_issues);
      log(`info: ${entry.repo}: fetching labels for ${new Set(closing).size} closed issues`);
      const issues = prefetchIssueMeta(entry.repo, closing, graphql, cache);
      const s2Rows = readGzipJsonlMembers<ArbiterSurvivalLabelV1>(s2Path);
      const result = correctiveCorpusRepo(
        { repo: entry.repo, branch, originals, laterPrs, from: window.from, asOf, crossReferences, issues, szz: true, s2Rows },
        { runGit, now: () => new Date(), onDiagnostic: log },
      );
      writeJsonl(join(repoDir, 'candidates.jsonl.gz'), result.candidates, { gzip: true });
      writeJsonl(join(repoDir, 'repair_pairs.jsonl.gz'), result.repairPairs, { gzip: true });
      writeJsonl(join(repoDir, 'corrective.jsonl.gz'), result.corrective, { gzip: true });
      const summary = {
        repo: entry.repo,
        as_of: asOf.toISOString(),
        later_prs: laterPrs.length,
        ...summarizeCorrective(result, originals.length),
        wall_clock_seconds: Math.round((Date.now() - started) / 1000),
      };
      writeFileSync(join(repoDir, 'corrective.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      io.writeStdout(`${JSON.stringify(summary)}\n`);
      if (result.failedPairs.length || result.szz.failed) failures++;
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, error: (error as Error).message })}\n`);
      log(`error: ${entry.repo}: ${(error as Error).message}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}

const REPORT_INPUTS = ['s2.jsonl.gz', 'candidates.jsonl.gz', 'repair_pairs.jsonl.gz', 'corrective.jsonl.gz'] as const;

function runReport(
  entries: CohortRepo[],
  cacheRoot: string,
  asOf: Date,
  manifestBytes: Buffer,
  notes: ReportNotes,
  outDir: string,
  io: CorpusCliIO,
  log: (line: string) => void,
): { exitCode: number } {
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const repos: RepoSummary[] = [];
  const inputs: { repo: string; file: string; sha256: string; bytes: number; rows: number }[] = [];
  const versions = { s2: new Set<string>(), corrective: new Set<string>() };
  const day = asOf.toISOString().slice(0, 10);
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split('/') as [string, string];
    const repoDir = join(cacheRoot, `${owner}__${name}`);
    try {
      for (const file of REPORT_INPUTS) if (!existsSync(join(repoDir, file))) throw new Error(`missing ${file}; run corpus-label and corpus-corrective first`);
      const counted = <T>(file: string, onRow: (row: T) => void): Iterable<T> => {
        const path = join(repoDir, file);
        const bytes = readFileSync(path);
        const record = { repo: entry.repo, file, sha256: sha256(bytes), bytes: bytes.length, rows: 0 };
        inputs.push(record);
        return (function* () {
          for (const row of readGzipJsonlMembers<T>(path)) {
            record.rows++;
            onRow(row);
            yield row;
          }
        })();
      };
      const checkAsOf = (value: string, file: string) => {
        if (value.slice(0, 10) !== day) throw new Error(`${file} is labelled as of ${value}, not ${day}`);
      };
      const s2Rows = counted<ArbiterSurvivalLabelV1>('s2.jsonl.gz', (r) => versions.s2.add(`schema ${r.schema_version}, labeller ${r.envelope.labeller_version}`));
      const candidates = counted<CorrectiveCandidateV1>('candidates.jsonl.gz', (r) => checkAsOf(r.envelope.as_of, 'candidates.jsonl.gz'));
      const correctiveRows = counted<CorrectiveReworkLabelV1>('corrective.jsonl.gz', (r) => {
        checkAsOf(r.envelope.as_of, 'corrective.jsonl.gz');
        versions.corrective.add(`schema ${r.schema_version}, definition ${r.envelope.definition_version}, labeller ${r.envelope.labeller_version}`);
      });
      // Repair pairs are hashed and counted for the manifest; the report reads their candidates.
      const pairs = counted<unknown>('repair_pairs.jsonl.gz', () => {})[Symbol.iterator]();
      while (!pairs.next().done);
      const summary = summarizeCorpusRepo({ repo: entry.repo, tier: entry.tier ?? null, mergeConvention: entry.observed_merge_convention ?? null, s2Rows, candidates, correctiveRows });
      repos.push(summary);
      log(`info: ${entry.repo}: summarized`);
    } catch (error) {
      failures++;
      log(`error: ${entry.repo}: ${(error as Error).message}`);
    }
  }
  if (failures) return { exitCode: 3 };

  const flags = sanityFlags(repos, notes.notes);
  const findings = notes.convention_findings;
  const spread = conventionSpread(repos);
  const manifest = {
    report_version: CORPUS_REPORT_VERSION,
    as_of: asOf.toISOString(),
    cohort_manifest_sha256: sha256(manifestBytes),
    label_versions: { s2: [...versions.s2].sort(), corrective: [...versions.corrective].sort() },
    inputs,
  };
  // The run ID names the inputs, not the moment the report ran: the same files give the same ID.
  const run_id = sha256(Buffer.from(JSON.stringify(manifest))).slice(0, 16);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'run-manifest.json'), `${JSON.stringify({ run_id, ...manifest, flags: flags.map(({ code, repos: r, merge_convention, resolution }) => ({ code, repos: r, merge_convention, resolution })), convention_findings: findings }, null, 2)}\n`);
  writeFileSync(join(outDir, 'corpus-report.json'), `${JSON.stringify({ run_id, as_of: manifest.as_of, report_version: CORPUS_REPORT_VERSION, repos, flags, convention_spread: spread, convention_findings: findings }, null, 2)}\n`);
  writeFileSync(join(outDir, 'corpus-report.md'), renderCorpusReportMarkdown({ run_id, as_of: day, repos, flags, spread, conventionFindings: findings }));
  const unresolved = flags.filter((f) => !f.resolution).length;
  io.writeStdout(`${JSON.stringify({ run_id, repos: repos.length, flags: flags.length, unresolved })}\n`);
  return { exitCode: unresolved ? 1 : 0 };
}

/** True when `path`, or any directory above it, holds a `.git` entry. */
function insideGitWorkTree(path: string): boolean {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

interface SampleFile {
  procedure: 'hok-3269-calibration-sample';
  sampler_version: string;
  plan: CalibrationPlan;
  plan_sha256: string;
  cohort_manifest_sha256: string;
  /** SHA-256 of the evaluation-slice manifest whose repos were excluded; equals the HOK-3028 holdout hash. */
  excluded_slice_sha256: string;
  seed: string;
  inputs: { repo: string; file: string; sha256: string }[];
  cells: SampleCell[];
  items: SampleItem[];
  drawn_at: string;
}

function runCalibrationSample(
  entries: CohortRepo[],
  manifestBytes: Buffer,
  cacheRoot: string,
  planPath: string,
  slicePath: string,
  outDir: string,
  seedArg: string | undefined,
  io: CorpusCliIO,
  log: (line: string) => void,
): { exitCode: number } {
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  let plan: CalibrationPlan;
  let planBytes: Buffer;
  let sliceBytes: Buffer;
  let sliceRepos: Set<string>;
  try {
    planBytes = readFileSync(planPath);
    plan = parseCalibrationPlan(JSON.parse(planBytes.toString('utf8')));
    sliceBytes = readFileSync(slicePath);
    const slice = JSON.parse(sliceBytes.toString('utf8')) as { repos?: unknown };
    if (!Array.isArray(slice.repos) || !slice.repos.length || !slice.repos.every((r) => typeof r === 'string')) throw new Error('--exclude-slice has no repos list');
    sliceRepos = new Set(slice.repos);
    if (insideGitWorkTree(outDir)) throw new Error('--out must be outside any git work tree; the sample and its labels stay private');
    if (existsSync(outDir) && readdirSync(outDir).length) throw new Error(`${outDir} is not empty; refusing to overwrite a drawn sample`);
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  const development = entries.filter((e) => !sliceRepos.has(e.repo));
  const seed = seedArg ?? randomBytes(32).toString('hex');
  const units: PopulationUnit[] = [];
  const inputs: SampleFile['inputs'] = [];
  let failures = 0;
  for (const entry of development) {
    const [owner, name] = entry.repo.split('/') as [string, string];
    const repoDir = join(cacheRoot, `${owner}__${name}`);
    try {
      const files = ['candidates.jsonl.gz', 'corrective.jsonl.gz'] as const;
      for (const file of files) {
        const path = join(repoDir, file);
        if (!existsSync(path)) throw new Error(`missing ${file}; run corpus-corrective first`);
        inputs.push({ repo: entry.repo, file, sha256: sha256(readFileSync(path)) });
      }
      units.push(
        ...classifyCalibrationRepo({
          repo: entry.repo,
          horizonDays: plan.horizon_days,
          szzStrongMinLines: plan.szz_strong_min_lines,
          candidates: readGzipJsonlMembers<CorrectiveCandidateV1>(join(repoDir, files[0])),
          correctiveRows: readGzipJsonlMembers<CorrectiveReworkLabelV1>(join(repoDir, files[1])),
        }),
      );
    } catch (error) {
      failures++;
      log(`error: ${entry.repo}: ${(error as Error).message}`);
    }
  }
  if (failures) return { exitCode: 3 };
  const sample = drawCalibrationSample(units, plan, seed);
  const repos = new Set(sample.items.map((i) => i.repo)).size;
  if (repos < plan.min_repos) {
    io.writeStderr(`error: the sample spans ${repos} repos; the plan needs at least ${plan.min_repos}\n`);
    return { exitCode: 3 };
  }
  const file: SampleFile = {
    procedure: 'hok-3269-calibration-sample',
    sampler_version: CALIBRATION_SAMPLER_VERSION,
    plan,
    plan_sha256: sha256(planBytes),
    cohort_manifest_sha256: sha256(manifestBytes),
    excluded_slice_sha256: sha256(sliceBytes),
    seed,
    inputs,
    cells: sample.cells,
    items: sample.items,
    drawn_at: new Date().toISOString(),
  };
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'sample.json'), bytes, { mode: 0o600, flag: 'wx' });
  // Aggregates only: per-repo counts would name the development repos, and so narrow down the slice.
  const strata = Object.fromEntries(CALIBRATION_STRATA.map((s) => [s, sample.items.filter((i) => i.stratum === s).length]));
  io.writeStdout(
    `${JSON.stringify({ sample_sha256: sha256(bytes), items: sample.items.length, double: sample.items.filter((i) => i.double).length, audit: sample.items.filter((i) => i.audit).length, repos, strata, shortfalls: sample.shortfalls })}\n`,
  );
  return { exitCode: 0 };
}

function runCalibrationScore(sampleDir: string, io: CorpusCliIO): { exitCode: number } {
  let sample: SampleFile;
  let sheets: { a: string; b: string; h: string };
  try {
    sample = JSON.parse(readFileSync(join(sampleDir, 'sample.json'), 'utf8')) as SampleFile;
    if (sample.procedure !== 'hok-3269-calibration-sample') throw new Error(`${sampleDir}/sample.json is not a calibration sample`);
    sheets = {
      a: readFileSync(join(sampleDir, 'sheet-a.csv'), 'utf8'),
      b: readFileSync(join(sampleDir, 'sheet-b.csv'), 'utf8'),
      h: readFileSync(join(sampleDir, 'sheet-h.csv'), 'utf8'),
    };
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  // Hidden known-answer rows (corpus-calibration-gold) only decide whether the audit is accepted.
  let auditCheck: GoldResult | undefined;
  const goldPath = join(sampleDir, 'gold.json');
  if (existsSync(goldPath)) {
    try {
      const hidden = parseGoldSet(JSON.parse(readFileSync(goldPath, 'utf8'))).items.filter((g) => g.use === 'hidden');
      const split = splitGoldRows(sheets.h, new Set(hidden.map((g) => g.item_id)));
      auditCheck = scoreGold(split.gold, hidden, GOLD_PASS_SHARE.hidden);
      sheets.h = split.rest;
    } catch (error) {
      io.writeStderr(`error: gold.json: ${(error as Error).message}\n`);
      return { exitCode: 2 };
    }
  }
  const subset = (keep: (i: SampleItem) => boolean) => new Map(sample.items.filter(keep).map((i) => [i.item_id, i]));
  const a = parseLabelSheet(sheets.a, subset(() => true));
  const b = parseLabelSheet(sheets.b, subset((i) => i.double));
  const h = parseLabelSheet(sheets.h, subset((i) => i.audit));
  const errors = [...a.errors.map((e) => `sheet-a: ${e}`), ...b.errors.map((e) => `sheet-b: ${e}`), ...h.errors.map((e) => `sheet-h: ${e}`)];
  if (errors.length) {
    io.writeStderr(`${errors.map((e) => `error: ${e}`).join('\n')}\n`);
    return { exitCode: 2 };
  }
  const run = scoreCalibrationRun({ plan: sample.plan, items: sample.items, cells: sample.cells, sheets: { a: a.labels, b: b.labels, h: h.labels }, seed: sample.seed });
  writeFileSync(join(sampleDir, 'calibration-results.json'), `${JSON.stringify({ sample_plan_sha256: sample.plan_sha256, ...run, ...(auditCheck && { audit_check: auditCheck }) }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(sampleDir, 'calibration-table.md'), renderCalibrationMarkdown(run, auditCheck), { mode: 0o600 });
  io.writeStdout(
    `${JSON.stringify({ items: run.model.items, model_unlabelled: run.model.unlabelled, audit_unlabelled: run.human.unlabelled, models_stand_in: run.models_stand_in, chosen_definition: run.chosen_definition, ...(auditCheck && { audit_check: { correct: auditCheck.correct, items: auditCheck.items, passed: auditCheck.passed } }), table: join(sampleDir, 'calibration-table.md') })}\n`,
  );
  return { exitCode: 0 };
}

function runCalibrationGold(sampleDir: string, goldPath: string, io: CorpusCliIO): { exitCode: number } {
  try {
    const sample = JSON.parse(readFileSync(join(sampleDir, 'sample.json'), 'utf8')) as SampleFile;
    if (sample.procedure !== 'hok-3269-calibration-sample') throw new Error(`${sampleDir}/sample.json is not a calibration sample`);
    const goldBytes = readFileSync(goldPath);
    const hidden = parseGoldSet(JSON.parse(goldBytes.toString('utf8'))).items.filter((g) => g.use === 'hidden');
    if (!hidden.length) throw new Error('the gold set has no hidden items');
    const sampleIds = new Set(sample.items.map((i) => i.item_id));
    const clash = hidden.find((g) => sampleIds.has(g.item_id));
    if (clash) throw new Error(`${clash.item_id}: collides with a sample item ID`);
    const sheetPath = join(sampleDir, 'sheet-h.csv');
    const sheet = insertGoldRows(readFileSync(sheetPath, 'utf8'), hidden, sample.seed);
    // wx: a second run fails here, before the sheet is touched.
    writeFileSync(join(sampleDir, 'gold.json'), goldBytes, { mode: 0o600, flag: 'wx' });
    writeFileSync(sheetPath, sheet, { mode: 0o600 });
    io.writeStdout(`${JSON.stringify({ hidden: hidden.length, sheet_rows: parseCsv(sheet).length - 1, gold_sha256: createHash('sha256').update(goldBytes).digest('hex') })}\n`);
    return { exitCode: 0 };
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
}

/** Writes the blank screening sheet (`out`), or grades a candidate's filled one (`sheet`). */
function runCalibrationScreen(goldPath: string, out: string | undefined, sheetPath: string | undefined, io: CorpusCliIO): { exitCode: number } {
  try {
    const screening = parseGoldSet(JSON.parse(readFileSync(goldPath, 'utf8'))).items.filter((g) => g.use === 'screening');
    if (!screening.length) throw new Error('the gold set has no screening items');
    if (out) {
      writeFileSync(out, renderGoldSheet(screening), { flag: 'wx' });
      io.writeStdout(`${JSON.stringify({ screening: screening.length, sheet: out })}\n`);
    } else {
      io.writeStdout(`${JSON.stringify(scoreGold(readFileSync(sheetPath!, 'utf8'), screening, GOLD_PASS_SHARE.screening), null, 2)}\n`);
    }
    return { exitCode: 0 };
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
}

function runCalibrationEvidence(cacheRoot: string, sampleDir: string, io: CorpusCliIO, log: (line: string) => void): { exitCode: number } {
  let sample: SampleFile;
  try {
    sample = JSON.parse(readFileSync(join(sampleDir, 'sample.json'), 'utf8')) as SampleFile;
    if (sample.procedure !== 'hok-3269-calibration-sample') throw new Error(`${sampleDir}/sample.json is not a calibration sample`);
    for (const file of ['evidence.jsonl', 'sheet-h.csv']) if (existsSync(join(sampleDir, file))) throw new Error(`${file} exists; refusing to overwrite`);
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  const evidence: ItemEvidence[] = [];
  let failures = 0;
  for (const repo of [...new Set(sample.items.map((i) => i.repo))].sort()) {
    const repoDir = join(cacheRoot, repo.replace('/', '__'));
    try {
      const { branch } = JSON.parse(readFileSync(join(repoDir, 'enumeration.json'), 'utf8')) as { branch: string };
      const records = [...readJsonl<CorpusPrRecord>(join(repoDir, 'prs.jsonl')), ...(existsSync(join(repoDir, 'fix-prs.jsonl')) ? readJsonl<CorpusPrRecord>(join(repoDir, 'fix-prs.jsonl')) : [])];
      const prs = new Map(records.map((r) => [r.pr_url, r]));
      const bySha = new Map<string, CorpusPrRecord>();
      for (const r of records) for (const sha of [r.merge_sha, r.landed_sha, ...(r.relanded_merge_shas ?? [])]) if (!bySha.has(sha)) bySha.set(sha, r);
      const gitDir = join(repoDir, 'repo.git');
      const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', gitDir, ...args], { encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      for (const item of sample.items.filter((i) => i.repo === repo)) evidence.push(buildItemEvidence(item, { branch, horizonDays: sample.plan.horizon_days, prs, bySha }, runGit));
    } catch (error) {
      failures++;
      // The repo name stays out of the log: it would name a development repo.
      log(`error: evidence failed for one repo: ${(error as Error).message}`);
    }
  }
  if (failures) return { exitCode: 3 };
  const order = new Map(sample.items.map((i, n) => [i.item_id, n]));
  evidence.sort((x, y) => order.get(x.item_id)! - order.get(y.item_id)!);
  writeJsonl(join(sampleDir, 'evidence.jsonl'), evidence);
  chmodSync(join(sampleDir, 'evidence.jsonl'), 0o600);
  const related = new Map(evidence.map((e) => [e.item_id, e.related.map((r) => r.url)]));
  writeFileSync(join(sampleDir, 'sheet-h.csv'), renderLabelSheet(sample.items.filter((i) => i.audit), related), { mode: 0o600, flag: 'wx' });
  const truncated = evidence.reduce((n, e) => n + Number(e.original.diff_truncated) + e.fixes.filter((f) => f.diff_truncated).length, 0);
  io.writeStdout(`${JSON.stringify({ items: evidence.length, audit: sample.items.filter((i) => i.audit).length, diffs_truncated: truncated, with_related: evidence.filter((e) => e.related.length).length })}\n`);
  return { exitCode: 0 };
}
