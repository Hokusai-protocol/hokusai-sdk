import { describe, expect, it } from 'vitest';
import {
  REASONING_DEPTH_COMPLEXITY,
  deriveTaskDescriptor,
  normalizeComplexity,
  normalizeHokusaiLanguage,
} from './task-descriptor.js';

describe('deriveTaskDescriptor', () => {
  it('derives categorical labels from task text', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Fix the flaky integration test in the checkout flow.',
    });

    expect(descriptor.task_type).toBe('tests');
    // Numeric score, not the reasoning-depth word: the descriptor contract
    // declares complexity as a number, and the server's _complexity_number
    // silently defaults any unrecognized word to 5.0.
    expect(descriptor.complexity).toBe(5);
  });

  it('maps each reasoning depth onto a distinct complexity score', () => {
    expect(REASONING_DEPTH_COMPLEXITY).toEqual({
      shallow: 3,
      standard: 5,
      deep: 8,
    });

    const scores = new Set(Object.values(REASONING_DEPTH_COMPLEXITY));
    expect(scores.size).toBe(3);
  });

  it('buckets repository scale and picks the dominant language', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Add a feature flag.',
      repositorySignals: {
        fileCount: 420,
        extensionCounts: { ts: 180, py: 40 },
      },
    });

    expect(descriptor.repo_size_bucket).toBe('medium');
    // Lowercase HokusaiLanguage enum value, not the display label.
    expect(descriptor.language).toBe('typescript');
  });

  it('breaks language ties deterministically by extension name', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Refactor the module.',
      repositorySignals: { extensionCounts: { ts: 10, py: 10 } },
    });

    expect(descriptor.language).toBe('python');
  });

  it('omits fields it cannot derive rather than guessing', () => {
    expect(deriveTaskDescriptor({})).toEqual({});
    expect(deriveTaskDescriptor({ taskText: '   ' })).toEqual({});

    const noRepo = deriveTaskDescriptor({ taskText: 'Write the docs.' });
    expect(noRepo.repo_size_bucket).toBeUndefined();
    expect(noRepo.language).toBeUndefined();
  });

  it('ignores extension counts that map to no known language', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Update infra.',
      repositorySignals: { extensionCounts: { xyz: 99 } },
    });

    expect(descriptor.language).toBeUndefined();
  });

  it('never carries raw task text into the descriptor', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Fix the bug in src/secret-service.ts before the launch.',
    });

    expect(JSON.stringify(descriptor)).not.toContain('secret-service');
    expect(Object.values(descriptor).join(' ')).not.toContain('launch');
  });
});

describe('normalizeComplexity', () => {
  it('passes through finite numbers', () => {
    expect(normalizeComplexity(7)).toBe(7);
    expect(normalizeComplexity(0)).toBe(0);
    expect(normalizeComplexity(Number.NaN)).toBeUndefined();
  });

  it('maps reasoning depths onto their scores', () => {
    expect(normalizeComplexity('shallow')).toBe(3);
    expect(normalizeComplexity('standard')).toBe(5);
    expect(normalizeComplexity('deep')).toBe(8);
  });

  it("understands the server's own string aliases", () => {
    // Mirrors _complexity_number in technical_task_router.py.
    expect(normalizeComplexity('low')).toBe(3);
    expect(normalizeComplexity('medium')).toBe(5);
    expect(normalizeComplexity('high')).toBe(8);
    expect(normalizeComplexity('very_high')).toBe(10);
  });

  it('parses numeric strings and is case-insensitive', () => {
    expect(normalizeComplexity('8')).toBe(8);
    expect(normalizeComplexity('  Deep ')).toBe(8);
  });

  it('returns undefined for meaningless values rather than defaulting', () => {
    expect(normalizeComplexity(undefined)).toBeUndefined();
    expect(normalizeComplexity('')).toBeUndefined();
    expect(normalizeComplexity('banana')).toBeUndefined();
  });
});

describe('normalizeHokusaiLanguage', () => {
  it('maps display labels onto the closed vocabulary', () => {
    expect(normalizeHokusaiLanguage('TypeScript')).toBe('typescript');
    expect(normalizeHokusaiLanguage('Python')).toBe('python');
    expect(normalizeHokusaiLanguage('Shell')).toBe('bash');
    expect(normalizeHokusaiLanguage('Go')).toBe('go');
  });

  it('returns unknown for labels outside the vocabulary', () => {
    expect(normalizeHokusaiLanguage('C++')).toBe('unknown');
    expect(normalizeHokusaiLanguage('Kotlin')).toBe('unknown');
    expect(normalizeHokusaiLanguage(undefined)).toBe('unknown');
  });
});
