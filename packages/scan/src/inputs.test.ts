import { describe, expect, it } from 'vitest';
import { HORIZONS } from '@hokusai/core';
import {
  ScanInputError,
  validateAsOf,
  validateGithubRepo,
  validateHorizons,
  validateIntegrationBranch,
  validateMaxPrs,
  validatePrNumber,
  validatePrUrl,
  validateRepoDir,
  validateTokenEnvName,
} from './inputs.js';

describe('validateRepoDir', () => {
  it('rejects a missing value', () => {
    expect(() => validateRepoDir(undefined)).toThrow(ScanInputError);
    expect(() => validateRepoDir('  ')).toThrow('--repo is required');
  });

  it('passes any non-empty path through (filesystem checks are the shell’s job)', () => {
    expect(validateRepoDir('/some/path')).toBe('/some/path');
  });
});

describe('validateIntegrationBranch', () => {
  it('is required', () => {
    expect(() => validateIntegrationBranch(undefined)).toThrow('--integration-branch is required');
  });

  it('rejects main per the v1.0.0 contract', () => {
    expect(() => validateIntegrationBranch('main')).toThrow(
      'integration branch main is rejected (v1.0.0 contract)',
    );
  });

  it('accepts any other branch', () => {
    expect(validateIntegrationBranch('auto/integration')).toBe('auto/integration');
  });
});

describe('validatePrNumber', () => {
  it('is required', () => {
    expect(() => validatePrNumber(undefined)).toThrow('--pr is required');
  });

  it('rejects zero, negatives, and non-integers', () => {
    for (const bad of ['0', '-3', '1.5', 'abc', '12abc']) {
      expect(() => validatePrNumber(bad), bad).toThrow('--pr must be a positive integer');
    }
  });

  it('accepts a positive integer as string or number', () => {
    expect(validatePrNumber('42')).toBe(42);
    expect(validatePrNumber(7)).toBe(7);
  });
});

describe('validateGithubRepo', () => {
  it('is optional', () => {
    expect(validateGithubRepo(undefined)).toBeUndefined();
  });

  it('rejects values without a slash', () => {
    expect(() => validateGithubRepo('just-a-name')).toThrow(
      '--github-repo must be in owner/name form',
    );
    expect(() => validateGithubRepo('a/b/c')).toThrow(ScanInputError);
  });

  it('splits owner and name', () => {
    expect(validateGithubRepo('Hokusai-protocol/hokusai-sdk')).toEqual({
      owner: 'Hokusai-protocol',
      repo: 'hokusai-sdk',
    });
  });
});

describe('validatePrUrl', () => {
  it('accepts a full PR URL', () => {
    expect(validatePrUrl('https://github.com/o/r/pull/12')).toBe('https://github.com/o/r/pull/12');
  });

  it('rejects anything that is not a /pull/<n> URL', () => {
    expect(() => validatePrUrl('github.com/o/r/pull/12')).toThrow(ScanInputError);
    expect(() => validatePrUrl('https://github.com/o/r/issues/12')).toThrow(ScanInputError);
  });
});

describe('validateAsOf', () => {
  it('accepts ISO-8601 timestamps and dates', () => {
    expect(validateAsOf('2026-03-01T00:00:00Z')?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(validateAsOf('2026-03-01')?.getTime()).toBe(Date.parse('2026-03-01'));
  });

  it('rejects non-ISO forms Date.parse would tolerate', () => {
    for (const bad of ['not-a-date', 'Sep 26 2026', '2026/09/26', '2026-13-45']) {
      expect(() => validateAsOf(bad), bad).toThrow('--as-of must be an ISO-8601 timestamp');
    }
  });
});

describe('validateHorizons', () => {
  it('defaults to the full contract set', () => {
    expect(validateHorizons(undefined)).toEqual([...HORIZONS]);
  });

  it('accepts a comma-separated subset', () => {
    expect(validateHorizons('14,60')).toEqual([14, 60]);
  });

  it('rejects values outside the contract enum', () => {
    expect(() => validateHorizons('14,21')).toThrow('invalid horizons 21');
  });
});

describe('validateMaxPrs', () => {
  it('defaults to 1000', () => {
    expect(validateMaxPrs(undefined)).toBe(1000);
  });

  it('rejects non-positive values', () => {
    expect(() => validateMaxPrs('0')).toThrow(ScanInputError);
    expect(() => validateMaxPrs('nope')).toThrow(ScanInputError);
  });
});

describe('validateTokenEnvName', () => {
  it('defaults to GITHUB_TOKEN', () => {
    expect(validateTokenEnvName(undefined)).toBe('GITHUB_TOKEN');
  });

  it('rejects values that are not env-var names (tokens are never argv)', () => {
    expect(() => validateTokenEnvName('ghp_secretvalue!')).toThrow(
      '--token-env must name an environment variable',
    );
  });

  it('accepts identifier-shaped names', () => {
    expect(validateTokenEnvName('GH_TOKEN')).toBe('GH_TOKEN');
  });
});
