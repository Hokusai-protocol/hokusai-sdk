import type { IntegrationMode } from '@hokusai/core';


export interface IntegrationBranchEvidence {
  defaultBranch: string;
  recentFirstParentSubjects: readonly string[];
  headRefLookup: (prNumber: number) => string | null;
  remoteBranchExists: (ref: string) => boolean;
  explicitBranch?: string | null;
  /** `--integration-mode`; `direct` lets a repo that merges straight into main be walked on main. */
  explicitMode?: IntegrationMode | null;
}
export class IntegrationBranchError extends Error { readonly exitCode = 2; constructor(message: string) { super(message); this.name = 'IntegrationBranchError'; } }
const MAIN_GUIDANCE = 'integration branch resolves to main and no promotion branch was detected. Pass --integration-branch <ref>, or --integration-mode direct if PRs merge straight into main (S2 v1.1.0).';
const PR_MERGE = /^Merge pull request #(\d+) from [^/]+\/(.+)$/i;
const SQUASH = /\(#(\d+)\)\s*$/;

/**
 * Resolve an integration ref. `main` is walked only in `direct` mode (S2 v1.1.0);
 * a detected promotion branch is always `promotion`.
 */
export function resolveIntegrationBranch(evidence: IntegrationBranchEvidence): { branch: string; mode: IntegrationMode; detected: boolean; summary: string } {
  const explicit = evidence.explicitBranch?.trim();
  const explicitMode = evidence.explicitMode ?? null;
  if (explicit) {
    if (explicit.toLowerCase() === 'main' && explicitMode !== 'direct') throw new IntegrationBranchError(MAIN_GUIDANCE);
    return { branch: explicit, mode: explicitMode ?? 'promotion', detected: false, summary: 'explicit integration branch' };
  }
  if (!evidence.defaultBranch) throw new IntegrationBranchError('Repository default branch is missing.');
  if (evidence.defaultBranch.toLowerCase() !== 'main') return { branch: evidence.defaultBranch, mode: explicitMode ?? 'direct', detected: false, summary: 'repository default branch' };
  if (explicitMode === 'direct') return { branch: evidence.defaultBranch, mode: 'direct', detected: false, summary: 'default branch, direct merge (explicit)' };
  const counts = new Map<string, number>();
  let promotions = 0;
  for (const subject of evidence.recentFirstParentSubjects.slice(0, 200)) {
    let number: number | null = null;
    let ref: string | null = null;
    const merge = subject.match(PR_MERGE);
    const squash = subject.match(SQUASH);
    if (merge) { number = Number(merge[1]); ref = merge[2]!; }
    else if (squash) { number = Number(squash[1]); ref = evidence.headRefLookup(number); }
    if (!number || !ref || !ref.includes('/')) continue;
    promotions++;
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (winner && promotions > 0 && winner[1] / promotions >= 0.6 && evidence.remoteBranchExists(winner[0])) {
    return { branch: winner[0], mode: 'promotion', detected: true, summary: `detected ${winner[0]} in ${winner[1]}/${promotions} promotion merges` };
  }
  throw new IntegrationBranchError(MAIN_GUIDANCE);
}
