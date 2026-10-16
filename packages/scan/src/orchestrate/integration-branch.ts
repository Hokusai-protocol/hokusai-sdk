export interface IntegrationBranchEvidence {
  defaultBranch: string;
  recentFirstParentSubjects: readonly string[];
  headRefLookup: (prNumber: number) => string | null;
  remoteBranchExists: (ref: string) => boolean;
  explicitBranch?: string | null;
}
export class IntegrationBranchError extends Error { readonly exitCode = 2; constructor(message: string) { super(message); this.name = 'IntegrationBranchError'; } }
const MAIN_GUIDANCE = 'integration branch resolves to main; S2 v1.0.0 rejects main. Pass --integration-branch <ref> or wait for S2 v1.1.0 (advisory main).';
const PR_MERGE = /^Merge pull request #(\d+) from [^/]+\/(.+)$/i;
const SQUASH = /\(#(\d+)\)\s*$/;

/** Resolve an integration ref while preserving the frozen S2 ban on main. */
export function resolveIntegrationBranch(evidence: IntegrationBranchEvidence): { branch: string; detected: boolean; summary: string } {
  const explicit = evidence.explicitBranch?.trim();
  if (explicit) {
    if (explicit.toLowerCase() === 'main') throw new IntegrationBranchError(MAIN_GUIDANCE);
    return { branch: explicit, detected: false, summary: 'explicit integration branch' };
  }
  if (!evidence.defaultBranch) throw new IntegrationBranchError('Repository default branch is missing.');
  if (evidence.defaultBranch.toLowerCase() !== 'main') return { branch: evidence.defaultBranch, detected: false, summary: 'repository default branch' };
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
    return { branch: winner[0], detected: true, summary: `detected ${winner[0]} in ${winner[1]}/${promotions} promotion merges` };
  }
  throw new IntegrationBranchError(MAIN_GUIDANCE);
}
