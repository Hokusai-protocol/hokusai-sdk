/**
 * `hokusai-scan` command implementation, shared verbatim by the bin entry
 * (`cli.ts`) and the GitHub Action entry (`action-entry.ts`) so the two can
 * never drift.
 *
 * Contract:
 * - stdout carries data only (JSONL labels, candidate-feature JSON, or the
 *   combined scan object).
 * - stderr carries diagnostics only, every line prefixed `info:`, `warn:`,
 *   or `error:`.
 * - Exit codes: 0 success; 1 unexpected internal error; 2 invalid input;
 *   3 upstream (GitHub) failure.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import type { ArbiterSurvivalLabelV1, HorizonDays } from '@hokusai/core';
import { extractCandidateFeatures } from './candidate-features.js';
import { SCAN_CONTRACT, scanContractVersion } from './contract.js';
import {
  ScanUpstreamError,
  createDefaultDeps,
  createOfflineGitHubClient,
  createDefaultScanGitHubClient,
} from './default-deps.js';
import {
  ScanInputError,
  validateAsOf,
  validateGithubRepo,
  validateHorizons,
  validateIntegrationBranch,
  validateMaxPrs,
  validatePrNumber,
  validatePrUrl,
  validateRepoDir,
  validateTokenEnvName,
  type GithubRepoRef,
} from './inputs.js';
import {
  serializeCandidateFeatures,
  serializeSurvivalLabels,
  sortMergedPrsForEmission,
} from './serialize.js';
import { execArgvCommand } from './shell-utils.js';
import {
  enumerateMergedPrs,
  isSkippedPr,
  labelMergedPr,
  resolveMergedPr,
  summarizeLabels,
  type MergedPrRef,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
} from './survival-labeller.js';
import { runShadowCli } from './shadow/cli.js';
import { createOfflineScanGitHubClient } from './orchestrate/github.js';
import { resolveIntegrationBranch } from './orchestrate/integration-branch.js';
import { runReportScan } from './orchestrate/scan-report.js';
import { emitReport } from './report/build.js';
import { buildContributionPayload, submitReport } from './report/contribute.js';
import type { FetchTransport } from '@hokusai/core';

export const EXIT_OK = 0;
export const EXIT_INTERNAL = 1;
export const EXIT_INVALID_INPUT = 2;
export const EXIT_UPSTREAM = 3;

/** Ambient world handed to the command, injectable for tests. */
export interface CliIo {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  env: Record<string, string | undefined>;
}

export interface CliRunResult {
  exitCode: number;
  /** Label rows written (0 on empty output; 1 per extract blob). */
  rowCount: number;
  /** Absolute output file path, or null when writing to stdout. */
  outputPath: string | null;
  /** Human-readable status lines for the Action job summary. */
  summaryLines: string[];
}

const USAGE = `usage: hokusai-scan <label|extract|scan|report> [options]

label    --repo <path> --integration-branch <name> [--github-repo <owner/name>]
         [--pr-url <url>] [--horizons 14,30,60] [--max-prs <n>] [--as-of <iso>]
         [--no-links] [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
extract  --repo <path> --pr <n> [--base-ref <ref>] [--config-path <path>]
         [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
scan     --repo <path> --integration-branch <name> --pr <n> [common options]
report   [<github-url|owner/name>] [--repo <path>] [--integration-branch <name>]
         [--lookback-days <n>] [--max-prs <n>] [--horizons 14,30,60]
         [--state-dir <path>] [--contribute [--dry-run]]

shadow-score     --data-dir <path> --integration-branch <name> [--repo <path>]
                 [--github-repo <owner/name>] [--threshold 0.5]
                 [--bootstrap-days 30] [--max-prs 200]
shadow-backfill  --data-dir <path> --integration-branch <name> [--repo <path>]
                 [--github-repo <owner/name>] [--horizon-days 30]
shadow-report    --data-dir <path> [--window-days 30] [--horizon-days 30]
                 (shadow commands always exit 0 and print SHADOW_* lines)
`;

