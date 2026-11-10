/**
 * `hokusai-scan corpus-features` (HOK-3023). Steps, per repo:
 *   ci        CI results on PR heads, first because older results may be expiring
 *   evidence  timestamped reviews, labels, renames, edits and commits
 *   extract   features.jsonl.gz and features.summary.json, offline and deterministic
 *   manifest  the run manifest over every repo's features, to --out
 *
 * `feature-evidence/` holds raw text and stays local. Rows and summaries carry only
 * derived values and hashes. Summaries hold counts rather than per-column rates,
 * so publishing one says nothing about a sealed repo.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REWORK_RISK_FEATURE_MANIFEST_VERSION, validateFeatureColumns, validateFeatureManifest, REWORK_RISK_FEATURE_MANIFEST } from '@hokusai/core';
import type { CohortRepo } from './manifest.js';
import type { CorpusPrRecord, GraphqlRunner } from './enumerate.js';
import { CI_CAPTURE_FROM, captureRepo, chunkNumbers, readCapturedBatch, type CapturedItem, type CaptureKind } from './feature-capture.js';
import { buildHistoryIndex, gitColumns, type HistoryIndex } from './feature-git.js';
import { MANIFEST_COLUMNS, extractPrFeatures, type CiEvidence, type FeatureRow, type PrEvidence } from './features.js';

export const FEATURE_STEPS = ['ci', 'evidence', 'extract', 'manifest'] as const;
export type FeatureStep = (typeof FEATURE_STEPS)[number];

export interface FeatureRunIO {
  writeStdout: (text: string) => void;
}

interface FeatureSummary {
  repo: string;
  manifest_version: string;
  prs: number;
  rows: number;
  failed_rows: number;
  rows_without_evidence: number;
  evidence_captured_from: string | null;
  evidence_captured_until: string | null;
  file: string;
  sha256: string;
  bytes: number;
}

export function readRecords(repoDir: string): CorpusPrRecord[] {
  // Features read titles and bodies from evidence at as_of, never from these current copies.
  return readFileSync(join(repoDir, 'prs.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => ({ ...(JSON.parse(line) as CorpusPrRecord), title: '', body: '' }));
}

/** Emails on the PR author's own commits. Null when the PR's commits are unknown. */
export function authorEmails(record: CorpusPrRecord, evidence: PrEvidence | null): string[] | null {
  if (!evidence) return null;
  const emails = evidence.commits.filter((commit) => commit.author_login !== null && commit.author_login === record.author_login && commit.author_email).map((commit) => commit.author_email!);
  return emails.length ? [...new Set(emails)] : null;
}

export function landingMessage(record: CorpusPrRecord, index: HistoryIndex): string | null {
  return record.batched ? null : index.landingMessages.get(record.merge_sha) ?? null;
}

