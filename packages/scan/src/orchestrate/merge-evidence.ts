import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveTaskDescriptor, REWORK_RISK_FEATURE_MANIFEST, type PrRowV2, type TaskDescriptorFields } from '@hokusai/core';
import { bucketDescription, type CandidateDescriptionLengthBucket } from '../candidate-features.js';
import { enumerateCorpusRepo, type CorpusPrRecord, type GraphqlRunner } from '../corpus/enumerate.js';
import { captureCommitCi, capturePrEvidence } from '../corpus/feature-capture.js';
import { buildHistoryIndex, gitColumns } from '../corpus/feature-git.js';
import { bodyAt, extractPrFeatures, titleAt, type CiEvidence, type EvidenceCommit, type GitFeatureColumns, type PrEvidence } from '../corpus/features.js';
import type { GitRunner, SurvivalLabellerTarget } from '../survival-labeller.js';

export type MissingEvidenceReason = 'git' | 'github_history' | 'ci' | 'agent' | 'instrumentation' | 'landing_unavailable';
export interface MergeEvidenceRow {
  pr_number: number;
  merge_sha: string;
  agent_at_merge: PrRowV2['agent_at_merge'];
  /** Bounded text-derived facts for consumers of the S1 intent fields. */
  text_descriptor: { task_type: TaskDescriptorFields['task_type'] | null; complexity: TaskDescriptorFields['complexity'] | null; description_length_bucket: CandidateDescriptionLengthBucket | null };
  /** Derived columns only; raw evidence stays within this module. */
  values: GitFeatureColumns;
}
export interface MergeEvidenceResult {
  rows: MergeEvidenceRow[];
  /** Number of unavailable columns, grouped by bounded reason. */
  missing: Record<MissingEvidenceReason, number>;
}
const TEXT_DESCRIPTOR_FIELDS = 3;
const DAY_MS = 86_400_000;
// Corpus search uses an exclusive whole-day upper bound. Include the scan day;
// report PR identities are still restricted to the pinned scan window.
const corpusUntil = (to: Date) => new Date(Math.floor(to.getTime() / DAY_MS) * DAY_MS + DAY_MS);

export function unavailableMergeEvidence(prs: readonly { pr_number: number; merge_sha: string }[]): MergeEvidenceResult {
  return { rows: prs.map((pr) => ({ ...pr, agent_at_merge: 'unknown', text_descriptor: { task_type: null, complexity: null, description_length_bucket: null }, values: Object.fromEntries(REWORK_RISK_FEATURE_MANIFEST.entries.map((entry) => [entry.name, null])) })),
    missing: { git: 0, github_history: 0, ci: 0, agent: 0, instrumentation: 0, landing_unavailable: prs.length * (REWORK_RISK_FEATURE_MANIFEST.entries.length + TEXT_DESCRIPTOR_FIELDS) } };
}

function landingCommits(runGit: GitRunner, record: CorpusPrRecord): { commits: EvidenceCommit[]; oids: Set<string>; ciHead: string | null; mergeCommit: boolean } | null {
  const parents = runGit(['rev-list', '--parents', '-n', '1', record.merge_sha]);
  if (parents.exitCode !== 0) return null;
  const parts = parents.stdout.trim().split(/\s+/);
  const mergeCommit = parts.length === 3;
  const head = mergeCommit ? parts[2] : record.merge_sha;
  if (!head || !/^[0-9a-f]{40}$/.test(head)) return null;
  const list = runGit(['log', '--format=%H%x00%an%x00%ae%x00%B%x00', `${record.base_sha}..${head}`]);
  if (list.exitCode !== 0) return null;
  const fields = list.stdout.split('\0');
  const commits: EvidenceCommit[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const oid = fields[i]!.trim();
    if (!/^[0-9a-f]{40}$/.test(oid)) return null;
    commits.push({ oid, author_name: fields[i + 1] || null, author_email: fields[i + 2] || null, author_login: null, message: fields[i + 3]! });
  }
  return { commits, oids: new Set(commits.map((commit) => commit.oid)), ciHead: mergeCommit ? head : null, mergeCommit };
}

/** Only stable merge/PR identities leave corpus enumeration. */
export function discoverMergeAssociations(input: {
  target: SurvivalLabellerTarget; runGit: GitRunner; graphql: GraphqlRunner; from: Date; to: Date;
}): { mergeSha: string; prNumber: number }[] {
  const { target, runGit, graphql, from, to } = input;
  return enumerateCorpusRepo({ repo: `${target.owner}/${target.repo}`, branch: target.integrationBranch, defaultBranchNames: [target.integrationBranch], from, until: corpusUntil(to) }, { runGit, graphql }).records.map((record) => ({ mergeSha: record.merge_sha, prNumber: record.pr_number }));
}