const OPTION_SPEC = {
  'repo': { type: 'string' },
  'integration-branch': { type: 'string' },
  'github-repo': { type: 'string' },
  'pr': { type: 'string' },
  'pr-url': { type: 'string' },
  'base-ref': { type: 'string' },
  'config-path': { type: 'string' },
  'horizons': { type: 'string' },
  'max-prs': { type: 'string' },
  'as-of': { type: 'string' },
  'token-env': { type: 'string' },
  'out': { type: 'string' },
  'no-links': { type: 'boolean' },
  'offline': { type: 'boolean' },
  'debug': { type: 'boolean' },
  'lookback-days': { type: 'string' },
  'max-lookback-days': { type: 'string' },
  'static-analysis': { type: 'string' },
  'state-dir': { type: 'string' },
  'no-state': { type: 'boolean' },
  'attribution-config': { type: 'string' },
  'contribute': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'api-key-env': { type: 'string' },
  'help': { type: 'boolean' },
} as const;

interface CommandContext {
  io: CliIo;
  debug: boolean;
  token: string | undefined;
  summaryLines: string[];
}

function makeDiagnostics(context: CommandContext) {
  const redact = (text: string): string =>
    context.token ? text.split(context.token).join('***') : text;
  return {
    info: (message: string) => context.io.writeStderr(`info: ${redact(message)}\n`),
    warn: (message: string) => context.io.writeStderr(`warn: ${redact(message)}\n`),
    error: (message: string) => context.io.writeStderr(`error: ${redact(message)}\n`),
  };
}

