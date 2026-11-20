/**
 * The example-report batch (HOK-3515 step 2): one command that takes the
 * manifest and probe and, for every eligible repo in a batch, scans, re-scans,
 * scores, renders and reviews.
 *
 * - Resumable and safe to re-run: state lives in `<out>/batch-state.json`;
 *   a step whose output exists and whose state says done is skipped.
 * - Within GitHub rate limits: before each scan it checks the remaining
 *   budget and waits for the reset when it is below `minRateRemaining`.
 * - Versions: `<out>/run.json` records scanner, labeller, normalization,
 *   manifest and probe hashes. Model and label-definition versions are
 *   recorded once scoring exists.
 * - Unit cost: every step records wall time.
 *
 * Scoring (HOK-2826) and rendering (HOK-2828) do not exist yet. Their steps
 * record `unavailable`, the payload keeps a null retrospective, and review
 * fails `retrospective_present`, so nothing can be published by accident.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewExampleReport, type ExampleReviewResult } from './review.js';
import type { ExampleManifest, TrainingExclusion } from './select.js';

export const EXAMPLE_BATCH_VERSION = '0.1.0';

export type StepName = 'scan' | 'rescan' | 'score' | 'render' | 'review';
export interface StepState {
  status: 'done' | 'failed' | 'unavailable';
  wall_ms?: number;
  exit_code?: number;
  detail?: string;
  at: string;
}
export interface RepoState {
  repo: string;
  role: string;
  steps: Partial<Record<StepName, StepState>>;
  review?: Pick<ExampleReviewResult, 'passed' | 'borderline' | 'borderline_reasons'> & { failed: string[] };
}
export interface BatchState {
  batch_version: string;
  batch: string;
  as_of: string;
  repos: Record<string, RepoState>;
}

export interface ProbeResultLike {
  repo: string;
  eligible: boolean;
}

export interface BatchDeps {
  /** Runs one report scan of `repo` at `asOf` into `outPath`. */
  runScan(repo: string, asOf: string, outPath: string): { exitCode: number; stderrTail: string };
  /** Remaining GitHub API budget, or null when it cannot be read. */
  rateLimit(): { remaining: number; resetAt: number } | null;
  sleep(ms: number): void;
  now(): number;
  log(line: string): void;
}

export interface BatchOptions {
  manifest: ExampleManifest;
  probe: { as_of: string; results: ProbeResultLike[] };
  batch: string;
  /** Which roles to run; default primaries only. */
  roles?: string[];
  outDir: string;
  asOf: string;
  exclusion: TrainingExclusion;
  versions: { scanner: string };
  runInfo: Record<string, unknown>;
  minRateRemaining?: number;
  /** Re-run steps that already succeeded. */
  force?: boolean;
  /** Skip the re-scan (dry runs that measure yield and cost); review then fails rescan_reproduces. Default true. */
  rescan?: boolean;
  only?: string;
}

export const repoSlug = (repo: string): string => repo.replace('/', '__');

export function runExampleBatch(opts: BatchOptions, deps: BatchDeps): BatchState {
  mkdirSync(opts.outDir, { recursive: true });
  const statePath = join(opts.outDir, 'batch-state.json');
  const runPath = join(opts.outDir, 'run.json');
  const state: BatchState = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as BatchState) : { batch_version: EXAMPLE_BATCH_VERSION, batch: opts.batch, as_of: opts.asOf, repos: {} };
  if (state.batch !== opts.batch || state.as_of !== opts.asOf) {
    // A different batch or clock is a different run; never mix their outputs.
    throw new Error(`${statePath} belongs to batch ${state.batch} as of ${state.as_of}; use a new --out for ${opts.batch} as of ${opts.asOf}`);
  }
  const save = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  save();
  writeFileSync(runPath, `${JSON.stringify({ batch_version: EXAMPLE_BATCH_VERSION, batch: opts.batch, as_of: opts.asOf, ...opts.runInfo }, null, 2)}\n`);

  const roles = new Set(opts.roles ?? ['primary']);
  const eligible = new Map(opts.probe.results.map((r) => [r.repo.toLowerCase(), r.eligible]));
  const targets = opts.manifest.candidates.filter((c) => c.batch === opts.batch && roles.has(c.role) && (!opts.only || c.repo === opts.only));
  const stamp = () => new Date(deps.now()).toISOString();

  for (const candidate of targets) {
    const repo = candidate.repo;
    const rs: RepoState = (state.repos[repo] ??= { repo, role: candidate.role, steps: {} });
    if (eligible.get(repo.toLowerCase()) !== true || opts.exclusion.has(repo)) {
      deps.log(`skip ${repo}: not eligible in the probe`);
      save();
      continue;
    }
    const dir = join(opts.outDir, repoSlug(repo));
    mkdirSync(dir, { recursive: true });
    const paths = { scan: join(dir, 'report.json'), rescan: join(dir, 'rescan.json'), review: join(dir, 'review.json') };

    for (const step of opts.rescan === false ? (['scan'] as const) : (['scan', 'rescan'] as const)) {
      if (!opts.force && rs.steps[step]?.status === 'done' && existsSync(paths[step])) continue;
      waitForRateLimit(deps, opts.minRateRemaining ?? 500);
      deps.log(`${step} ${repo}`);
      const started = deps.now();
      const result = deps.runScan(repo, opts.asOf, paths[step]);
      const ok = result.exitCode === 0 && existsSync(paths[step]);
      rs.steps[step] = { status: ok ? 'done' : 'failed', wall_ms: deps.now() - started, exit_code: result.exitCode, at: stamp(), ...(ok ? {} : { detail: result.stderrTail.slice(-400) }) };
      save();
      if (!ok) break;
    }
    rs.steps.score = { status: 'unavailable', detail: 'out-of-sample scoring is HOK-2826', at: stamp() };
    rs.steps.render = { status: 'unavailable', detail: 'the report section is HOK-2828', at: stamp() };

    if (rs.steps.scan?.status === 'done') {
      const started = deps.now();
      const read = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined);
      const review = reviewExampleReport({ report: read(paths.scan), rescan: read(paths.rescan), expectedRepo: repo, exclusion: opts.exclusion, expectedVersions: { scanner: opts.versions.scanner } });
      writeFileSync(paths.review, `${JSON.stringify(review, null, 2)}\n`);
      rs.steps.review = { status: 'done', wall_ms: deps.now() - started, at: stamp() };
      rs.review = { passed: review.passed, borderline: review.borderline, borderline_reasons: review.borderline_reasons, failed: review.checks.filter((c) => !c.passed).map((c) => c.code) };
    }
    save();
  }
  return state;
}

function waitForRateLimit(deps: BatchDeps, minRemaining: number): void {
  const limit = deps.rateLimit();
  if (!limit || limit.remaining >= minRemaining) return;
  const waitMs = Math.max(0, limit.resetAt - deps.now()) + 5_000;
  deps.log(`rate limit: ${limit.remaining} left, waiting ${Math.ceil(waitMs / 1000)}s for the reset`);
  deps.sleep(waitMs);
}
