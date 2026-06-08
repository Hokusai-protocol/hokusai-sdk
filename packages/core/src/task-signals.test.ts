import { describe, expect, it } from 'vitest';
import {
  bucketRepositoryScale,
  classifyTaskFamily,
  inferReasoningDepth,
  summarizeFrameworkSignals,
  summarizeLanguageSignals,
} from './task-signals.js';

describe('classifyTaskFamily', () => {
  it.each([
    ['Fix the regression in the login flow.', 'bugfix'],
    ['Add a new search feature for the dashboard.', 'feature'],
    ['Run the data migration and alembic revision.', 'migration'],
    ['Refactor the task runner module.', 'refactor'],
    ['Add vitest coverage for the parser.', 'test'],
    ['Update the README and docs site.', 'docs'],
    ['Fix the CI deploy pipeline.', 'infra'],
  ] as const)('classifies %s as %s', (text, expected) => {
    expect(classifyTaskFamily({ text })).toBe(expected);
  });

  it('returns mixed when multiple distinct families match', () => {
    expect(classifyTaskFamily({ text: 'Fix the bug and add vitest coverage.' })).toBe(
      'mixed',
    );
  });

  it('falls back to investigation before chore', () => {
    expect(classifyTaskFamily({ text: 'Investigate the intermittent timeout.' })).toBe(
      'investigation',
    );
    expect(classifyTaskFamily({ text: 'Tidy the backlog labels.' })).toBe('chore');
  });
});

describe('inferReasoningDepth', () => {
  it('respects explicit overrides', () => {
    expect(
      inferReasoningDepth({
        text: 'Short prompt',
        reasoningDepth: 'deep',
      }),
    ).toBe('deep');
  });

  it('returns shallow for very short prompts', () => {
    expect(inferReasoningDepth({ text: 'Fix typo' })).toBe('shallow');
  });

  it('returns deep for analysis-style prompts', () => {
    expect(
      inferReasoningDepth({ text: 'Investigate deeply and compare root cause options.' }),
    ).toBe('deep');
  });

  it('defaults to standard otherwise', () => {
    expect(
      inferReasoningDepth({ text: 'Implement the requested billing notification flow.' }),
    ).toBe('standard');
  });
});

describe('bucketRepositoryScale', () => {
  it.each([
    [99, 'small'],
    [100, 'medium'],
    [1000, 'large'],
    [10000, 'xlarge'],
  ] as const)('maps %i files to %s', (fileCount, expected) => {
    expect(bucketRepositoryScale(fileCount)).toBe(expected);
  });

  it('returns undefined without a valid file count', () => {
    expect(bucketRepositoryScale()).toBeUndefined();
    expect(bucketRepositoryScale(-1)).toBeUndefined();
  });
});

describe('signal summarizers', () => {
  it('summarizes languages from extension counts', () => {
    expect(
      summarizeLanguageSignals({
        '.ts': 10,
        js: 2,
        unknown: 5,
        py: 0,
      }),
    ).toEqual(['JavaScript', 'TypeScript']);
  });

  it('deduplicates and sorts framework signals', () => {
    expect(
      summarizeFrameworkSignals(['React', 'Node.js', 'React', '  ', 'pnpm workspace']),
    ).toEqual(['Node.js', 'pnpm workspace', 'React']);
  });
});
