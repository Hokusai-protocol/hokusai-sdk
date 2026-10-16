/**
 * Ambient default dependency wiring for the survival labeller: local `git`,
 * `gh` for PR metadata/cross-references, wall clock.
 *
 * This is the ONLY scanner-core module allowed to touch ambient process
 * state (`process.env` for the token pass-through) — the labeller and
 * extractor themselves take every input explicitly, and the boundary test
 * enforces that. Callers that need full determinism (tests, golden parity)
 * inject their own {@link SurvivalLabellerDeps} instead.
 */

import { execArgvCommand } from './shell-utils.js';
import type { ScanGitHubClient, ScanPullRequest, CheckConclusion } from './orchestrate/github.js';
import {
  GIT_OUTPUT_MAX_BUFFER,
  type GitCommandResult,
  type GitRunner,
  type SurvivalGitHubClient,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
} from './survival-labeller.js';

/** Upstream (GitHub) failure surfaced by the CLI as exit code 3. */
export class ScanUpstreamError extends Error {
  override readonly name = 'ScanUpstreamError';
}

/**
 * Classify a failed `gh` invocation into an operator-actionable message.
 * The token value never appears in the message.
 */
export function classifyUpstreamFailure(result: {
  exitCode: number;
  stderr: string;
  failed?: boolean;
}): string {
  const stderr = result.stderr;
  if (result.failed) {
    return 'gh executable not found; install GitHub CLI or run with --offline';
  }
  if (/HTTP 401|authentication|not logged in|GH_TOKEN|GITHUB_TOKEN/i.test(stderr)) {
    return 'GitHub authentication failed';
  }
  if (/rate limit/i.test(stderr)) {
    const reset = stderr.match(/resets? at ([0-9TZ:.+-]+)/i);
    return reset ? `GitHub rate limit exceeded; resets at ${reset[1]}` : 'GitHub rate limit exceeded';
  }
  if (/HTTP 403/i.test(stderr)) {
    return 'GitHub authorization failed (HTTP 403)';
  }
  if (/HTTP 404|could not resolve|no pull requests found|not found/i.test(stderr)) {
    return 'GitHub resource not found';
  }
  if (result.exitCode === -1 || /timed? ?out|ETIMEDOUT/i.test(stderr)) {
    return 'GitHub request timed out';
  }
  return `GitHub request failed (gh exit ${result.exitCode})`;
}

export interface CreateDefaultDepsOptions {
  /**
   * When true, a failed `gh` call throws {@link ScanUpstreamError} instead of
   * degrading to null/[] — the CLI uses this so upstream failures surface as
   * exit code 3 rather than silent missing labels. Default false, preserving
   * the pre-extraction degradation behaviour.
   */
  strictUpstream?: boolean | undefined;
  /** Clock override (e.g. a pinned `--as-of` instant). Default: wall clock. */
  now?: (() => Date) | undefined;
}

/** Default deps: local `git`, `gh` for PR metadata/cross-references, wall clock. */
export function createDefaultDeps(
  target: SurvivalLabellerTarget,
  options: CreateDefaultDepsOptions = {},
): SurvivalLabellerDeps {
  const env = target.token ? { ...process.env, GH_TOKEN: target.token } : process.env;
  const strict = options.strictUpstream === true;
  const runGit: GitRunner = (args) =>
    execArgvCommand('git', ['-C', target.repoDir, ...args], {
      env,
      maxBuffer: GIT_OUTPUT_MAX_BUFFER,
    });
  const runGh = (args: readonly string[]): GitCommandResult & { failed: boolean } =>
    execArgvCommand('gh', [...args], { env, cwd: target.repoDir });
  const github: SurvivalGitHubClient = {
    getPrMetadata(prUrl) {
      const result = runGh([
        'pr', 'view', prUrl,
        '--json', 'number,title,state,mergedAt,mergeCommit,headRefOid',
      ]);
      if (result.exitCode !== 0) {
        if (strict) throw new ScanUpstreamError(classifyUpstreamFailure(result));
        return null;
      }
      try {
        const parsed = JSON.parse(result.stdout) as {
          number?: number;
          title?: string;
          state?: string;
          mergedAt?: string | null;
          mergeCommit?: { oid?: string } | null;
          headRefOid?: string | null;
        };
        if (typeof parsed.number !== 'number') return null;
        return {
          number: parsed.number,
          title: parsed.title ?? '',
          state: parsed.state ?? '',
          mergedAt: parsed.mergedAt ?? null,
          mergeCommitSha: parsed.mergeCommit?.oid ?? null,
          headSha: parsed.headRefOid ?? null,
        };
      } catch {
        return null;
      }
    },
    listCrossReferences(prNumber) {
      const result = runGh([
        'api',
        `repos/${target.owner}/${target.repo}/issues/${prNumber}/timeline?per_page=100`,
        '-H', 'Accept: application/vnd.github+json',
      ]);
      if (result.exitCode !== 0) {
        // Never strict here: labelMergedPr already degrades a failed
        // cross-reference lookup to a diagnostic plus an empty list, and the
        // pre-extraction behaviour returned [] on failure.
        return [];
      }
      try {
        const events = JSON.parse(result.stdout) as Array<{
          event?: string;
          created_at?: string;
          source?: { issue?: { html_url?: string } };
        }>;
        return events
          .filter((event) => event.event === 'cross-referenced' && event.created_at)
          .map((event) => ({
            createdAtEpoch: Math.floor(Date.parse(event.created_at as string) / 1000),
            url: event.source?.issue?.html_url ?? '',
          }))
          .filter((ref) => Number.isFinite(ref.createdAtEpoch));
      } catch {
        return [];
      }
    },
  };
  return { runGit, github, now: options.now ?? (() => new Date()) };
}

