import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
import { DEFAULT_REPORT_POLICY, applyReportSuppression } from '../report/suppression.js';
import { runExampleBatch, type BatchDeps, type BatchOptions } from './batch.js';
import { TrainingExclusion, type ExampleManifest } from './select.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const manifest = {
  manifest_version: '0.1.0',
  issue: 'HOK-3515',
  exclude_corpus_manifests: ['x'],
  window_days: 365,
  horizon_days: 30,
  thresholds: { min_merged_prs_per_year: 0, min_base_is_default_share: 0, min_pr_mapped_commit_share: 0, min_revert_prs_per_year: 20, min_agent_share: 0, supported_conventions: ['squash'] },
  candidates: [
    { repo: 'acme/one', batch: 'b1', role: 'primary' },
    { repo: 'acme/two', batch: 'b1', role: 'primary' },
    { repo: 'acme/spare', batch: 'b1', role: 'swap' },
    { repo: 'other/batch', batch: 'b2', role: 'primary' },
  ],
} as ExampleManifest;

/** A descriptive scan with no retrospective: what the batch produces before scoring exists. */
function payload(repo: string): string {
  const d = reportDraftFixtures.full();
  d.data_origin = 'scan';
  const [owner, name] = repo.split('/');
  d.repo = { host: 'github', owner: owner!, name: name! };
  d.scan.scanner.version = '9.9.9';
  return JSON.stringify(applyReportSuppression(d, DEFAULT_REPORT_POLICY));
}

function harness(over: Partial<BatchDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  let clock = 1_000_000;
  const deps: BatchDeps = {
    runScan: (repo, _asOf, out) => {
      calls.push(repo);
      writeFileSync(out, payload(repo));
      clock += 1_000;
      return { exitCode: 0, stderrTail: '' };
    },
    rateLimit: () => ({ remaining: 5_000, resetAt: 0 }),
    sleep: () => undefined,
    now: () => clock,
    log: (l) => logs.push(l),
    ...over,
  };
  const outDir = mkdtempSync(join(tmpdir(), 'example-batch-'));
  dirs.push(outDir);
  const opts: BatchOptions = {
    manifest,
    probe: { as_of: '2026-11-19T00:00:00.000Z', results: [{ repo: 'acme/one', eligible: true }, { repo: 'acme/two', eligible: false }, { repo: 'acme/spare', eligible: true }] },
    batch: 'b1',
    outDir,
    asOf: '2026-11-19T00:00:00.000Z',
    exclusion: new TrainingExclusion(),
    versions: { scanner: '9.9.9' },
    runInfo: { model: null },
  };
  return { calls, logs, deps, opts, outDir };
}

describe('runExampleBatch', () => {
  it('scans and re-scans eligible primaries only, and review blocks an unscored report', () => {
    const h = harness();
    const state = runExampleBatch(h.opts, h.deps);
    expect(h.calls).toEqual(['acme/one', 'acme/one']);
    const one = state.repos['acme/one']!;
    expect(one.steps.scan).toMatchObject({ status: 'done', wall_ms: 1000 });
    expect(one.steps.score?.status).toBe('unavailable');
    expect(one.review?.passed).toBe(false);
    expect(one.review?.failed).toContain('retrospective_present');
    expect(one.review?.failed).not.toContain('rescan_reproduces');
    expect(h.logs).toContain('skip acme/two: not eligible in the probe');
    expect(JSON.parse(readFileSync(join(h.outDir, 'run.json'), 'utf8'))).toMatchObject({ batch: 'b1', model: null });
  });

  it('resumes without re-running finished scans', () => {
    const h = harness();
    runExampleBatch(h.opts, h.deps);
    runExampleBatch(h.opts, h.deps);
    expect(h.calls).toEqual(['acme/one', 'acme/one']);
    runExampleBatch({ ...h.opts, force: true }, h.deps);
    expect(h.calls).toHaveLength(4);
  });

  it('runs swaps only when asked', () => {
    const h = harness();
    runExampleBatch({ ...h.opts, roles: ['primary', 'swap'] }, h.deps);
    expect(h.calls).toEqual(['acme/one', 'acme/one', 'acme/spare', 'acme/spare']);
  });

  it('records a failed scan and skips its re-scan', () => {
    const h = harness({ runScan: (repo) => (h.calls.push(repo), { exitCode: 3, stderrTail: 'error: clone failed' }) });
    const state = runExampleBatch(h.opts, h.deps);
    expect(state.repos['acme/one']!.steps.scan).toMatchObject({ status: 'failed', exit_code: 3, detail: 'error: clone failed' });
    expect(state.repos['acme/one']!.steps.rescan).toBeUndefined();
    expect(state.repos['acme/one']!.review).toBeUndefined();
  });

  it('waits for the rate-limit reset when the budget is low', () => {
    const slept: number[] = [];
    const h = harness({ rateLimit: () => ({ remaining: 10, resetAt: 1_060_000 }), sleep: (ms) => slept.push(ms) });
    runExampleBatch(h.opts, h.deps);
    expect(slept[0]).toBe(65_000);
  });

  it('refuses to mix batches or clocks in one output directory', () => {
    const h = harness();
    runExampleBatch(h.opts, h.deps);
    expect(() => runExampleBatch({ ...h.opts, asOf: '2026-12-01T00:00:00.000Z' }, h.deps)).toThrow(/new --out/);
  });

  it('never scans a corpus repo even if the probe says eligible', () => {
    const h = harness();
    runExampleBatch({ ...h.opts, exclusion: new TrainingExclusion().addCorpusManifest({ repos: [{ repo: 'acme/one' }] }) }, h.deps);
    expect(h.calls).toEqual([]);
  });
});
