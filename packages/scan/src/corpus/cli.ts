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
 *   s2.jsonl          S2 v1.1.0 rows, one per PR × horizon (derived; no raw content)
 *   s2.summary.json   row counts, report_outcome base rates, failures, timing
 *
 * stdout: one stats JSON line per repo. Exit 0 when every repo enumerated,
 * 2 on invalid input, 3 when any repo failed upstream (others still finish).
 * No ambient process state is read here; the caller supplies `cwd`, and `gh`
 * supplies GitHub auth.
 */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execArgvCommand } from '../shell-utils.js';
import { GIT_OUTPUT_MAX_BUFFER, type GitRunner } from '../survival-labeller.js';
import { HORIZONS } from '@hokusai/core';
import { summarizeLabels } from '../survival-labeller.js';
import { enumerateCorpusRepo, type CorpusPrRecord, type GraphqlRunner } from './enumerate.js';
import { labelCorpusRepo, prefetchCrossReferences, prefetchedGithubClient } from './label.js';
import { parseCohortManifest, runnableRepos, type CohortRepo } from './manifest.js';

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
} as const;

export const CORPUS_COMMANDS = ['corpus-enumerate', 'corpus-label'] as const;

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

/** JSONL one row at a time: a corpus repo's rows can exceed V8's maximum string length (next.js). */
function writeJsonl(path: string, rows: readonly unknown[]): { bytes: number; largestRowBytes: number } {
  const fd = openSync(path, 'w');
  let bytes = 0;
  let largestRowBytes = 0;
  try {
    for (const row of rows) {
      const line = `${JSON.stringify(row)}\n`;
      const size = Buffer.byteLength(line);
      bytes += size;
      largestRowBytes = Math.max(largestRowBytes, size);
      writeSync(fd, line);
    }
  } finally {
    closeSync(fd);
  }
  return { bytes, largestRowBytes };
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
    io.writeStderr(`error: unknown corpus command ${command}; expected ${CORPUS_COMMANDS.join(' or ')}\n`);
    return { exitCode: 2 };
  }
  let values: { manifest?: string; 'cache-dir'?: string; repo?: string; 'as-of'?: string };
  let entries: CohortRepo[];
  let window: { from: Date; until: Date };
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }));
    if (!values.manifest || !values['cache-dir']) throw new Error('--manifest and --cache-dir are required');
    const manifest = parseCohortManifest(JSON.parse(readFileSync(resolve(io.cwd, values.manifest), 'utf8')));
    entries = runnableRepos(manifest, values.repo);
    window = { from: new Date(`${manifest.window.merged_from}T00:00:00Z`), until: new Date(`${manifest.window.merged_until}T00:00:00Z`) };
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }

  const log = (line: string) => io.writeStderr(`${line}\n`);
  const graphql = createGhGraphql(io.sleep ?? blockingSleep, log);
  const cacheRoot = resolve(io.cwd, values['cache-dir']);
  if (command === 'corpus-label') {
    const asOf = values['as-of'] ? new Date(values['as-of']) : new Date();
    if (!Number.isFinite(asOf.getTime())) {
      io.writeStderr('error: --as-of must be an ISO-8601 timestamp\n');
      return { exitCode: 2 };
    }
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
      const written = writeJsonl(join(repoDir, 's2.jsonl'), rows);
      const summary = {
        repo: entry.repo,
        as_of: asOf.toISOString(),
        prs: records.length,
        rows: rows.length,
        failed_prs: failed.length,
        failed_sample: failed.slice(0, 20),
        s2_bytes: written.bytes,
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