export function runScanCli(argv: readonly string[], io: CliIo): CliRunResult {
  const context: CommandContext = { io, debug: false, token: undefined, summaryLines: [] };
  const diag = makeDiagnostics(context);
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '--help' || command === 'help') {
      io.writeStderr(USAGE);
      return { exitCode: command === undefined ? EXIT_INVALID_INPUT : EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (command.startsWith('shadow-')) {
      // Shadow mode is fail-silent (HOK-2820): the sub-CLI always exits 0
      // and writes only SHADOW_* lines to stdout. Never gates anything.
      const result = runShadowCli(command, rest, {
        log: (line) => io.writeStdout(`${line}\n`),
        cwd: process.cwd(),
      });
      return { exitCode: result.exitCode, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (command !== 'label' && command !== 'extract' && command !== 'scan') {
      throw new ScanInputError(`unknown subcommand ${command}; expected label, extract, or scan`);
    }

    let values: Record<string, string | boolean | undefined>;
    try {
      ({ values } = parseArgs({ args: [...rest], options: OPTION_SPEC, strict: true, allowPositionals: false }));
    } catch (error) {
      throw new ScanInputError((error as Error).message);
    }
    if (values.help === true) {
      io.writeStderr(USAGE);
      return { exitCode: EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] };
    }

    context.debug = values.debug === true;
    const tokenEnvName = validateTokenEnvName(values['token-env'] as string | undefined);
    context.token = io.env[tokenEnvName];

    const repoDir = resolveRepoDir(values.repo as string | undefined);
    const offline = values.offline === true;
    const asOf = validateAsOf(values['as-of'] as string | undefined);
    const outSpec = (values.out as string | undefined) ?? '-';

    let output: string;
    let rowCount: number;

    if (command === 'label') {
      ({ output, rowCount } = runLabel(context, {
        repoDir,
        offline,
        asOf,
        integrationBranch: validateIntegrationBranch(values['integration-branch'] as string | undefined),
        githubRepo: validateGithubRepo(values['github-repo'] as string | undefined),
        prUrl: validatePrUrl(values['pr-url'] as string | undefined),
        horizons: validateHorizons(values.horizons as string | undefined),
        maxPrs: validateMaxPrs(values['max-prs'] as string | undefined),
        includeLinkedReferences: values['no-links'] === true || offline ? false : undefined,
      }));
    } else if (command === 'extract') {
      ({ output, rowCount } = runExtract(context, {
        repoDir,
        offline,
        prNumber: validatePrNumber(values.pr as string | undefined),
        baseRef: values['base-ref'] as string | undefined,
        configPath: values['config-path'] as string | undefined,
      }));
    } else {
      ({ output, rowCount } = runCombinedScan(context, {
        repoDir,
        offline,
        asOf,
        integrationBranch: validateIntegrationBranch(values['integration-branch'] as string | undefined),
        githubRepo: validateGithubRepo(values['github-repo'] as string | undefined),
        prNumber: validatePrNumber(values.pr as string | undefined),
        baseRef: values['base-ref'] as string | undefined,
        configPath: values['config-path'] as string | undefined,
        horizons: validateHorizons(values.horizons as string | undefined),
        maxPrs: validateMaxPrs(values['max-prs'] as string | undefined),
        includeLinkedReferences: values['no-links'] === true || offline ? false : undefined,
      }));
    }

    let outputPath: string | null = null;
    if (outSpec === '-') {
      io.writeStdout(output);
    } else {
      outputPath = resolve(outSpec);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, output);
    }
    context.summaryLines.unshift(`contract ${scanContractVersion()}`, `rows ${rowCount}`);
    return { exitCode: EXIT_OK, rowCount, outputPath, summaryLines: context.summaryLines };
  } catch (error) {
    if (error instanceof ScanInputError) {
      diag.error(error.message);
      return { exitCode: EXIT_INVALID_INPUT, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (error instanceof ScanUpstreamError) {
      diag.error(error.message);
      return { exitCode: EXIT_UPSTREAM, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    diag.error(`unexpected: ${(error as Error).message}`);
    if (context.debug && (error as Error).stack) {
      for (const line of ((error as Error).stack as string).split('\n')) {
        diag.error(line);
      }
    }
    return { exitCode: EXIT_INTERNAL, rowCount: 0, outputPath: null, summaryLines: [] };
  }
}

/** Async entry point for report scans; existing commands keep their synchronous API. */
export async function runScanCliAsync(argv: readonly string[], io: CliIo): Promise<CliRunResult> {
  if (argv[0] !== 'report') return runScanCli(argv, io);
  return runReportCli(argv.slice(1), io);
}

async function runReportCli(argv: readonly string[], io: CliIo): Promise<CliRunResult> {
  const context: CommandContext = { io, debug: false, token: undefined, summaryLines: [] };
  const diag = makeDiagnostics(context);
  let temporaryRepo: string | null = null;
  try {
    let parsed;
    try { parsed = parseArgs({ args: [...argv], options: OPTION_SPEC, strict: true, allowPositionals: true }); }
    catch (error) { throw new ScanInputError((error as Error).message); }
    const values = parsed.values as Record<string, string | boolean | undefined>;
    if (values.help === true) { io.writeStderr(USAGE); return { exitCode: EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] }; }
    if (parsed.positionals.length > 1) throw new ScanInputError('report accepts at most one repository URL or owner/name positional');
    const tokenName = validateTokenEnvName(values['token-env'] as string | undefined);
    context.token = io.env[tokenName];
    const explicitRepo = validateGithubRepo(values['github-repo'] as string | undefined);
    const targetFromPositional = parseGithubTarget(parsed.positionals[0]);
    if (explicitRepo && targetFromPositional && (explicitRepo.owner !== targetFromPositional.owner || explicitRepo.repo !== targetFromPositional.repo)) {
      throw new ScanInputError('positional repository and --github-repo must match');
    }
    const github = explicitRepo ?? targetFromPositional;
    const offline = values.offline === true;
    let repoDir: string;
    if (values.repo) repoDir = resolveRepoDir(values.repo as string);
    else if (!offline && targetFromPositional?.url) {
      temporaryRepo = mkdtempSync(join(tmpdir(), 'hokusai-report-'));
      const result = execArgvCommand('git', ['clone', '--no-tags', targetFromPositional.url, temporaryRepo], { env: context.token ? { ...process.env, GH_TOKEN: context.token } : process.env });
      if (result.exitCode !== 0) throw new ScanUpstreamError('Unable to clone the public repository');
      repoDir = temporaryRepo;
    } else {
      throw new ScanInputError('report requires --repo <local checkout> or a public GitHub URL');
    }
    const resolvedGithub = requireGithubRepo(context, repoDir, github ?? undefined);
    const asOf = validateAsOf(values['as-of'] as string | undefined) ?? new Date();
    const scanGithub = offline ? createOfflineScanGitHubClient() : createDefaultScanGitHubClient({ ...resolvedGithub, repoDir, ...(context.token ? { token: context.token } : {}) });
    const reportDeps = buildLabellerWorld(context, { repoDir, offline, asOf, integrationBranch: 'develop', githubRepo: resolvedGithub });
    if (offline) reportDeps.deps.github = createOfflineGitHubClient();
    const repoMetadata = offline ? { defaultBranch: (values['integration-branch'] as string | undefined) ?? '', private: false } : await scanGithub.getRepo();
    const explicitBranch = values['integration-branch'] as string | undefined;
    let integrationBranch: string;
    if (explicitBranch) integrationBranch = validateIntegrationBranch(explicitBranch);
    else {
      const log = reportDeps.deps.runGit(['log', '--first-parent', '-200', '--pretty=format:%s', repoMetadata.defaultBranch]);
      if (log.exitCode !== 0) throw new ScanInputError('cannot read the repository default branch history');
      integrationBranch = resolveIntegrationBranch({
        defaultBranch: repoMetadata.defaultBranch, recentFirstParentSubjects: log.stdout.split('\n'),
        headRefLookup: (number) => { const result = execArgvCommand('gh', ['pr', 'view', String(number), '--json', 'headRefName'], { cwd: repoDir, ...(context.token ? { env: { ...process.env, GH_TOKEN: context.token } } : {}) }); if (result.exitCode !== 0) return null; try { return (JSON.parse(result.stdout) as { headRefName?: string }).headRefName ?? null; } catch { return null; } },
        remoteBranchExists: (ref) => execArgvCommand('git', ['-C', repoDir, 'ls-remote', '--exit-code', '--heads', 'origin', ref]).exitCode === 0,
      }).branch;
    }
    if (temporaryRepo) {
      const fetched = execArgvCommand('git', ['-C', repoDir, 'fetch', '--no-tags', 'origin', integrationBranch], { env: context.token ? { ...process.env, GH_TOKEN: context.token } : process.env });
      if (fetched.exitCode !== 0) throw new ScanUpstreamError('Unable to fetch the integration branch');
      const checkout = execArgvCommand('git', ['-C', repoDir, 'checkout', '-B', integrationBranch, 'FETCH_HEAD']);
      if (checkout.exitCode !== 0) throw new ScanInputError('unable to check out the integration branch');
    }
    const lookback = parsePositiveInteger(values['lookback-days'] as string | undefined, 180, '--lookback-days', 3650);
    const maxLookback = parsePositiveInteger(values['max-lookback-days'] as string | undefined, 730, '--max-lookback-days', 3650);
    const maxPrs = parsePositiveInteger(values['max-prs'] as string | undefined, 500, '--max-prs', 20000);
    const horizons = validateHorizons(values.horizons as string | undefined);
    const staticAnalysis = values['static-analysis'] === undefined ? 'off' : values['static-analysis'];
    if (staticAnalysis !== 'off' && staticAnalysis !== 'committed') throw new ScanInputError('--static-analysis must be off or committed');
    let attributionConfig = {};
    const configPath = values['attribution-config'] as string | undefined;
    if (configPath) { try { attributionConfig = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as object; } catch { throw new ScanInputError('--attribution-config must point to valid JSON'); } }
    const stateDir = (values['state-dir'] as string | undefined) ?? (values['no-state'] === true ? undefined : join(repoDir, '.git', 'hokusai-scan', `${resolvedGithub.owner}__${resolvedGithub.repo}`));
    const draft = await runReportScan({ ...resolvedGithub, repoDir, integrationBranch }, {
      runGit: reportDeps.deps.runGit, labeller: reportDeps.deps, github: scanGithub, now: () => asOf,
      onDiagnostic: (line) => io.writeStderr(`${line.startsWith('info:') || line.startsWith('warn:') || line.startsWith('error:') ? '' : 'info: '}${line}\n`),
    }, { lookbackDays: lookback, maxLookbackDays: maxLookback, maxPrs, horizons, attributionConfig, staticAnalysis, scannerVersion: '0.4.0', ...(stateDir ? { stateDir } : {}) });
    const output = emitReport(draft);
    const outSpec = (values.out as string | undefined) ?? '-';
    const outputPath = outSpec === '-' ? null : resolve(outSpec);
    if (values.contribute === true) {
      const built = buildContributionPayload(JSON.parse(output));
      if (values['dry-run'] === true) { if (outSpec === '-') io.writeStdout(built.body); else { mkdirSync(dirname(outputPath!), { recursive: true }); writeFileSync(outputPath!, built.body); } }
      else {
        const apiKeyName = validateTokenEnvName(values['api-key-env'] as string | undefined ?? 'HOKUSAI_API_KEY');
        const apiKey = io.env[apiKeyName];
        if (!apiKey) throw new ScanInputError(`missing API key in environment variable ${apiKeyName}`);
        const transport: FetchTransport = (input, init) => fetch(input, init);
        await submitReport(transport, built, { baseUrl: io.env.HOKUSAI_BASE_URL ?? 'https://api.hokus.ai', apiKey });
        if (outSpec !== '-') { mkdirSync(dirname(outputPath!), { recursive: true }); writeFileSync(outputPath!, output); }
      }
    } else if (outSpec === '-') io.writeStdout(output);
    else { mkdirSync(dirname(outputPath!), { recursive: true }); writeFileSync(outputPath!, output); }
    context.summaryLines.push(`report ${resolvedGithub.owner}/${resolvedGithub.repo}`, `PRs ${draft.prs.length}`, `lookback ${draft.scan.lookback_days} days`);
    return { exitCode: EXIT_OK, rowCount: draft.prs.length, outputPath, summaryLines: context.summaryLines };
  } catch (error) {
    if (error instanceof ScanInputError) { diag.error(error.message); return { exitCode: EXIT_INVALID_INPUT, rowCount: 0, outputPath: null, summaryLines: [] }; }
    if (error instanceof ScanUpstreamError) { diag.error(error.message); return { exitCode: EXIT_UPSTREAM, rowCount: 0, outputPath: null, summaryLines: [] }; }
    diag.error(`unexpected: ${(error as Error).message}`);
    return { exitCode: EXIT_INTERNAL, rowCount: 0, outputPath: null, summaryLines: [] };
  } finally {
    if (temporaryRepo) rmSync(temporaryRepo, { recursive: true, force: true });
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new ScanInputError(`${name} must be an integer from 1 to ${maximum}`);
  return parsed;
}
function parseGithubTarget(value: string | undefined): ({ owner: string; repo: string; url?: string }) | null {
  if (!value) return null;
  const match = value.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\.git)?\/?$/i);
  if (!match || match[2] === '.' || match[2] === '..') throw new ScanInputError('repository must be a GitHub URL or owner/name');
  return { owner: match[1]!, repo: match[2]!, url: `https://github.com/${match[1]}/${match[2]}.git` };
}

// ── Preconditions on the ambient world (CLI shell, not core) ───────────────

function resolveRepoDir(raw: string | undefined): string {
  const repoDir = resolve(validateRepoDir(raw));
  if (!existsSync(repoDir) || !statSync(repoDir).isDirectory()) {
    throw new ScanInputError('--repo path does not exist');
  }
  const inside = execArgvCommand('git', ['-C', repoDir, 'rev-parse', '--is-inside-work-tree']);
  if (inside.exitCode !== 0 || inside.stdout.toString().trim() !== 'true') {
    throw new ScanInputError('--repo is not a git working tree');
  }
  const shallow = execArgvCommand('git', ['-C', repoDir, 'rev-parse', '--is-shallow-repository']);
  if (shallow.stdout.toString().trim() === 'true') {
    throw new ScanInputError('repository is a shallow clone; checkout with fetch-depth: 0');
  }
  return repoDir;
}

function detectGithubRepo(repoDir: string): GithubRepoRef | null {
  const result = execArgvCommand('git', ['-C', repoDir, 'remote', 'get-url', 'origin']);
  if (result.exitCode !== 0) return null;
  const match = result.stdout.toString().trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1] as string, repo: match[2] as string };
}

