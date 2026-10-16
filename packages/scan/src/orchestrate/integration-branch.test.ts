import { describe, expect, it } from 'vitest';
import { IntegrationBranchError, resolveIntegrationBranch } from './integration-branch.js';
const base = { recentFirstParentSubjects: [], headRefLookup: () => null, remoteBranchExists: () => true };
describe('resolveIntegrationBranch', () => {
  it('uses explicit and non-main default branches', () => {
    expect(resolveIntegrationBranch({ ...base, defaultBranch: 'main', explicitBranch: 'develop' }).branch).toBe('develop');
    expect(resolveIntegrationBranch({ ...base, defaultBranch: 'master' }).branch).toBe('master');
  });
  it('detects a durable promotion branch from main', () => {
    const subjects = Array.from({ length: 10 }, (_, i) => `Merge pull request #${i + 1} from org/auto/integration`);
    expect(resolveIntegrationBranch({ ...base, defaultBranch: 'main', recentFirstParentSubjects: subjects }).branch).toBe('auto/integration');
  });
  it('rejects explicit main and ambiguous main histories', () => {
    expect(() => resolveIntegrationBranch({ ...base, defaultBranch: 'main', explicitBranch: 'main' })).toThrow(IntegrationBranchError);
    expect(() => resolveIntegrationBranch({ ...base, defaultBranch: 'main' })).toThrow(/S2 v1.0.0 rejects main/);
  });
});
