import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { projectSurvivalLabel, type ArbiterReportV1, type HorizonDays, type ReportPolicy } from '@hokusai/core';
import { buildReportDraft } from '../report/build.js';
import { attributePullRequest, resolveAttributionConfig, toReportAttribution, type AttributionConfig } from '../attribution/engine.js';
import { enumerateWindow } from './enumerate.js';
import type { ScanGitHubClient } from './github.js';
import type { GitRunner, SurvivalLabellerDeps, SurvivalLabellerTarget } from '../survival-labeller.js';
import { labelMergedPr, type MergedPrRef } from '../survival-labeller.js';
import { extractCandidateFeatures, type CandidateFeaturesV1 } from '../candidate-features.js';
import { NULL_STATIC_FEATURES } from '../shadow/scorer.js';
import { isAncestor } from '../shadow/discover.js';
import { SCAN_CONTRACT } from '../contract.js';
import { ScanUpstreamError } from '../default-deps.js';
import { readScanState, writeScanState, type ScanStateVersions } from './state.js';

export interface ScanReportDeps {
  runGit: GitRunner; github: ScanGitHubClient; labeller: SurvivalLabellerDeps; now: () => Date;
  onDiagnostic?: (line: string) => void;
  /** Test seam for extraction; production creates and removes a detached checkout per merge. */
  extract?: (merge: { mergeSha: string; parentSha: string; prNumber: number }, contract: { taskText: string }) => CandidateFeaturesV1;
  label?: (target: SurvivalLabellerTarget, deps: SurvivalLabellerDeps, ref: MergedPrRef, options: { horizons: HorizonDays[]; allMergedPrs: MergedPrRef[] }) => ReturnType<typeof labelMergedPr>;
}
export interface RunReportScanOptions {
  lookbackDays?: number; maxLookbackDays?: number; maxPrs?: number; horizons?: HorizonDays[];
  attributionConfig?: AttributionConfig; staticAnalysis?: 'off' | 'committed'; policy?: ReportPolicy; scannerVersion: string; stateDir?: string;
}
export type ScanReportTarget = SurvivalLabellerTarget;

/** Raised when continuing per-PR failures would make the report misleading. */
export class ScanStageFailureError extends Error {
  constructor() { super('STAGE_FAILURE_THRESHOLD'); this.name = 'ScanStageFailureError'; }
}

