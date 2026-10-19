import type { ScanUpstreamError } from '../default-deps.js';
export interface ScanRepository { defaultBranch: string; private: boolean }
export interface ScanPullRequest { number: number; title: string; body: string | null; authorLogin: string | null; authorType: string | null; headRef: string; headSha: string; labels: string[]; mergedAt: string }
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'none' | null;
export interface ScanGitHubClient {
  readonly offline?: boolean;
  getRepo(): Promise<ScanRepository>;
  getPullRequest(number: number): Promise<ScanPullRequest | null>;
  listPullCommits(number: number): Promise<string[]>;
  getCheckConclusion(sha: string): Promise<CheckConclusion>;
}
export function createOfflineScanGitHubClient(): ScanGitHubClient {
  return {
    offline: true,
    async getRepo() { await Promise.resolve(); return { defaultBranch: '', private: false }; },
    async getPullRequest() { await Promise.resolve(); return null; },
    async listPullCommits() { await Promise.resolve(); return []; },
    async getCheckConclusion() { await Promise.resolve(); return null; },
  };
}
export type ScanUpstreamFailure = ScanUpstreamError;