/** GitHub client stub for `--offline` runs: no network, ever. */
export function createOfflineGitHubClient(): SurvivalGitHubClient {
  return {
    getPrMetadata: () => null,
    listCrossReferences: () => [],
  };
}


/** GitHub API adapter for report scans. This ambient shell is the only place the token is read. */
export function createDefaultScanGitHubClient(target: { owner: string; repo: string; repoDir: string; token?: string }): ScanGitHubClient {
  const env = target.token ? { ...process.env, GH_TOKEN: target.token } : process.env;
  const api = (path: string): string => {
    const result = execArgvCommand('gh', ['api', path, '-H', 'Accept: application/vnd.github+json'], { env, cwd: target.repoDir, maxBuffer: 16 * 1024 * 1024 });
    if (result.exitCode !== 0) {
      if (/HTTP 404/i.test(result.stderr)) return '';
      throw new ScanUpstreamError(classifyUpstreamFailure(result));
    }
    return result.stdout;
  };
  const parse = <T>(text: string): T | null => { try { return text ? JSON.parse(text) as T : null; } catch { throw new ScanUpstreamError('GitHub returned malformed JSON'); } };
  return {
    async getRepo() {
      await Promise.resolve();
      const repo = parse<{ default_branch?: string; private?: boolean }>(api(`repos/${target.owner}/${target.repo}`));
      if (!repo?.default_branch) throw new ScanUpstreamError('GitHub repository metadata is unavailable');
      return { defaultBranch: repo.default_branch, private: repo.private === true };
    },
    async getPullRequest(number: number): Promise<ScanPullRequest | null> {
      await Promise.resolve();
      const raw = parse<{ number?: number; title?: string; body?: string | null; user?: { login?: string; type?: string } | null; head?: { ref?: string; sha?: string }; labels?: { name?: string }[]; merged_at?: string | null }>(api(`repos/${target.owner}/${target.repo}/pulls/${number}`));
      if (!raw) return null;
      if (!raw.number || !raw.head?.ref || !raw.head.sha || !raw.merged_at) return null;
      return { number: raw.number, title: raw.title ?? '', body: raw.body ?? null, authorLogin: raw.user?.login ?? null, authorType: raw.user?.type ?? null, headRef: raw.head.ref, headSha: raw.head.sha, labels: (raw.labels ?? []).flatMap((label) => label.name ? [label.name] : []), mergedAt: raw.merged_at };
    },
    async listPullCommits(number: number): Promise<string[]> {
      await Promise.resolve();
      const messages: string[] = [];
      for (let page = 1; page <= 100; page++) {
        const commits = parse<{ commit?: { message?: string } }[]>(api(`repos/${target.owner}/${target.repo}/pulls/${number}/commits?per_page=100&page=${page}`)) ?? [];
        messages.push(...commits.flatMap((commit) => commit.commit?.message ? [commit.commit.message] : []));
        if (commits.length < 100) break;
      }
      return messages;
    },
    async getCheckConclusion(sha: string): Promise<CheckConclusion> {
      await Promise.resolve();
      const checks = parse<{ check_runs?: { conclusion?: string | null }[] }>(api(`repos/${target.owner}/${target.repo}/commits/${sha}/check-runs?per_page=100`));
      const conclusions = (checks?.check_runs ?? []).map((check) => check.conclusion).filter((x): x is string => typeof x === 'string');
      if (!conclusions.length) return 'none';
      if (conclusions.some((x) => x === 'failure' || x === 'timed_out' || x === 'action_required')) return 'failure';
      if (conclusions.every((x) => x === 'success')) return 'success';
      return 'neutral';
    },
  };
}
