/**
 * S2 labels for an enumerated corpus repo (HOK-3266).
 *
 * The labeller itself is unchanged: this adapts `CorpusPrRecord`s to the
 * labeller's `MergedPrRef` and replaces its one-REST-call-per-PR
 * cross-reference lookup with GraphQL batches. That lookup is unaffordable at
 * corpus scale (~300k PRs), and dropping it would silently remove S2's
 * `linked_issue_or_pr` evidence.
 *
 * `parentSha` is the enumerator's `base_sha`. For squash and merge commits
 * that is `merge^1`, as before. For rebase merges it sits before the PR's
 * first commit, so the substrate covers the whole PR rather than its last
 * commit.
 *
 * Pure: git, GraphQL and the clock are injected.
 */

import type { ArbiterSurvivalLabelV1, HorizonDays } from '@hokusai/core';
import {
  buildHorizonTerminalIndex,
  labelMergedPr,
  type CrossReference,
  type GitRunner,
  type MergedPrRef,
  type SurvivalGitHubClient,
} from '../survival-labeller.js';
import type { CorpusPrRecord, GraphqlRunner } from './enumerate.js';

/** PRs per cross-reference query: 50 × up to 100 events stays well inside GraphQL node limits. */
export const CROSS_REFERENCE_BATCH = 50;

export function toMergedPrRef(record: CorpusPrRecord): MergedPrRef {
  return {
    prNumber: record.pr_number,
    prUrl: record.pr_url,
    mergeSha: record.merge_sha,
    parentSha: record.base_sha,
    headSha: record.head_sha ?? record.merge_sha,
    mergedAtEpoch: Math.floor(Date.parse(record.merged_at) / 1000),
    // Redispatch detection reads tracker keys from the subject; the PR title is the subject's source.
    subject: record.title,
  };
}

/**
 * Cross-referenced timeline events per PR, matching the REST lookup the
 * labeller makes by default (`event === 'cross-referenced'`, first 100).
 */
export function prefetchCrossReferences(
  repo: string,
  prNumbers: readonly number[],
  graphql: GraphqlRunner,
  cache?: { get(key: string): unknown; set(key: string, value: unknown): void },
): Map<number, CrossReference[]> {
  const [owner, name] = repo.split('/') as [string, string];
  const out = new Map<number, CrossReference[]>();
  for (let i = 0; i < prNumbers.length; i += CROSS_REFERENCE_BATCH) {
    const batch = prNumbers.slice(i, i + CROSS_REFERENCE_BATCH);
    const key = `xref:${batch.join(',')}`;
    let rows = cache?.get(key) as [number, CrossReference[]][] | undefined;
    if (!rows) {
      const fields = batch
        .map((n) => `pr${n}: pullRequest(number:${n}){ timelineItems(itemTypes:[CROSS_REFERENCED_EVENT], first:100){ nodes{ ... on CrossReferencedEvent { createdAt source{ ... on Issue { url } ... on PullRequest { url } } } } } }`)
        .join('\n');
      const data = graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name }) as {
        repository: Record<string, { timelineItems: { nodes: { createdAt?: string; source?: { url?: string } }[] } } | null>;
      };
      rows = batch.map((n) => {
        const nodes = data.repository[`pr${n}`]?.timelineItems.nodes ?? [];
        const refs = nodes
          .filter((node) => node.createdAt)
          .map((node) => ({ createdAtEpoch: Math.floor(Date.parse(node.createdAt!) / 1000), url: node.source?.url ?? '' }))
          .filter((ref) => Number.isFinite(ref.createdAtEpoch));
        return [n, refs];
      });
      cache?.set(key, rows);
    }
    for (const [n, refs] of rows) out.set(n, refs);
  }
  return out;
}

/** A labeller GitHub client answered entirely from prefetched data; no network. */
export function prefetchedGithubClient(crossReferences: ReadonlyMap<number, CrossReference[]>): SurvivalGitHubClient {
  return {
    getPrMetadata: () => null,
    listCrossReferences: (prNumber) => crossReferences.get(prNumber) ?? [],
  };
}

export interface LabelCorpusRepoInput {
  owner: string;
  repo: string;
  branch: string;
  repoDir: string;
  records: readonly CorpusPrRecord[];
  horizons: readonly HorizonDays[];
}

export interface LabelCorpusRepoDeps {
  runGit: GitRunner;
  github: SurvivalGitHubClient;
  now: () => Date;
  onDiagnostic?: (line: string) => void;
}

/** Every record × horizon as an S2 v1.1.0 row (direct mode). A PR the labeller cannot read is reported, not imputed. */
export function labelCorpusRepo(input: LabelCorpusRepoInput, deps: LabelCorpusRepoDeps): { rows: ArbiterSurvivalLabelV1[]; failed: number[] } {
  const target = { owner: input.owner, repo: input.repo, integrationBranch: input.branch, integrationMode: 'direct' as const, repoDir: input.repoDir };
  const labellerDeps = { runGit: deps.runGit, github: deps.github, now: deps.now, onDiagnostic: deps.onDiagnostic };
  const all = input.records.map(toMergedPrRef);
  // One first-parent walk per repo instead of one `git log --until` per PR × horizon.
  const horizonTerminalIndex = buildHorizonTerminalIndex(labellerDeps, input.branch) ?? undefined;
  const rows: ArbiterSurvivalLabelV1[] = [];
  const failed: number[] = [];
  for (const [i, pr] of all.entries()) {
    if (i > 0 && i % 500 === 0) deps.onDiagnostic?.(`info: ${input.owner}/${input.repo}: labelled ${i}/${all.length} PRs`);
    try {
      rows.push(...labelMergedPr(target, labellerDeps, pr, { horizons: input.horizons, allMergedPrs: all, horizonTerminalIndex }));
    } catch (error) {
      failed.push(pr.prNumber);
      deps.onDiagnostic?.(`error: failed to label ${pr.prUrl}: ${String(error).slice(0, 200)}`);
    }
  }
  return { rows, failed };
}