function requireGithubRepo(
  context: CommandContext,
  repoDir: string,
  explicit: GithubRepoRef | undefined,
): GithubRepoRef {
  if (explicit) return explicit;
  const detected = detectGithubRepo(repoDir);
  if (!detected) {
    throw new ScanInputError('cannot detect owner/name from the origin remote; pass --github-repo');
  }
  makeDiagnostics(context).info(
    `github repo detected from origin remote: ${detected.owner}/${detected.repo}`,
  );
  return detected;
}

// ── label ──────────────────────────────────────────────────────────────────

interface LabelParams {
  repoDir: string;
  offline: boolean;
  asOf: Date | undefined;
  integrationBranch: string;
  githubRepo: GithubRepoRef | undefined;
  prUrl: string | undefined;
  horizons: HorizonDays[];
  maxPrs: number;
  includeLinkedReferences: false | undefined;
}

function buildLabellerWorld(
  context: CommandContext,
  params: Pick<LabelParams, 'repoDir' | 'offline' | 'asOf' | 'integrationBranch' | 'githubRepo'>,
): { target: SurvivalLabellerTarget; deps: SurvivalLabellerDeps } {
  const diag = makeDiagnostics(context);
  const githubRepo = requireGithubRepo(context, params.repoDir, params.githubRepo);
  const target: SurvivalLabellerTarget = {
    owner: githubRepo.owner,
    repo: githubRepo.repo,
    integrationBranch: params.integrationBranch,
    repoDir: params.repoDir,
    ...(context.token !== undefined ? { token: context.token } : {}),
  };
  const asOf = params.asOf;
  const deps = createDefaultDeps(target, {
    strictUpstream: true,
    ...(asOf ? { now: () => asOf } : {}),
  });
  if (params.offline) {
    deps.github = createOfflineGitHubClient();
  }
  deps.onDiagnostic = (message) => diag.warn(message);
  return { target, deps };
}

