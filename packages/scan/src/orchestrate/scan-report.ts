import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectSurvivalLabel, type ArbiterReportV1, type CandidateFeaturesV1, type ReportPolicy, type SurvivalLabelProjectionV1 } from '@hokusai/core';
import { attributePullRequest, toReportAttribution, type AttributionConfig } from '../attribution/index.js';
import { extractCandidateFeatures, type CandidateFeaturesOptions } from '../candidate-features.js';
import { NULL_STATIC_FEATURES } from '../shadow/scorer.js';
import { GIT_OUTPUT_MAX_BUFFER, SURVIVAL_LABELLER_VERSION, SURVIVAL_NORMALIZATION_VERSION, enumerateMergedPrs, labelMergedPr, type GitRunner, type SurvivalGitHubClient } from '../survival-labeller.js';
import { execArgvCommand } from '../shell-utils.js';
import { ScanUpstreamError } from '../default-deps.js';
import { buildReportDraft, emitReport } from '../report/build.js';
import { enumerateWindow } from './enumerate.js';
import { configHash, readScanState, writeScanState, type CachedPr } from './state.js';
import type { ScanGitHubClient } from './github.js';

export interface ReportScanTarget { owner: string; repo: string; repoDir: string; integrationBranch: string }
export interface ReportScanDeps {
  runGit: GitRunner;
  github: ScanGitHubClient;
  labellerGithub: SurvivalGitHubClient;
  now: () => Date;
  onDiagnostic?: (line: string) => void;
  extract?: (options: CandidateFeaturesOptions) => CandidateFeaturesV1;
  label?: typeof labelMergedPr;
  makeGitRunner?: (dir: string) => GitRunner;
}
export interface ReportScanOptions {
  lookbackDays?: number;
  maxLookbackDays?: number;
  maxPrs?: number;
  horizons?: ArbiterReportV1['scan']['horizons_days'];
  attributionConfig?: AttributionConfig;
  staticAnalysis?: 'off' | 'committed';
  stateDir?: string;
  offline?: boolean;
  policy?: ReportPolicy;
  scannerVersion: string;
}
export interface ReportScanResult { report: ArbiterReportV1; json: string; stats: { reused: number; added: number; relabelled: number; skipped: number } }
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

