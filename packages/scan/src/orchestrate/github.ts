export interface ScanGitHubClient {
  getRepo(): { defaultBranch: string; private: boolean };
  getPullRequest(number: number): { number: number; title: string; body: string | null; authorLogin: string | null; authorType: string | null; headRef: string | null; headSha: string; labels: string[]; mergedAt: string } | null;
  listPullCommits(number: number): string[];
  getCheckConclusion(sha: string): 'success' | 'failure' | 'neutral' | 'none' | null;
}
