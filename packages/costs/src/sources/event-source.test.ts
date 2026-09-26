import { describe, expect, it } from 'vitest';
import { runEventSourceAdapter } from './event-source.js';
import type { TaskBoundary } from './types.js';
import type { IngestUsageInput } from '../engine.js';

const BOUNDARY: TaskBoundary = {
  taskId: 'task-0001',
  allowedSessionIds: ['session-a'],
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-01-01T02:00:00Z',
};

const baseInput: IngestUsageInput = {
  eventId: '01900000-0000-7000-8000-000000000001',
  taskId: 'task-0001',
  sessionId: 'session-a',
  turnId: 'turn-1',
  sequence: 1,
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  observedModel: 'claude-sonnet-5',
  usage: { input_tokens: 1000, output_tokens: 500 },
  observedAt: '2026-01-01T00:10:00Z',
};

describe('runEventSourceAdapter', () => {
  it('ingests already-normalized inputs within the boundary', () => {
    const result = runEventSourceAdapter({
      records: [baseInput],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects a record whose task id differs from the boundary', () => {
    const result = runEventSourceAdapter({
      records: [{ ...baseInput, taskId: 'task-other' }],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(0);
    expect(
      result.diagnostics.find((d) => d.code === 'record_out_of_boundary')
        ?.count,
    ).toBe(1);
  });

  it('rejects a record whose session is not in the allowed set', () => {
    const result = runEventSourceAdapter({
      records: [{ ...baseInput, sessionId: 'session-foreign' }],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(0);
    expect(
      result.diagnostics.find((d) => d.code === 'record_out_of_boundary')
        ?.count,
    ).toBe(1);
  });

  it('reports duplicates rather than throwing', () => {
    const result = runEventSourceAdapter({
      records: [baseInput, baseInput],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(1);
    expect(
      result.diagnostics.find((d) => d.code === 'duplicate_record')?.count,
    ).toBe(1);
  });
});