export function runReportScan(target: ReportScanTarget, deps: ReportScanDeps, opts: ReportScanOptions): ReportScanResult {
  const asOf = deps.now();
  const lookback = Math.min(opts.lookbackDays ?? 180, opts.maxLookbackDays ?? 730);
  if (!Number.isInteger(lookback) || lookback < 1) throw new RangeError('lookbackDays must be positive');
  if (lookback !== (opts.lookbackDays ?? 180)) deps.onDiagnostic?.(`warn: lookback clamped to ${lookback} days`);
  const from = new Date(asOf.getTime() - lookback * 86_400_000);
  const horizons = opts.horizons ?? [14, 30, 60];
  const maxPrs = opts.maxPrs ?? 500;
  const expected = { scanner_version: opts.scannerVersion, labeller_version: SURVIVAL_LABELLER_VERSION, normalization_version: SURVIVAL_NORMALIZATION_VERSION, config_hash: configHash({ horizons, attributionConfig: opts.attributionConfig ?? {}, staticAnalysis: opts.staticAnalysis ?? 'off' }), integration_branch: target.integrationBranch };
  const cache = opts.stateDir ? readScanState(opts.stateDir, expected, deps.runGit) : null;
  const discovered = enumerateWindow({ runGit: deps.runGit, branch: target.integrationBranch, owner: target.owner, repo: target.repo, from, asOf, cursor: cache?.state.last_seen_merge_sha ?? null });
  const cached = cache && !discovered.cursorReset ? cache.prs.filter((entry) => new Date(entry.row.merged_at).getTime() >= from.getTime()) : [];
  const bySha = new Map<string, CachedPr>(cached.map((entry) => [entry.merge_sha, entry]));
  for (const merge of discovered.merges) if (!bySha.has(merge.mergeSha)) bySha.set(merge.mergeSha, { merge_sha: merge.mergeSha, row: null as unknown as CachedPr['row'] });
  const mergeEpoch = new Map(discovered.merges.map((merge) => [merge.mergeSha, merge.mergedAtEpoch]));
  const selected = [...bySha.values()].sort((a, b) => (a.row ? new Date(a.row.merged_at).getTime() / 1000 : mergeEpoch.get(a.merge_sha) ?? 0) - (b.row ? new Date(b.row.merged_at).getTime() / 1000 : mergeEpoch.get(b.merge_sha) ?? 0)).slice(-maxPrs).map((entry) => entry.merge_sha);
  if (bySha.size > maxPrs) deps.onDiagnostic?.(`warn: PR cap applied (${maxPrs})`);
  const selectedSet = new Set(selected);
  const merges = discovered.merges.filter((merge) => selectedSet.has(merge.mergeSha));
  const fullMerged = enumerateMergedPrs({ ...target }, { runGit: deps.runGit, github: deps.labellerGithub, now: deps.now }, { maxCount: 100_000 });
  const refBySha = new Map(fullMerged.map((ref) => [ref.mergeSha, ref]));
  const worktree = mkdtempSync(join(tmpdir(), 'hokusai-report-'));
  const git = deps.makeGitRunner?.(worktree) ?? ((args) => execArgvCommand('git', ['-C', worktree, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER, stdio: 'pipe' }));
  const worktreeResult = deps.runGit(['worktree', 'add', '--detach', '--no-checkout', worktree, target.integrationBranch]);
  if (worktreeResult.exitCode !== 0) { rmSync(worktree, { recursive: true, force: true }); throw new Error(`Cannot create report worktree: ${worktreeResult.stderr}`); }
  let reused = 0, added = 0, relabelled = 0, failed = 0;
  try {
    const newlyLabelled = new Set<string>();
    for (const merge of merges) {
      const ref = refBySha.get(merge.mergeSha) ?? merge;
      const existing = bySha.get(merge.mergeSha);
      if (existing?.row) { reused++; continue; }
      try {
        const pr = deps.github.getPullRequest(ref.prNumber) ?? (opts.offline ? { number: ref.prNumber, title: '', body: null, authorLogin: null, authorType: null, headRef: null, headSha: ref.headSha, labels: [], mergedAt: iso(ref.mergedAtEpoch) } : null);
        if (!pr) { deps.onDiagnostic?.(`warn: PR #${ref.prNumber} unavailable`); bySha.delete(merge.mergeSha); continue; }
        const messages = opts.offline ? [deps.runGit(['show', '-s', '--format=%B', ref.mergeSha]).stdout] : deps.github.listPullCommits(ref.prNumber);
        deps.github.getCheckConclusion(pr.headSha);
        const update = git(['update-ref', '--no-deref', 'HEAD', ref.mergeSha]);
        if (update.exitCode !== 0) throw new Error(`Cannot select merge ${ref.mergeSha}`);
        const checkout = git(['checkout', '-f']);
        if (checkout.exitCode !== 0) throw new Error(`Cannot checkout merge ${ref.mergeSha}`);
        const features = (deps.extract ?? extractCandidateFeatures)({ checkoutDir: worktree, prNumber: ref.prNumber, baseRef: ref.parentSha, offline: true, staticFeatures: opts.staticAnalysis === 'committed' ? undefined : NULL_STATIC_FEATURES, contract: { taskText: `${pr.title}\n\n${pr.body ?? ''}`.slice(0, 100_000) } });
        const labels = (deps.label ?? labelMergedPr)(target, { runGit: deps.runGit, github: deps.labellerGithub, now: deps.now, onDiagnostic: deps.onDiagnostic }, ref, { horizons, allMergedPrs: fullMerged }).map(projectSurvivalLabel);
        bySha.set(merge.mergeSha, { merge_sha: merge.mergeSha, row: { pr_number: ref.prNumber, merged_at: iso(ref.mergedAtEpoch), attribution: toReportAttribution(attributePullRequest({ number: ref.prNumber, authorLogin: pr.authorLogin, authorType: pr.authorType, headRef: pr.headRef, labels: pr.labels, mergedAt: pr.mergedAt, commitMessages: messages, body: pr.body, headSha: pr.headSha }, opts.attributionConfig), opts.attributionConfig), features, labels, cost: null, prediction: null } });
        added++; newlyLabelled.add(ref.mergeSha);
      } catch (error) {
        if (error instanceof ScanUpstreamError) throw error;
        failed++;
        bySha.delete(merge.mergeSha);
        deps.onDiagnostic?.(`error: PR #${ref.prNumber} could not be extracted or labelled`);
      }
    }
    for (const [sha, entry] of bySha) {
      if (!selectedSet.has(sha) || !entry.row || newlyLabelled.has(sha)) continue;
      const ref = refBySha.get(sha);
      if (!ref) continue;
      const immature = entry.row.labels.filter((label) => label.outcome.report_outcome === null || ref.mergedAtEpoch * 1000 + label.horizon_days * 86_400_000 > asOf.getTime());
      if (immature.length === 0) continue;
      try {
        const fresh = (deps.label ?? labelMergedPr)(target, { runGit: deps.runGit, github: deps.labellerGithub, now: deps.now, onDiagnostic: deps.onDiagnostic }, ref, { horizons: immature.map((label) => label.horizon_days), allMergedPrs: fullMerged }).map(projectSurvivalLabel);
        const updated = new Map<number, SurvivalLabelProjectionV1>(entry.row.labels.map((label) => [label.horizon_days, label]));
        for (const label of fresh) updated.set(label.horizon_days, label);
        entry.row.labels = horizons.map((h) => updated.get(h)!);
        relabelled += fresh.length;
      } catch (error) {
        if (error instanceof ScanUpstreamError) throw error;
        failed++;
        bySha.delete(sha);
        deps.onDiagnostic?.(`error: PR #${ref.prNumber} could not be relabelled`);
      }
    }
  } finally {
    deps.runGit(['worktree', 'remove', '--force', worktree]);
    rmSync(worktree, { recursive: true, force: true });
  }
  const finalEntries = [...bySha.values()].filter((entry) => selectedSet.has(entry.merge_sha) && entry.row);
  const mergedFrom = finalEntries.length ? new Date(Math.min(...finalEntries.map((entry) => new Date(entry.row.merged_at).getTime()))) : from;
  const { report, json } = emitReport(buildReportDraft({ owner: target.owner, repo: target.repo, integrationBranch: target.integrationBranch, asOf, lookbackDays: lookback, mergedFrom, horizons, rows: finalEntries.map((entry) => entry.row), scannerVersion: opts.scannerVersion }), opts.policy);
  // A pinned historical clock may be earlier than the branch tip. Advancing
  // the cursor to that future tip would permanently skip merges on the next
  // scan. Keep it at the latest merge actually inside this run's window.
  const lastSeen = discovered.merges.at(-1)?.mergeSha ?? cache?.state.last_seen_merge_sha;
  if (opts.stateDir && lastSeen && failed === 0) writeScanState(opts.stateDir, { state_version: 1, ...expected, last_seen_merge_sha: lastSeen }, finalEntries);
  deps.onDiagnostic?.(`info: scanned ${finalEntries.length} PRs; failed ${failed}`);
  return { report, json, stats: { reused, added, relabelled, skipped: discovered.skipped } };
}