/** Build an internal, derived-only view independently of the report wire contract. */
export function collectMergeEvidence(input: {
  target: SurvivalLabellerTarget; runGit: GitRunner; graphql: GraphqlRunner;
  from: Date; to: Date; prs: readonly { pr_number: number; merge_sha: string }[];
  /** Fixture seams; production always uses the capture readers. */
  capture?: (number: number) => PrEvidence | null;
  captureCi?: (number: number, sha: string) => CiEvidence | null;
}): MergeEvidenceResult {
  const { target, runGit, graphql } = input;
  const tip = runGit(['rev-parse', '--verify', `${target.integrationBranch}^{commit}`]);
  const sha = tip.stdout.trim();
  if (tip.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('Historical evidence: integration history unavailable');
  const repo = `${target.owner}/${target.repo}`;
  const prNumbers = new Set(input.prs.map((pr) => pr.pr_number));
  const records = enumerateCorpusRepo({ repo, branch: sha, defaultBranchNames: [target.integrationBranch], from: input.from, until: corpusUntil(input.to) }, { runGit, graphql }).records.filter((record) => prNumbers.has(record.pr_number));
  const temp = mkdtempSync(join(tmpdir(), 'hokusai-evidence-'));
  try {
    const index = buildHistoryIndex(target.repoDir, sha, join(temp, 'index'), new Set(records.map((record) => record.merge_sha)));
    const missing: MergeEvidenceResult['missing'] = { git: 0, github_history: 0, ci: 0, agent: 0, instrumentation: 0, landing_unavailable: 0 };
    const rows = records.map((record): MergeEvidenceRow => {
      const evidence = input.capture ? input.capture(record.pr_number) : capturePrEvidence(repo, record.pr_number, graphql);
      const landed = landingCommits(runGit, record);
      // A single-parent landing does not prove whether it was a squash or the
      // last of several rebased commits. The current PR commit count can change,
      // so neither the inferred base nor the original head is safe to use.
      const pinned = landed?.mergeCommit ? landed : null;
      const safeEvidence = evidence && pinned ? { ...evidence, commits: pinned.commits } : evidence;
      let ci: CiEvidence | null = null;
      if (pinned?.ciHead) {
        try { ci = input.captureCi ? input.captureCi(record.pr_number, pinned.ciHead) : captureCommitCi(repo, record.pr_number, pinned.ciHead, graphql); }
        catch { /* CI is optional; unavailable history remains null. */ }
      }
      // Current PR-commit membership cannot prove the historical mapping from
      // the PR author to commit emails, and the landing author may be a merger.
      const git = pinned ? gitColumns({ index, gitDir: target.repoDir, record, authorEmails: null }) : {};
      git['feature.author.repo_commits_prior'] = null;
      git['feature.author.touched_file_commits_prior'] = null;
      const extracted = extractPrFeatures({ record, evidence: safeEvidence, ci, git, historicalOnly: true,
        ...(pinned ? { mergedHeadCommitOids: pinned.oids } : {}), landingMessage: record.batched ? null : index.landingMessages.get(record.merge_sha) ?? null });
      const values: GitFeatureColumns = { ...extracted.features, 'segment.agent.exact_model': null };
      if (record.author_login === null || record.author_type === null) values['segment.agent.marked_by_account'] = null;
      if (record.author_login === null) values['segment.author.dependency_bot'] = null;
      if (evidence?.head_ref == null) values['segment.agent.marked_by_branch'] = null;
      if (!pinned) {
        values['feature.shape.member_commits'] = null;
        values['feature.shape.diff_uncertain'] = null;
      }
      const title = evidence ? titleAt(evidence, record.merged_at, true) : null;
      const body = evidence ? bodyAt(evidence, record.merged_at, true) : null;
      const text = title !== null && body !== null ? `${title}\n\n${body}` : undefined;
      const descriptor = text === undefined ? {} : deriveTaskDescriptor({ taskText: text });
      const text_descriptor = { task_type: descriptor.task_type ?? null, complexity: descriptor.complexity ?? null, description_length_bucket: bucketDescription(text) };
      missing.github_history += Object.values(text_descriptor).filter((value) => value === null).length;
      const identityKnown = evidence !== null && record.author_login !== null && record.author_type !== null && evidence.head_ref !== null;
      if (!identityKnown && values['feature.agent.marker_present'] === false) {
        values['feature.agent.marker_present'] = null;
        values['feature.agent.tool_family'] = null;
      }
      const marker = values['feature.agent.marker_present'];
      const agent_at_merge: PrRowV2['agent_at_merge'] = marker === true ? 'agent' : marker === false && identityKnown ? 'not_agent_signal' : 'unknown';
      for (const entry of REWORK_RISK_FEATURE_MANIFEST.entries) {
        if (values[entry.name] !== null) continue;
        const reason: MissingEvidenceReason = entry.name.startsWith('segment.ci.') ? 'ci' : entry.name.startsWith('segment.provenance.') ? 'instrumentation' : entry.name.startsWith('feature.agent.') || entry.name.startsWith('segment.agent.') ? 'agent' : entry.as_of_source.startsWith('git_') ? 'git' : 'github_history';
        missing[reason]++;
      }
      return { pr_number: record.pr_number, merge_sha: record.merge_sha, agent_at_merge, text_descriptor, values };
    });
    const seen = new Set(rows.map((row) => row.pr_number));
    for (const pr of input.prs) if (!seen.has(pr.pr_number)) {
      missing.landing_unavailable += REWORK_RISK_FEATURE_MANIFEST.entries.length + TEXT_DESCRIPTOR_FIELDS;
      rows.push({ ...pr, agent_at_merge: 'unknown', text_descriptor: { task_type: null, complexity: null, description_length_bucket: null }, values: Object.fromEntries(REWORK_RISK_FEATURE_MANIFEST.entries.map((entry) => [entry.name, null])) });
    }
    rows.sort((a, b) => a.pr_number - b.pr_number);
    return { rows, missing };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
