import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ScanUpstreamError, createDefaultDeps, createDefaultScanGitHubClient, createOfflineGitHubClient, createOfflineScanGitHubClient } from './default-deps.js';
import { ScanInputError, validateAsOf, validateHorizons, validateTokenEnvName } from './inputs.js';
import { resolveIntegrationBranch } from './orchestrate/integration-branch.js';
import { runReportScan, type ReportScanDeps } from './orchestrate/scan-report.js';
import { execArgvCommand } from './shell-utils.js';
import { buildContributionPayload } from './report/contribute.js';
import { AttributionConfigError, resolveAttributionConfig } from './attribution/index.js';
import type { ScanGitHubClient } from './orchestrate/github.js';
import type { ArbiterReportV1, ReportCell } from '@hokusai/core';

export interface ReportCliWorld { env: Record<string, string | undefined>; diagnostic: (line: string) => void; depsFactory?: ((target: { owner: string; repo: string; repoDir: string; integrationBranch: string }) => ReportScanDeps) | undefined }
const TARGET = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
export function validateGithubTarget(raw: string): { owner: string; repo: string } {
  const match = raw.match(TARGET);
  if (!match || !match[1] || !match[2] || ['.', '..'].includes(match[2])) throw new ScanInputError('expected a GitHub owner/repo or https://github.com/owner/repo');
  return { owner: match[1], repo: match[2] };
}
const positive = (raw: string | undefined, name: string, fallback: number): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ScanInputError(`${name} must be a positive integer`);
  return value;
};
function reportSummary(report: ArbiterReportV1): string[] {
  const cells = Object.values(report.aggregates).flatMap((section) => section.rows.flatMap((row) =>
    Object.entries(row).filter(([key]) => key === 'cell' || key === 'ratio' || key.endsWith('_rate')).map(([, value]) => value as ReportCell)));
  const suppressed = cells.filter((cell) => cell.suppressed);
  const reasons = new Set(suppressed.flatMap((cell) => cell.suppression_reasons));
  const attribution = report.coverage.attribution;
  return [
    `coverage: agent ${attribution.agent.rate}, harness ${attribution.harness.rate}, exact model ${attribution.exact_model.rate}`,
    `suppression: ${suppressed.length} cells, ${reasons.size} reasons`,
  ];
}
export function runReportCli(args: readonly string[], world: ReportCliWorld): { output: string; rows: number; summary: string[]; out: string } {
  const parseReportArgs = () => parseArgs({ args: [...args], options: {
    repo: { type: 'string' }, 'integration-branch': { type: 'string' }, 'lookback-days': { type: 'string' }, 'max-prs': { type: 'string' }, horizons: { type: 'string' }, 'state-dir': { type: 'string' }, 'no-state': { type: 'boolean' }, 'attribution-config': { type: 'string' }, 'static-analysis': { type: 'string' }, 'as-of': { type: 'string' }, 'token-env': { type: 'string' }, offline: { type: 'boolean' }, out: { type: 'string' }, debug: { type: 'boolean' }, help: { type: 'boolean' }, contribute: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'api-key-env': { type: 'string' },
  }, allowPositionals: true, strict: true });
  let parsed: ReturnType<typeof parseReportArgs>;
  try { parsed = parseReportArgs(); } catch (error) { throw new ScanInputError((error as Error).message); }
  if (parsed.positionals.length !== 1) throw new ScanInputError('report requires one GitHub owner/repo or URL');
  const { owner, repo } = validateGithubTarget(parsed.positionals[0]!);
  const values = parsed.values;
  const maxPrs = positive(values['max-prs'], '--max-prs', 500);
  if (maxPrs > 2000) throw new ScanInputError('--max-prs must be at most 2000');
  const tokenName = validateTokenEnvName(values['token-env']);
  const token = world.env[tokenName];
  const github: ScanGitHubClient = values.offline ? createOfflineScanGitHubClient() : createDefaultScanGitHubClient(owner, repo, token);
  let repoDir = values.repo ? resolve(values.repo) : '';
  let temporary: string | null = null;
  try {
    if (!repoDir) {
      temporary = mkdtempSync(join(tmpdir(), 'hokusai-report-clone-'));
      repoDir = join(temporary, 'repo');
      if (values.offline) throw new ScanInputError('--offline requires --repo');
      const clone = token
        ? execArgvCommand('gh', ['repo', 'clone', `${owner}/${repo}`, repoDir, '--', '--no-tags'], { env: { ...world.env, GH_TOKEN: token }, stdio: 'pipe' })
        : execArgvCommand('git', ['clone', '--no-tags', `https://github.com/${owner}/${repo}.git`, repoDir], { stdio: 'pipe' });
      if (clone.exitCode !== 0) throw new ScanUpstreamError('GitHub clone failed');
    }
    if (!existsSync(repoDir)) throw new ScanInputError('--repo path does not exist');
    const defaultBranch = values['integration-branch'] ?? github.getRepo().defaultBranch;
    const runGit = (argv: readonly string[]) => execArgvCommand('git', ['-C', repoDir, ...argv], { stdio: 'pipe' });
    const historyRef = runGit(['show-ref', '--verify', `refs/heads/${defaultBranch}`]).exitCode === 0 ? defaultBranch : `origin/${defaultBranch}`;
    const history = runGit(['log', '--first-parent', '--max-count=200', '--pretty=format:%s', historyRef]);
    if (history.exitCode !== 0) throw new ScanInputError(`cannot read default branch ${defaultBranch}`);
    const integrationBranch = resolveIntegrationBranch({
      ...(values['integration-branch'] ? { explicit: values['integration-branch'] } : {}), defaultBranch,
      recentFirstParentSubjects: history.stdout.split('\n'),
      headRefLookup: (number) => github.getPullRequest(number)?.headRef ?? null,
      remoteBranchExists: (ref) => runGit(['show-ref', '--verify', `refs/remotes/origin/${ref}`]).exitCode === 0 || runGit(['show-ref', '--verify', `refs/heads/${ref}`]).exitCode === 0,
    });
    const local = runGit(['show-ref', '--verify', `refs/heads/${integrationBranch}`]);
    if (local.exitCode !== 0) {
      const remote = runGit(['show-ref', '--verify', `refs/remotes/origin/${integrationBranch}`]);
      if (remote.exitCode !== 0) throw new ScanInputError(`integration branch ${integrationBranch} is not available locally`);
      const track = runGit(['branch', '--track', integrationBranch, `origin/${integrationBranch}`]);
      if (track.exitCode !== 0) throw new ScanInputError(`cannot track integration branch ${integrationBranch}`);
    }
    const target = { owner, repo, repoDir, integrationBranch };
    const deps = world.depsFactory?.(target) ?? (() => {
      const base = createDefaultDeps({ ...target, token }, { strictUpstream: true, ...(values['as-of'] ? { now: () => validateAsOf(values['as-of'])! } : {}) });
      return { runGit, labellerGithub: values.offline ? createOfflineGitHubClient() : base.github, github, now: base.now, onDiagnostic: world.diagnostic };
    })();
    let config: ReturnType<typeof resolveAttributionConfig> | undefined;
    if (values['attribution-config']) {
      try { config = resolveAttributionConfig(JSON.parse(readFileSync(resolve(values['attribution-config']), 'utf8')), `${owner}/${repo}`); }
      catch (error) {
        if (error instanceof AttributionConfigError) throw new ScanInputError(error.message);
        throw new ScanInputError('invalid --attribution-config JSON file');
      }
    }
    const staticAnalysis = values['static-analysis'] ?? 'off';
    if (staticAnalysis !== 'off' && staticAnalysis !== 'committed') throw new ScanInputError('--static-analysis must be off or committed');
    const lookbackDays = positive(values['lookback-days'], '--lookback-days', 180);
    if (lookbackDays > 3650) throw new ScanInputError('--lookback-days must be at most 3650');
    const gitDir = runGit(['rev-parse', '--absolute-git-dir']);
    if (gitDir.exitCode !== 0) throw new ScanInputError('--repo is not a git worktree');
    const stateDir = values['no-state'] ? undefined : values['state-dir'] ? resolve(values['state-dir']) : join(gitDir.stdout.trim(), 'hokusai-scan', `${owner}__${repo}`);
    const result = runReportScan(target, deps, { scannerVersion: '0.4.0', lookbackDays, maxPrs, horizons: validateHorizons(values.horizons), staticAnalysis, ...(stateDir ? { stateDir } : {}), offline: values.offline === true, ...(config ? { attributionConfig: config } : {}) });
    let output = result.json;
    if (values.contribute) {
      output = buildContributionPayload(result.report);
      if (!values['dry-run']) {
        const keyEnv = values['api-key-env'] ?? 'HOKUSAI_API_KEY';
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) throw new ScanInputError('--api-key-env must name an environment variable');
        const apiKey = world.env[keyEnv];
        if (!apiKey) throw new ScanInputError(`missing API key in ${keyEnv}`);
        if (!/^[\x21-\x7e]+$/.test(apiKey)) throw new ScanInputError('API key contains invalid characters');
        const baseUrl = world.env.HOKUSAI_BASE_URL ?? 'https://api.hokus.ai';
        const payloadDir = mkdtempSync(join(tmpdir(), 'hokusai-contribution-'));
        try {
          const bodyFile = join(payloadDir, 'body.json');
          writeFileSync(bodyFile, output, { mode: 0o600 });
          const escaped = apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const curlConfig = `header = "Authorization: Bearer ${escaped}"\nheader = "Content-Type: application/json"\n`;
          const response = execArgvCommand('curl', ['--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--config', '-', '--data-binary', `@${bodyFile}`, `${baseUrl.replace(/\/$/, '')}/api/v1/arbiter/reports`], { input: curlConfig });
          const status = Number(response.stdout.trim());
          if (response.exitCode !== 0 || status < 200 || status >= 300) throw new ScanUpstreamError(`Report contribution failed (HTTP ${status || 'unknown'})`);
        } finally { rmSync(payloadDir, { recursive: true, force: true }); }
      }
    }
    return { output, rows: result.report.prs.length, out: values.out ?? '-', summary: [`contract arbiter_report/v1`, `PRs ${result.report.prs.length}`, ...reportSummary(result.report), `incremental: reused ${result.stats.reused}, new ${result.stats.added}, relabelled ${result.stats.relabelled}`] };
  } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
}
