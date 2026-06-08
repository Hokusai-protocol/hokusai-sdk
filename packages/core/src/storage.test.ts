import { describe, expect, it } from 'vitest';
import { InMemoryCorrelationStorage } from './storage.js';

describe('InMemoryCorrelationStorage', () => {
  it('stores and resolves correlation records', async () => {
    const storage = new InMemoryCorrelationStorage();
    await storage.set({
      taskId: 'task-1',
      correlationId: 'correlation-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(storage.get('task-1')).resolves.toEqual({
      taskId: 'task-1',
      correlationId: 'correlation-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
