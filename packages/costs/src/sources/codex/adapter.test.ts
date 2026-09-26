import { describe, expect, it } from 'vitest';
import { runCodexAdapter } from './adapter.js';
import type { TaskBoundary } from '../types.js';

const BOUNDARY: TaskBoundary = {
  taskId: 'task-0001',
  allowedSessionIds: ['session-a'],
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-01-01T02:00:00Z',
};

function sessionMeta(id: string, at: string): Record<string, unknown> {
  return {
    type: 'session_meta',
    timestamp: at,
    payload: { id },
  };
}
function turnContext(model: string, at: string): Record<string, unknown> {
  return {
    type: 'turn_context',
    timestamp: at,
    payload: { model },
  };
}
function tokenCount(
  at: string,
  info: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'token_count',
    timestamp: at,
    payload: { info },
  };
}

function jsonl(rows: Record<string, unknown>[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

describe('runCodexAdapter', () => {
  it('emits one event per token_count row when last_token_usage is present', () => {
    const blob = jsonl([
      sessionMeta('session-a', '2026-01-01T00:00:00Z'),
      turnContext('gpt-5', '2026-01-01T00:00:00Z'),
      tokenCount('2026-01-01T00:10:00Z', {
        total_token_usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cached_input_tokens: 0,
          reasoning_output_tokens: 100,
        },
        last_token_usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cached_input_tokens: 0,
          reasoning_output_tokens: 100,
        },
      }),
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.harness).toBe('codex');
    expect(event.observed_model).toBe('gpt-5');
    expect(event.usage.input_tokens).toBe(1000);
    expect(event.usage.reasoning_tokens).toBe(100);
  });

  it('derives per-turn deltas from cumulative totals when last is missing', () => {
    const blob = jsonl([
      sessionMeta('session-a', '2026-01-01T00:00:00Z'),
      turnContext('gpt-5', '2026-01-01T00:00:00Z'),
      tokenCount('2026-01-01T00:10:00Z', {
        total_token_usage: {
          input_tokens: 500,
          output_tokens: 200,
        },
      }),
      tokenCount('2026-01-01T00:11:00Z', {
        total_token_usage: {
          input_tokens: 1200,
          output_tokens: 700,
        },
      }),
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.usage.input_tokens).toBe(500);
    expect(result.events[1]?.usage.input_tokens).toBe(700);
    expect(result.events[1]?.usage.output_tokens).toBe(500);
  });

  it('rearms baseline and reports cumulative_counter_reset on a backward jump', () => {
    const blob = jsonl([
      sessionMeta('session-a', '2026-01-01T00:00:00Z'),
      turnContext('gpt-5', '2026-01-01T00:00:00Z'),
      tokenCount('2026-01-01T00:10:00Z', {
        total_token_usage: { input_tokens: 500, output_tokens: 200 },
      }),
      tokenCount('2026-01-01T00:11:00Z', {
        total_token_usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(2);
    expect(
      result.diagnostics.find((d) => d.code === 'cumulative_counter_reset')
        ?.count,
    ).toBe(1);
  });

  it('leaves unpriced_model diagnostics on unknown models but still emits usage', () => {
    const blob = jsonl([
      sessionMeta('session-a', '2026-01-01T00:00:00Z'),
      turnContext('some-unknown-mystery-model', '2026-01-01T00:00:00Z'),
      tokenCount('2026-01-01T00:10:00Z', {
        last_token_usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
      }),
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.estimated_cost_usd).toBeNull();
    expect(result.events[0]?.pricing_source).toBe('none');
  });

  it('unwraps event_msg-wrapped token_count and turn_context rows', () => {
    // Codex rollouts encode runtime events as
    // `{type: 'event_msg', payload: {type: 'token_count', info: {…}}}`.
    // The adapter must accept the wrapped form.
    const blob = jsonl([
      sessionMeta('session-a', '2026-01-01T00:00:00Z'),
      {
        type: 'event_msg',
        timestamp: '2026-01-01T00:00:00Z',
        payload: { type: 'turn_context', model: 'gpt-5' },
      },
      {
        type: 'event_msg',
        timestamp: '2026-01-01T00:10:00Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 1000,
              output_tokens: 500,
              cached_input_tokens: 0,
              reasoning_output_tokens: 100,
            },
            last_token_usage: {
              input_tokens: 1000,
              output_tokens: 500,
              cached_input_tokens: 0,
              reasoning_output_tokens: 100,
            },
          },
        },
      },
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.observed_model).toBe('gpt-5');
    expect(event.usage.input_tokens).toBe(1000);
    expect(event.usage.output_tokens).toBe(500);
    expect(event.usage.reasoning_tokens).toBe(100);
  });

  it('advances the cumulative baseline through pre-window rows', () => {
    // A session that started BEFORE the boundary window: the first two
    // token_count rows are outside the window. The third, in-window, ships
    // only `total_token_usage`. Its delta must be measured against the
    // pre-window state, not zero, so this task is only charged for its own
    // usage.
    const blob = jsonl([
      sessionMeta('session-a', '2025-12-31T23:00:00Z'),
      turnContext('gpt-5', '2025-12-31T23:00:00Z'),
      tokenCount('2025-12-31T23:30:00Z', {
        total_token_usage: { input_tokens: 100, output_tokens: 50 },
      }),
      tokenCount('2025-12-31T23:45:00Z', {
        total_token_usage: { input_tokens: 300, output_tokens: 150 },
      }),
      tokenCount('2026-01-01T00:15:00Z', {
        total_token_usage: { input_tokens: 500, output_tokens: 250 },
      }),
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.usage.input_tokens).toBe(200);
    expect(result.events[0]?.usage.output_tokens).toBe(100);
    expect(
      result.diagnostics.find((d) => d.code === 'record_out_of_boundary')
        ?.count,
    ).toBe(2);
  });

  it('rejects files whose session_meta id is outside the boundary set', () => {
    const blob = jsonl([
      sessionMeta('session-foreign', '2026-01-01T00:00:00Z'),
      turnContext('gpt-5', '2026-01-01T00:00:00Z'),
      tokenCount('2026-01-01T00:10:00Z', {
        last_token_usage: { input_tokens: 1000, output_tokens: 500 },
      }),
    ]);
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(0);
    expect(
      result.diagnostics.find((d) => d.code === 'record_out_of_boundary')
        ?.count,
    ).toBe(1);
  });
});
