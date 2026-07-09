import { describe, expect, it } from 'vitest';
import { deriveTaskDescriptor } from './task-descriptor.js';

describe('deriveTaskDescriptor', () => {
  it('derives categorical labels from task text', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Fix the flaky integration test in the checkout flow.',
    });

    expect(descriptor.task_type).toBe('tests');
    expect(descriptor.complexity).toBe('standard');
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
    expect(descriptor.language).toBe('TypeScript');
  });

  it('breaks language ties deterministically by extension name', () => {
    const descriptor = deriveTaskDescriptor({
      taskText: 'Refactor the module.',
      repositorySignals: { extensionCounts: { ts: 10, py: 10 } },
    });

    expect(descriptor.language).toBe('Python');
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
