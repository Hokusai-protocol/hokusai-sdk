import { describe, expect, it } from 'vitest';
import { validateGithubTarget } from './report-cli.js';
import { resolveIntegrationBranch } from './orchestrate/integration-branch.js';
import { buildActionArgv } from './action-io.js';

describe('report inputs', () => {
  it('accepts URL and owner/repo, rejecting malformed targets', () => {
    expect(validateGithubTarget('https://github.com/octo/repo.git')).toEqual({ owner: 'octo', repo: 'repo' });
    expect(validateGithubTarget('octo/repo')).toEqual({ owner: 'octo', repo: 'repo' });
    expect(() => validateGithubTarget('octo/..')).toThrow();
  });
  it('resolves a promotion branch and rejects unsupported main', () => {
    expect(resolveIntegrationBranch({ defaultBranch: 'main', recentFirstParentSubjects: ['Merge pull request #1 from o/auto/integration', 'Merge pull request #2 from o/auto/integration'], headRefLookup: () => 'auto/integration', remoteBranchExists: () => true })).toBe('auto/integration');
    expect(() => resolveIntegrationBranch({ defaultBranch: 'main', recentFirstParentSubjects: [], headRefLookup: () => null, remoteBranchExists: () => false })).toThrow(/resolves to main/);
  });
  it('maps report Action inputs', () => {
    const input = (name: string) => ({ mode: 'report', 'github-repo': 'octo/repo', 'repo-path': '/tmp/repo', 'state-dir': '/tmp/state' } as Record<string, string>)[name];
    expect(buildActionArgv({ input, runnerTemp: '/tmp', workspace: '/tmp/repo' }).argv).toEqual(['report', 'octo/repo', '--repo', '/tmp/repo', '--state-dir', '/tmp/state', '--out', '/tmp/hokusai-report.json']);
    const withoutState = buildActionArgv({ input: (name) => ({ mode: 'report', 'github-repo': 'octo/repo' } as Record<string, string>)[name], runnerTemp: '/tmp', workspace: '/tmp/repo' });
    expect(withoutState.argv).toContain('--no-state');
  });
});