function collectLabels(
  context: CommandContext,
  params: LabelParams,
  prFilter?: (pr: MergedPrRef) => boolean,
): ArbiterSurvivalLabelV1[] {
  const diag = makeDiagnostics(context);
  const { target, deps } = buildLabellerWorld(context, params);
  const allMergedPrs = enumerateMergedPrs(target, deps, { maxCount: params.maxPrs });

  let prs: MergedPrRef[];
  if (params.prUrl !== undefined) {
    const resolved = resolveMergedPr(target, deps, params.prUrl, { searchLimit: params.maxPrs });
    if (isSkippedPr(resolved)) {
      if (resolved.reason === 'unmerged_pr') {
        throw new ScanInputError(`${resolved.prUrl}: ${resolved.detail}`);
      }
      throw new ScanInputError(`${resolved.prUrl}: inaccessible history (${resolved.detail})`);
    }
    prs = [resolved];
  } else {
    prs = sortMergedPrsForEmission(allMergedPrs);
    if (prFilter) prs = prs.filter(prFilter);
  }

  const labels: ArbiterSurvivalLabelV1[] = [];
  for (const pr of prs) {
    try {
      labels.push(...labelMergedPr(target, deps, pr, {
        horizons: params.horizons,
        allMergedPrs,
        ...(params.includeLinkedReferences === undefined
          ? {}
          : { includeLinkedReferences: params.includeLinkedReferences }),
      }));
    } catch (error) {
      if (error instanceof ScanUpstreamError) throw error;
      diag.error(`failed to label ${pr.prUrl}: ${String(error)}`);
    }
  }

  const summary = summarizeLabels(`${target.owner}/${target.repo}`, labels);
  diag.info(`summary ${JSON.stringify(summary)}`);
  for (const [horizon, bucket] of Object.entries(summary.horizons)) {
    context.summaryLines.push(
      `${horizon}d: ${bucket.rows} rows, ${bucket.missing} missing, survival_rate ${bucket.survival_rate ?? 'n/a'}`,
    );
  }
  return labels;
}

