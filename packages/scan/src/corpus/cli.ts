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
 * stdout: one stats JSON line per repo. Exit 0 when every repo enumerated,
 * 2 on invalid input, 3 when any repo failed upstream (others still finish).
 * No ambient process state is read here; the caller supplies `cwd`, and `gh`
 * supplies GitHub auth.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execArgvCommand } from '../shell-utils.js';
import { GIT_OUTPUT_MAX_BUFFER, type GitRunner } from '../survival-labeller.js';
import { enumerateCorpusRepo, type GraphqlRunner } from './enumerate.js';
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
} as const;

const RETRYABLE = /HTTP 50[234]|secondary rate limit|abuse|timed? ?out|ETIMEDOUT|ECONNRESET|was submitted too quickly/i;
const RATE_LIMITED = /API rate limit exceeded|RATE_LIMITED/i;

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
      if (RATE_LIMITED.test(stderr) && attempt < 90) {
        log('warn: GitHub rate limit reached; waiting 60s');
        sleep(60_000);
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

/** REST `commits/{sha}/pulls`: merged PRs GitHub ties to a commit. Same backoff as GraphQL. */
function createGhPullsForCommit(repo: string, sleep: (ms: number) => void, log: (line: string) => void) {
  return (sha: string): number[] => {
    for (let attempt = 0; ; attempt++) {
      const result = execArgvCommand('gh', ['api', `repos/${repo}/commits/${sha}/pulls`, '--jq', '[.[] | select(.merged_at != null) | .number]'], { encoding: 'utf8' });
      if (result.exitCode === 0) return JSON.parse(result.stdout || '[]') as number[];
      if ((RETRYABLE.test(result.stderr) || RATE_LIMITED.test(result.stderr)) && attempt < 6) {
        log(`warn: GitHub ${result.stderr.split('\n')[0]?.slice(0, 80)}; retrying`);
        sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`GitHub request failed: ${result.stderr.split('\n')[0]?.slice(0, 200)}`);
    }
  };
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
  if (!existsSync(join(dir, 'HEAD'))) {
    const cloned = execArgvCommand('git', ['clone', '--bare', '--filter=blob:none', '--no-tags', url, dir], { encoding: 'utf8' });
    if (cloned.exitCode !== 0) throw new Error(`git clone failed: ${cloned.stderr.trim().split('\n').pop()}`);
  }
  const fetched = runGit(['fetch', '--no-tags', '--filter=blob:none', 'origin', `+refs/heads/${defaultBranch}:refs/heads/${defaultBranch}`]);
  if (fetched.exitCode !== 0) throw new Error(`git fetch failed: ${fetched.stderr.trim().split('\n').pop()}`);
  return runGit;
}

export function runCorpusCli(command: string, argv: readonly string[], io: CorpusCliIO): { exitCode: number } {
  if (command !== 'corpus-enumerate') {
    io.writeStderr(`error: unknown corpus command ${command}; expected corpus-enumerate\n`);
    return { exitCode: 2 };
  }
  let values: { manifest?: string; 'cache-dir'?: string; repo?: string };
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
      writeFileSync(join(repoDir, 'prs.jsonl'), records.map((r) => `${JSON.stringify(r)}\n`).join(''));
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
