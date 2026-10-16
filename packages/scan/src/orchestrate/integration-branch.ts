import { ScanInputError } from '../inputs.js';
export interface IntegrationBranchInput {
  explicit?: string | undefined;
  defaultBranch: string;
  recentFirstParentSubjects: readonly string[];
  headRefLookup: (number: number) => string | null;
  remoteBranchExists: (ref: string) => boolean;
}
/** Resolve a long-lived promotion branch before handing history to S2. */
export function resolveIntegrationBranch(input: IntegrationBranchInput): string {
  if (input.explicit) {
    if (input.explicit === 'main') throw new ScanInputError('integration branch resolves to main; S2 v1.0.0 rejects main');
    return input.explicit;
  }
  if (input.defaultBranch !== 'main') return input.defaultBranch;
  const candidates = input.recentFirstParentSubjects.slice(0, 200).flatMap((subject) => {
    const match = subject.match(/(?:Merge pull request #|\(#)(\d+)/);
    return match ? [input.headRefLookup(Number(match[1]))] : [];
  });
  const counts = new Map<string, number>();
  for (const ref of candidates) if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] / candidates.length >= 0.6 && best[0] !== 'main' && input.remoteBranchExists(best[0])) return best[0];
  throw new ScanInputError('integration branch resolves to main; S2 v1.0.0 rejects main. Pass --integration-branch <ref> or wait for S2 v1.1.0 (advisory main).');
}