/** Dependency-injected scan orchestration; raw GitHub text is consumed in memory and never returned. */
export async function runReportScan(target: ScanReportTarget, deps: ScanReportDeps, options: RunReportScanOptions) {
  const now = deps.now();
  const maxLookback = options.maxLookbackDays ?? 730;
  const requested = options.lookbackDays ?? 180;
  const lookbackDays = Math.max(1, Math.min(requested, maxLookback));
  if (requested > maxLookback) deps.onDiagnostic?.(`warn: lookback clamped to ${maxLookback} days`);
  const maxPrs = options.maxPrs ?? 500;
  const from = new Date(now.getTime() - lookbackDays * 86_400_000);
  const stateVersions: ScanStateVersions = { scannerVersion: options.scannerVersion, labellerVersion: SCAN_CONTRACT.labellerVersion, normalizationVersion: SCAN_CONTRACT.normalizationVersion, integrationBranch: target.integrationBranch, config: { horizons: options.horizons ?? [14, 30, 60], attributionConfig: options.attributionConfig ?? {}, staticAnalysis: options.staticAnalysis ?? 'off', features: ['candidate_features/v1'] } };
  const cached = options.stateDir ? readScanState(options.stateDir, stateVersions, (sha) => isAncestor(deps.runGit, sha, target.integrationBranch)) : null;
  if (cached?.invalidated) deps.onDiagnostic?.('info: incremental cache invalidated; performing a full rescan');
  const enumerated = enumerateWindow({ runGit: deps.runGit, branch: target.integrationBranch, from, to: now, cursor: cached?.header?.last_seen_merge_sha ?? null, maxPrs: maxPrs + 1 });
  let merges = enumerated.merges;
  if (merges.length > maxPrs) { merges = merges.slice(-maxPrs); deps.onDiagnostic?.(`warn: capped report at newest ${maxPrs} PRs`); }
  const allLocal = enumerateWindow({ runGit: deps.runGit, branch: target.integrationBranch, from: new Date(0), to: now }).merges;
  const config = resolveAttributionConfig(options.attributionConfig);
  const reportRows = new Map<number, ArbiterReportV1['prs'][number]>((cached?.rows ?? []).flatMap((row) => {
    const mergedAt = new Date(row.merged_at).getTime();
    return Number.isFinite(mergedAt) && mergedAt >= from.getTime() && mergedAt <= now.getTime()
      ? [{ pr_number: row.pr_number, merged_at: row.merged_at, attribution: row.attribution, features: row.features, labels: Object.values(row.labels_by_horizon), cost: null, prediction: null }]
      : [];
  }).map((row) => [row.pr_number, row]));
  const cachedBySha = new Map((cached?.rows ?? []).map((row) => [row.merge_sha, row]));
  const stateBySha = new Map((cached?.rows ?? []).map((row) => [row.merge_sha, row]));
  const horizons = options.horizons ?? [14, 30, 60];
  const label = deps.label ?? labelMergedPr;
  const labellerTarget = { owner: target.owner, repo: target.repo, repoDir: target.repoDir, integrationBranch: target.integrationBranch };
  const refs: MergedPrRef[] = allLocal.flatMap((merge) => merge.prNumber === null ? [] : [{
    prNumber: merge.prNumber, prUrl: `https://github.com/${target.owner}/${target.repo}/pull/${merge.prNumber}`,
    mergeSha: merge.mergeSha, parentSha: merge.parentSha, headSha: merge.headSha,
    mergedAtEpoch: merge.mergedAtEpoch, subject: `#${merge.prNumber}`,
  }]);
  const refBySha = new Map(refs.map((ref) => [ref.mergeSha, ref]));
  let failedPrs = 0;
  const attemptedPrs = merges.filter((merge) => merge.prNumber !== null).length;
  for (const merge of merges) {
    if (merge.prNumber === null) { deps.onDiagnostic?.('info: skipped commit without a PR number'); continue; }
    try {
    const previous = cachedBySha.get(merge.mergeSha);
    let prNumber = merge.prNumber;
    let mergedAt: string;
    let attribution: ArbiterReportV1['prs'][number]['attribution'];
    let features: CandidateFeaturesV1;
    if (previous) {
      prNumber = previous.pr_number;
      mergedAt = previous.merged_at;
      attribution = previous.attribution;
      features = previous.features;
    } else {
      const apiPr = await deps.github.getPullRequest(merge.prNumber);
      if (!apiPr && !deps.github.offline) { deps.onDiagnostic?.(`warn: GitHub could not find PR #${merge.prNumber}; skipped`); continue; }
      const pr = apiPr ?? { number: merge.prNumber, title: '', body: null, authorLogin: null, authorType: null, headRef: '', headSha: merge.headSha, labels: [], mergedAt: new Date(merge.mergedAtEpoch * 1000).toISOString() };
      const commits = deps.github.offline ? deps.runGit(['log', '--format=%B', `${merge.parentSha}..${merge.mergeSha}`]).stdout.split('\n\n').filter(Boolean) : await deps.github.listPullCommits(pr.number);
      attribution = toReportAttribution(attributePullRequest({ ...pr, commitMessages: commits }, config));
      mergedAt = pr.mergedAt;
      if (deps.extract) {
        features = deps.extract({ ...merge, prNumber: merge.prNumber }, { taskText: `${pr.title}\n\n${pr.body ?? ''}` });
      } else {
        const checkoutParent = fs.mkdtempSync(path.join(os.tmpdir(), 'hokusai-scan-report-'));
        const checkoutDir = path.join(checkoutParent, 'checkout');
        try {
          const add = deps.runGit(['worktree', 'add', '--detach', '--no-checkout', checkoutDir, merge.mergeSha]);
          if (add.exitCode !== 0) throw new Error('Unable to prepare PR checkout');
          for (const args of [['-C', checkoutDir, 'update-ref', 'HEAD', merge.mergeSha], ['-C', checkoutDir, 'checkout', '-f']]) {
            if (deps.runGit(args).exitCode !== 0) throw new Error('Unable to check out PR merge');
          }
          features = extractCandidateFeatures({ checkoutDir, prNumber: pr.number, baseRef: merge.parentSha, offline: true,
            staticFeatures: options.staticAnalysis === 'off' ? NULL_STATIC_FEATURES : undefined,
            contract: { taskText: `${pr.title}\n\n${pr.body ?? ''}` },
          });
        } finally {
          deps.runGit(['worktree', 'remove', '--force', checkoutDir]);
          fs.rmSync(checkoutParent, { recursive: true, force: true });
        }
      }
      await deps.github.getCheckConclusion(pr.headSha);
    }
    const ref = refBySha.get(merge.mergeSha)!;
    const labelCache = previous?.labels_by_horizon ?? {};
    const labelsByHorizon = new Map<number, ReturnType<typeof projectSurvivalLabel>>();
    for (const horizon of horizons) {
      const old = labelCache[String(horizon)];
      const matured = merge.mergedAtEpoch + horizon * 86_400 <= Math.floor(now.getTime() / 1000);
      if (old && matured && !old.outcome.reason_codes.includes('missing_horizon')) labelsByHorizon.set(horizon, old);
    }
    if (horizons.some((horizon) => !labelsByHorizon.has(horizon))) {
      const fresh = label(labellerTarget, deps.labeller, ref, { horizons, allMergedPrs: refs }).map(projectSurvivalLabel);
      for (const item of fresh) {
        const old = labelCache[String(item.horizon_days)];
        const matured = merge.mergedAtEpoch + item.horizon_days * 86_400 <= Math.floor(now.getTime() / 1000);
        labelsByHorizon.set(item.horizon_days, old && matured && !old.outcome.reason_codes.includes('missing_horizon') ? old : item);
      }
    }
    const labels = horizons.map((horizon) => labelsByHorizon.get(horizon)).filter((item): item is ReturnType<typeof projectSurvivalLabel> => !!item);
    const reportRow: ArbiterReportV1['prs'][number] = { pr_number: prNumber, merged_at: mergedAt, attribution, features, labels, cost: null, prediction: null };
    reportRows.set(reportRow.pr_number, reportRow);
    stateBySha.set(merge.mergeSha, { merge_sha: merge.mergeSha, pr_number: prNumber, merged_at: mergedAt, attribution, features, labels_by_horizon: Object.fromEntries(labels.map((item) => [String(item.horizon_days), item])) });
    } catch (error) {
      if (error instanceof ScanUpstreamError) throw error;
      failedPrs++;
      deps.onDiagnostic?.(`error: failed to process PR #${merge.prNumber}`);
    }
  }
  if (attemptedPrs > 0 && failedPrs / attemptedPrs > 0.1) throw new ScanStageFailureError();
  if (options.stateDir) {
    const lastSeen = allLocal.at(-1)?.mergeSha ?? null;
    writeScanState(options.stateDir, stateVersions, lastSeen, [...stateBySha.values()]);
  }
  const rows = [...reportRows.values()];
  const dates = rows.map((pr) => pr.merged_at).sort();
  return buildReportDraft({
    owner: target.owner, repo: target.repo, integrationBranch: target.integrationBranch,
    scannerVersion: options.scannerVersion, scannedAt: now.toISOString(), asOf: now.toISOString(), lookbackDays,
    mergedFrom: dates[0] ?? from.toISOString(), mergedTo: now.toISOString(), horizons, prs: rows, ...(options.policy ? { policy: options.policy } : {}),
  });
}