function runLabel(context: CommandContext, params: LabelParams): { output: string; rowCount: number } {
  const labels = collectLabels(context, params);
  return { output: serializeSurvivalLabels(labels), rowCount: labels.length };
}

// ── extract ────────────────────────────────────────────────────────────────

interface ExtractParams {
  repoDir: string;
  offline: boolean;
  prNumber: number;
  baseRef: string | undefined;
  configPath: string | undefined;
}

function runExtract(context: CommandContext, params: ExtractParams): { output: string; rowCount: number } {
  const diag = makeDiagnostics(context);
  const features = extractCandidateFeatures({
    checkoutDir: params.repoDir,
    prNumber: params.prNumber,
    baseRef: params.baseRef,
    offline: params.offline,
    configPath: params.configPath,
    onDiagnostic: (message) => diag.warn(message),
  });
  return { output: serializeCandidateFeatures(features), rowCount: 1 };
}

// ── scan (label one PR + extract, combined) ────────────────────────────────

interface CombinedParams extends ExtractParams {
  asOf: Date | undefined;
  integrationBranch: string;
  githubRepo: GithubRepoRef | undefined;
  horizons: HorizonDays[];
  maxPrs: number;
  includeLinkedReferences: false | undefined;
}

function runCombinedScan(
  context: CommandContext,
  params: CombinedParams,
): { output: string; rowCount: number } {
  const labels = collectLabels(
    context,
    { ...params, prUrl: undefined },
    (pr) => pr.prNumber === params.prNumber,
  );
  if (labels.length === 0) {
    throw new ScanInputError(
      `PR #${params.prNumber} not found on ${params.integrationBranch} within --max-prs ${params.maxPrs}`,
    );
  }
  const features = extractCandidateFeatures({
    checkoutDir: params.repoDir,
    prNumber: params.prNumber,
    baseRef: params.baseRef,
    offline: params.offline,
    configPath: params.configPath,
    onDiagnostic: (message) => makeDiagnostics(context).warn(message),
  });
  const combined = {
    scan_contract: SCAN_CONTRACT,
    candidate_features: features,
    survival_labels: labels,
  };
  return { output: `${JSON.stringify(combined, null, 2)}\n`, rowCount: labels.length };
}
