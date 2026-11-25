/**
 * `example-*` commands (HOK-3515).
 *
 *   example-review --report <json> --repo <owner/name> --manifest <example manifest>
 *                  [--rescan <json>] [--page <html>] [--out <json>]
 *     Exit 0 when every check passes, 1 when any fails, 2 on bad input.
 *
 *   example-batch  --manifest <example manifest> --probe <probe.json> --batch <name>
 *                  --out <dir> [--as-of <iso>] [--roles primary,swap] [--repo <owner/name>] [--force] [--no-rescan]
 *     Scans, re-scans and reviews every eligible repo of the batch. Resumable.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SCAN_CONTRACT } from '../contract.js';
import { DEFAULT_REPORT_POLICY } from '../report/suppression.js';
import { SCAN_VERSION } from '../version.js';
import { runExampleBatch } from './batch.js';
import { htmlToText, reviewExampleReport } from './review.js';
import { TrainingExclusion, parseExampleManifest, type ExampleManifest } from './select.js';

/** A hung clone or API call must not stall an unattended batch; above the 2-hour rate-limit wait. */
const SCAN_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export const EXAMPLE_COMMANDS = ['example-review', 'example-batch'] as const;

export interface ExampleCliIO {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const OPTIONS = {
  report: { type: 'string' },
  rescan: { type: 'string' },
  page: { type: 'string' },
  repo: { type: 'string' },
  manifest: { type: 'string' },
  probe: { type: 'string' },
  batch: { type: 'string' },
  out: { type: 'string' },
  'as-of': { type: 'string' },
  roles: { type: 'string' },
  force: { type: 'boolean' },
  'no-rescan': { type: 'boolean' },
} as const;

const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

/** Corpus manifest paths are repo-relative; resolve them from the example manifest's checkout. */
function loadExclusion(manifest: ExampleManifest, manifestPath: string): TrainingExclusion {
  const ex = new TrainingExclusion();
  let root = dirname(manifestPath);
  for (let i = 0; i < 6 && !manifest.exclude_corpus_manifests.every((rel) => existsSync(resolve(root, rel))); i++) root = dirname(root);
  for (const rel of manifest.exclude_corpus_manifests) ex.addCorpusManifest(readJson(resolve(root, rel)) as { repos: { repo: string }[]; alternates: { repo: string }[] });
  return ex;
}

export function runExampleCli(command: string, argv: readonly string[], io: ExampleCliIO): { exitCode: number } {
  if (!(EXAMPLE_COMMANDS as readonly string[]).includes(command)) {
    io.writeStderr(`error: unknown command ${command}; expected one of ${EXAMPLE_COMMANDS.join(', ')}\n`);
    return { exitCode: 2 };
  }
  let values: Partial<Record<keyof typeof OPTIONS, string | boolean>>;
  let manifest: ExampleManifest;
  let manifestPath: string;
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }));
    if (typeof values.manifest !== 'string') throw new Error(`${command} needs --manifest <example manifest>`);
    manifestPath = resolve(io.cwd, values.manifest);
    manifest = parseExampleManifest(readJson(manifestPath), DEFAULT_REPORT_POLICY.min_reworked_for_retrospective);
  } catch (error) {
    io.writeStderr(`error: ${(error as Error).message}\n`);
    return { exitCode: 2 };
  }
  const exclusion = loadExclusion(manifest, manifestPath);
  const path = (k: keyof typeof OPTIONS) => (typeof values[k] === 'string' ? resolve(io.cwd, values[k]) : undefined);

  if (command === 'example-review') {
    const reportPath = path('report');
    if (!reportPath || typeof values.repo !== 'string') {
      io.writeStderr('error: example-review needs --report <json> and --repo <owner/name>\n');
      return { exitCode: 2 };
    }
    const rescanPath = path('rescan');
    const pagePath = path('page');
    const result = reviewExampleReport({
      report: readJson(reportPath),
      expectedRepo: values.repo,
      exclusion,
      ...(rescanPath ? { rescan: readJson(rescanPath) } : {}),
      ...(pagePath ? { pageText: htmlToText(readFileSync(pagePath, 'utf8')) } : {}),
      expectedVersions: { scanner: SCAN_VERSION },
    });
    const out = `${JSON.stringify(result, null, 2)}\n`;
    const outPath = path('out');
    if (outPath) writeFileSync(outPath, out);
    else io.writeStdout(out);
    for (const c of result.checks) io.writeStderr(`${c.passed ? 'pass' : 'FAIL'} ${c.code}${c.detail ? `: ${c.detail}` : ''}\n`);
    io.writeStderr(`${result.passed ? (result.borderline ? 'PASSED (borderline: needs review)' : 'PASSED') : 'FAILED'}\n`);
    return { exitCode: result.passed ? 0 : 1 };
  }

  // example-batch
  const probePath = path('probe');
  const outDir = path('out');
  if (!probePath || !outDir || typeof values.batch !== 'string') {
    io.writeStderr('error: example-batch needs --probe <probe.json>, --batch <name> and --out <dir>\n');
    return { exitCode: 2 };
  }
  const probe = readJson(probePath) as { as_of: string; results: { repo: string; eligible: boolean }[] };
  const asOf = typeof values['as-of'] === 'string' ? new Date(values['as-of']).toISOString() : probe.as_of;
  const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));
  const env = { ...io.env };
  if (!env.GITHUB_TOKEN) {
    try {
      env.GITHUB_TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
    } catch {
      /* the scan reports the missing token itself */
    }
  }
  const state = runExampleBatch(
    {
      manifest,
      probe,
      batch: values.batch,
      roles: typeof values.roles === 'string' ? values.roles.split(',') : ['primary'],
      outDir,
      asOf,
      exclusion,
      versions: { scanner: SCAN_VERSION },
      runInfo: {
        scanner: { package: '@hokusai/scan', version: SCAN_VERSION },
        labeller_version: SCAN_CONTRACT.labellerVersion,
        normalization_version: SCAN_CONTRACT.normalizationVersion,
        report_policy: DEFAULT_REPORT_POLICY.policy_version,
        model: null,
        label_definition: null,
        manifest_sha256: sha256File(manifestPath),
        probe_sha256: sha256File(probePath),
      },
      force: values.force === true,
      rescan: values['no-rescan'] !== true,
      ...(typeof values.repo === 'string' ? { only: values.repo } : {}),
    },
    {
      // Example repos merge PRs into the default branch (the probe's base_is_default bar), so the scan runs in direct mode.
      // One large scan can spend most of an hour's REST budget, so scans wait out rate limits rather than lose their work.
      runScan: (repo, at, outPath) => {
        const r = spawnSync(process.execPath, [cliPath, 'report', repo, '--integration-mode', 'direct', '--as-of', at, '--out', outPath, '--no-state', '--wait-on-rate-limit'], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: SCAN_TIMEOUT_MS });
        if (r.error) return { exitCode: 1, stderrTail: `scan did not finish: ${r.error.message}` };
        return { exitCode: r.status ?? 1, stderrTail: (r.stderr ?? '').split('\n').slice(-5).join('\n') };
      },
      rateLimit: () => {
        try {
          const raw = execFileSync('gh', ['api', 'rate_limit'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          const r = (JSON.parse(raw) as { resources: Record<string, { remaining: number; reset: number }> }).resources;
          const tight = [r.core!, r.graphql!].sort((a, b) => a.remaining - b.remaining)[0]!;
          return { remaining: tight.remaining, resetAt: tight.reset * 1000 };
        } catch {
          return null;
        }
      },
      sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
      now: () => Date.now(),
      log: (line) => io.writeStderr(`${line}\n`),
    },
  );
  const rows = Object.values(state.repos).map((r) => {
    const t = (s?: { wall_ms?: number }) => (s?.wall_ms === undefined ? '–' : `${Math.round(s.wall_ms / 1000)}s`);
    return `| ${r.repo} | ${r.steps.scan?.status ?? '–'} ${t(r.steps.scan)} | ${r.steps.rescan?.status ?? '–'} ${t(r.steps.rescan)} | ${r.steps.score?.status ?? '–'} | ${r.review ? (r.review.passed ? (r.review.borderline ? 'pass (borderline)' : 'pass') : `fail: ${r.review.failed.join(', ')}`) : '–'} |`;
  });
  io.writeStdout(['| repo | scan | rescan | score | review |', '|---|---|---|---|---|', ...rows].join('\n') + '\n');
  return { exitCode: 0 };
}