export function extractRepo(repo: string, repoDir: string, writeRows: (path: string, rows: readonly FeatureRow[]) => void, log: (line: string) => void): FeatureSummary {
  const manifestErrors = validateFeatureManifest(REWORK_RISK_FEATURE_MANIFEST);
  const columnErrors = validateFeatureColumns(MANIFEST_COLUMNS, { allowSegments: true });
  if (manifestErrors.length || columnErrors.length) throw new Error(`manifest failed validation: ${[...manifestErrors, ...columnErrors][0]!.message}`);

  const statsPath = join(repoDir, 'enumeration.json');
  if (!existsSync(statsPath)) throw new Error('not enumerated yet; run corpus-enumerate first');
  const { branch } = JSON.parse(readFileSync(statsPath, 'utf8')) as { branch: string };
  const records = readRecords(repoDir);
  const byNumber = new Map(records.map((record) => [record.pr_number, record]));
  const gitDir = join(repoDir, 'repo.git');

  log(`info: ${repo}: indexing history`);
  const index = buildHistoryIndex(gitDir, `refs/heads/${branch}`, join(repoDir, '.feature-index'), new Set(records.map((record) => record.merge_sha)));

  const ciNumbers = records.filter((record) => record.merged_at >= CI_CAPTURE_FROM).map((record) => record.pr_number);
  const ci = new Map<number, CiEvidence>();
  for (const chunk of chunkNumbers(ciNumbers)) {
    for (const item of readCapturedBatch<CiEvidence>(repoDir, 'ci', chunk)?.items ?? []) if (item.value) ci.set(item.pr_number, item.value);
  }

  const rows: FeatureRow[] = [];
  let failed = 0;
  let withoutEvidence = 0;
  let capturedFrom: string | null = null;
  let capturedUntil: string | null = null;
  const chunks = chunkNumbers(records.map((record) => record.pr_number));
  chunks.forEach((chunk, position) => {
    const batch = readCapturedBatch<PrEvidence>(repoDir, 'evidence', chunk);
    if (batch) {
      if (!capturedFrom || batch.captured_at < capturedFrom) capturedFrom = batch.captured_at;
      if (!capturedUntil || batch.captured_at > capturedUntil) capturedUntil = batch.captured_at;
    }
    const items = new Map((batch?.items ?? []).map((item: CapturedItem<PrEvidence>) => [item.pr_number, item.value]));
    for (const number of chunk) {
      const record = byNumber.get(number)!;
      const evidence = items.get(number) ?? null;
      if (!evidence) withoutEvidence++;
      try {
        rows.push(extractPrFeatures({
          record,
          evidence,
          ci: ci.get(number) ?? null,
          landingMessage: landingMessage(record, index),
          git: gitColumns({ index, gitDir, record, authorEmails: authorEmails(record, evidence) }),
        }));
      } catch (error) {
        failed++;
        log(`warn: ${repo}: PR ${number}: ${(error as Error).message.slice(0, 160)}`);
      }
    }
    if (position % 200 === 0) log(`info: ${repo}: extracted ${rows.length}/${records.length}`);
  });

  const path = join(repoDir, 'features.jsonl.gz');
  writeRows(path, rows);
  const bytes = readFileSync(path);
  const summary: FeatureSummary = {
    repo,
    manifest_version: REWORK_RISK_FEATURE_MANIFEST_VERSION,
    prs: records.length,
    rows: rows.length,
    failed_rows: failed,
    rows_without_evidence: withoutEvidence,
    evidence_captured_from: capturedFrom,
    evidence_captured_until: capturedUntil,
    file: 'features.jsonl.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
  writeFileSync(join(repoDir, 'features.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function runCorpusFeatures(input: {
  step: FeatureStep;
  entries: readonly CohortRepo[];
  cacheRoot: string;
  cohortSha256: string;
  out?: string;
  graphql: GraphqlRunner;
  writeRows: (path: string, rows: readonly FeatureRow[]) => void;
  io: FeatureRunIO;
  log: (line: string) => void;
}): { exitCode: number } {
  const { step, entries, cacheRoot, io, log } = input;
  const repoDirOf = (repo: string) => join(cacheRoot, repo.replace('/', '__'));

  if (step === 'manifest') {
    const missing = entries.filter((entry) => !existsSync(join(repoDirOf(entry.repo), 'features.summary.json'))).map((entry) => entry.repo);
    if (missing.length) {
      log(`error: no features yet for ${missing.length} repos`);
      return { exitCode: 3 };
    }
    const repos = entries.map((entry) => JSON.parse(readFileSync(join(repoDirOf(entry.repo), 'features.summary.json'), 'utf8')) as FeatureSummary);
    const manifest = {
      issue: 'HOK-3023',
      manifest_version: REWORK_RISK_FEATURE_MANIFEST_VERSION,
      cohort_manifest_sha256: input.cohortSha256,
      totals: {
        repos: repos.length,
        prs: repos.reduce((sum, repo) => sum + repo.prs, 0),
        rows: repos.reduce((sum, repo) => sum + repo.rows, 0),
        failed_rows: repos.reduce((sum, repo) => sum + repo.failed_rows, 0),
        rows_without_evidence: repos.reduce((sum, repo) => sum + repo.rows_without_evidence, 0),
      },
      repos,
    };
    mkdirSync(dirname(input.out!), { recursive: true });
    writeFileSync(input.out!, `${JSON.stringify(manifest, null, 2)}\n`);
    io.writeStdout(`${JSON.stringify(manifest.totals)}\n`);
    return { exitCode: 0 };
  }

  let failures = 0;
  for (const entry of entries) {
    const repoDir = repoDirOf(entry.repo);
    try {
      if (step === 'extract') {
        const summary = extractRepo(entry.repo, repoDir, input.writeRows, log);
        io.writeStdout(`${JSON.stringify({ repo: summary.repo, rows: summary.rows, failed_rows: summary.failed_rows, rows_without_evidence: summary.rows_without_evidence })}\n`);
        if (summary.failed_rows) failures++;
        continue;
      }
      const kind: CaptureKind = step;
      const records = readRecords(repoDir);
      const numbers = (kind === 'ci' ? records.filter((record) => record.merged_at >= CI_CAPTURE_FROM) : records).map((record) => record.pr_number);
      const result = captureRepo(kind, entry.repo, repoDir, numbers, input.graphql, log);
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, step, prs: numbers.length, ...result })}\n`);
      if (result.failed) failures++;
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, step, error: (error as Error).message.slice(0, 200) })}\n`);
      log(`error: ${entry.repo}: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}
