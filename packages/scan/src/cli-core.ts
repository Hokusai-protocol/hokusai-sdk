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

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ArbiterSurvivalLabelV1, HorizonDays } from '@hokusai/core';
import { extractCandidateFeatures } from './candidate-features.js';
import { SCAN_CONTRACT, scanContractVersion } from './contract.js';
import {
  ScanUpstreamError,
  createDefaultDeps,
  createOfflineGitHubClient,
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
  validateReportFormat,
  validateReportHorizon,
  validateTokenEnvName,
  type GithubRepoRef,
  type ShadowReportFormat,
} from './inputs.js';
import {
  aggregateShadowScans,
  serializeShadowReport,
  type ShadowScanInput,
} from './shadow-aggregate.js';
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
report   --inputs <dir|file> [--horizon 14|30|60] [--as-of <iso>]
         [--format markdown|json] [--out <path|->] [--debug]
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
  'inputs': { type: 'string' },
  'format': { type: 'string' },
  'horizon': { type: 'string' },
  'out': { type: 'string' },
  'no-links': { type: 'boolean' },
  'offline': { type: 'boolean' },
  'debug': { type: 'boolean' },
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
    if (command !== 'label' && command !== 'extract' && command !== 'scan' && command !== 'report') {
      throw new ScanInputError(
        `unknown subcommand ${command}; expected label, extract, scan, or report`,
      );
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

    const offline = values.offline === true;
    const asOf = validateAsOf(values['as-of'] as string | undefined);
    const outSpec = (values.out as string | undefined) ?? '-';

    let output: string;
    let rowCount: number;

    if (command === 'report') {
      ({ output, rowCount } = runReport(context, {
        inputsPath: resolveInputsPath(values.inputs as string | undefined),
        asOf,
        horizon: validateReportHorizon(values.horizon as string | undefined),
        format: validateReportFormat(values.format as string | undefined),
      }));
    } else if (command === 'label') {
      const repoDir = resolveRepoDir(values.repo as string | undefined);
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
      const repoDir = resolveRepoDir(values.repo as string | undefined);
      ({ output, rowCount } = runExtract(context, {
        repoDir,
        offline,
        prNumber: validatePrNumber(values.pr as string | undefined),
        baseRef: values['base-ref'] as string | undefined,
        configPath: values['config-path'] as string | undefined,
      }));
    } else {
      const repoDir = resolveRepoDir(values.repo as string | undefined);
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

function resolveInputsPath(raw: string | undefined): string {
  if (!raw || !raw.trim()) {
    throw new ScanInputError('--inputs is required');
  }
  const inputsPath = resolve(raw);
  if (!existsSync(inputsPath)) {
    throw new ScanInputError('--inputs path does not exist');
  }
  return inputsPath;
}

// ── report (shadow-mode aggregation, HOK-2820) ─────────────────────────────

interface ReportParams {
  inputsPath: string;
  asOf: Date | undefined;
  horizon: ReturnType<typeof validateReportHorizon>;
  format: ShadowReportFormat;
}

/**
 * Collect every `.json` / `.jsonl` file under the inputs path, sorted by
 * path relative to it, so aggregation order — and therefore the report
 * bytes — never depends on filesystem enumeration order or on where the
 * inputs directory lives.
 */
function collectShadowInputs(inputsPath: string): ShadowScanInput[] {
  const stats = statSync(inputsPath);
  if (!stats.isDirectory()) {
    return [{ source: basename(inputsPath), content: readFileSync(inputsPath, 'utf-8') }];
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsonl?$/.test(entry.name)) files.push(full);
    }
  };
  walk(inputsPath);
  return files.map((file) => ({
    source: relative(inputsPath, file),
    content: readFileSync(file, 'utf-8'),
  }));
}

function runReport(context: CommandContext, params: ReportParams): { output: string; rowCount: number } {
  const diag = makeDiagnostics(context);
  const inputs = collectShadowInputs(params.inputsPath);
  const result = aggregateShadowScans(inputs, {
    asOf: params.asOf ?? new Date(),
    horizonDays: params.horizon,
  });
  for (const diagnostic of result.diagnostics) diag.warn(diagnostic);

  let totalPrs = 0;
  for (const repo of result.report.repos) {
    totalPrs += repo.prs_seen;
    const precision = repo.precision_suppressed
      ? 'precision suppressed'
      : `precision ${repo.would_be_precision ?? 'n/a'}`;
    context.summaryLines.push(
      `${repo.repo}: ${repo.prs_seen} PRs, ${repo.flags.flag} would-be flags, ${precision}`,
    );
  }
  diag.info(
    `shadow report: ${result.report.repos.length} repo(s), ${totalPrs} PR(s), horizon ${result.report.horizon_days}d`,
  );

  const output =
    params.format === 'json' ? serializeShadowReport(result.report) : result.markdown;
  return { output, rowCount: totalPrs };
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
