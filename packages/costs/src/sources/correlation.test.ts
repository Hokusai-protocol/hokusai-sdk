import { describe, expect, it } from 'vitest';
import {
  buildBoundaryContext,
  cumulativeDelta,
  DiagnosticTally,
  matchesBoundary,
} from './correlation.js';

const boundary = buildBoundaryContext({
  taskId: 'task-0001',
  allowedSessionIds: ['session-a', 'session-b'],
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-01-01T01:00:00Z',
});

describe('buildBoundaryContext', () => {
  it('rejects an empty taskId, allowed set, or an inverted window', () => {
    expect(() =>
      buildBoundaryContext({
        taskId: '',
        allowedSessionIds: ['a'],
        startAt: '2026-01-01T00:00:00Z',
        endAt: '2026-01-01T00:01:00Z',
      }),
    ).toThrow(TypeError);
    expect(() =>
      buildBoundaryContext({
        taskId: 't',
        allowedSessionIds: [],
        startAt: '2026-01-01T00:00:00Z',
        endAt: '2026-01-01T00:01:00Z',
      }),
    ).toThrow(TypeError);
    expect(() =>
      buildBoundaryContext({
        taskId: 't',
        allowedSessionIds: ['a'],
        startAt: '2026-01-01T00:10:00Z',
        endAt: '2026-01-01T00:00:00Z',
      }),
    ).toThrow(TypeError);
  });
});

describe('matchesBoundary', () => {
  it('accepts inclusive endpoints and rejects out-of-window rows', () => {
    expect(matchesBoundary(boundary, 'session-a', '2026-01-01T00:00:00Z')).toBe(
      true,
    );
    expect(matchesBoundary(boundary, 'session-a', '2026-01-01T01:00:00Z')).toBe(
      true,
    );
    expect(matchesBoundary(boundary, 'session-a', '2025-12-31T23:59:59Z')).toBe(
      false,
    );
    expect(matchesBoundary(boundary, 'session-c', '2026-01-01T00:30:00Z')).toBe(
      false,
    );
  });
});

describe('cumulativeDelta', () => {
  it('computes the diff and rearms on a backward jump', () => {
    const prev = {
      input_tokens: 100,
      output_tokens: 200,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
    };
    const next = {
      input_tokens: 150,
      output_tokens: 250,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
    };
    expect(cumulativeDelta(prev, next).delta.input_tokens).toBe(50);
    expect(cumulativeDelta(prev, next).delta.output_tokens).toBe(50);
    expect(cumulativeDelta(prev, next).reset).toBe(false);

    const reset = cumulativeDelta(next, {
      ...next,
      input_tokens: 10,
    });
    expect(reset.reset).toBe(true);
    expect(reset.delta.input_tokens).toBe(10);
  });
});

describe('DiagnosticTally', () => {
  it('sums per-code counts and skips zero/negative increments', () => {
    const tally = new DiagnosticTally();
    tally.bump('duplicate_record');
    tally.bump('duplicate_record', 3);
    tally.bump('malformed_json', 0);
    tally.bump('malformed_json', -1);
    tally.bump('unpriced_model');
    const codes = tally.toArray();
    expect(
      codes.find((entry) => entry.code === 'duplicate_record')?.count,
    ).toBe(4);
    expect(
      codes.find((entry) => entry.code === 'malformed_json'),
    ).toBeUndefined();
    expect(codes.find((entry) => entry.code === 'unpriced_model')?.count).toBe(
      1,
    );
  });
});
