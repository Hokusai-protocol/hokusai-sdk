import { describe, expect, it } from 'vitest';
import { runClaudeCodeAdapter } from './adapter.js';
import type { TaskBoundary } from '../types.js';

const BOUNDARY: TaskBoundary = {
  taskId: 'task-0001',
  allowedSessionIds: ['session-a'],
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-01-01T02:00:00Z',
};

function assistantRow(overrides: {
  uuid: string;
  timestamp: string;
  messageId: string;
  model?: string;
  usage?: Record<string, number>;
  sessionId?: string;
  costUSD?: number;
  requestId?: string;
}): Record<string, unknown> {
  return {
    type: 'assistant',
    sessionId: overrides.sessionId ?? 'session-a',
    uuid: overrides.uuid,
    timestamp: overrides.timestamp,
    ...(overrides.requestId !== undefined
      ? { requestId: overrides.requestId }
      : {}),
    ...(overrides.costUSD !== undefined ? { costUSD: overrides.costUSD } : {}),
    message: {
      id: overrides.messageId,
      model: overrides.model ?? 'claude-sonnet-5',
      role: 'assistant',
      usage: overrides.usage ?? {
        input_tokens: 1000,
        output_tokens: 500,
      },
    },
  };
}

function jsonl(rows: Record<string, unknown>[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

describe('runClaudeCodeAdapter', () => {
  it('ingests one assistant row and produces a priced summary', () => {
    const blob = jsonl([
      assistantRow({
        uuid: 'uuid-1',
        timestamp: '2026-01-01T00:10:00Z',
        messageId: 'msg-1',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    ]);
    const result = runClaudeCodeAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    expect(result.summary).not.toBeNull();
    const event = result.events[0]!;
    expect(event.harness).toBe('claude-code');
    expect(event.session_id).toBe('session-a');
    expect(event.observed_model).toBe('claude-sonnet-5');
    expect(event.usage.input_tokens).toBe(1000);
    expect(event.usage.output_tokens).toBe(500);
    expect(result.diagnostics).toEqual([]);
  });

  it('deduplicates streamed and resumed message identities across files, keeping the last occurrence', () => {
    // Same (messageId, requestId) written twice: the later occurrence carries
    // the final streaming totals and must win.
    const rowA = assistantRow({
      uuid: 'uuid-1',
      timestamp: '2026-01-01T00:10:00Z',
      messageId: 'msg-shared',
      requestId: 'req-a',
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
    const rowB = assistantRow({
      uuid: 'uuid-2',
      timestamp: '2026-01-01T00:11:00Z',
      messageId: 'msg-shared',
      requestId: 'req-a',
      usage: { input_tokens: 1000, output_tokens: 900 },
    });
    const result = runClaudeCodeAdapter({
      blobs: [jsonl([rowA]), jsonl([rowB])],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.usage.output_tokens).toBe(900);
    expect(
      result.diagnostics.find((d) => d.code === 'duplicate_record')?.count,
    ).toBe(1);
  });

  it('treats a retry with a new requestId under the same messageId as a distinct event', () => {
    // A retry reuses `message.id` but produces a fresh `requestId`; the
    // adapter must emit two events, not silently dedupe.
    const rowA = assistantRow({
      uuid: 'uuid-a',
      timestamp: '2026-01-01T00:10:00Z',
      messageId: 'msg-shared',
      requestId: 'req-a',
    });
    const rowB = assistantRow({
      uuid: 'uuid-b',
      timestamp: '2026-01-01T00:20:00Z',
      messageId: 'msg-shared',
      requestId: 'req-b',
    });
    const result = runClaudeCodeAdapter({
      blobs: [jsonl([rowA, rowB])],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.event_id)).toEqual([
      'claude-code:msg-shared:req-a',
      'claude-code:msg-shared:req-b',
    ]);
  });

  it('filters rows outside the boundary window or session set', () => {
    const rows = [
      assistantRow({
        uuid: 'uuid-outside-window',
        timestamp: '2025-12-31T00:00:00Z',
        messageId: 'msg-1',
      }),
      assistantRow({
        uuid: 'uuid-wrong-session',
        timestamp: '2026-01-01T00:10:00Z',
        messageId: 'msg-2',
        sessionId: 'session-foreign',
      }),
      assistantRow({
        uuid: 'uuid-inside',
        timestamp: '2026-01-01T00:20:00Z',
        messageId: 'msg-3',
      }),
    ];
    const result = runClaudeCodeAdapter({
      blobs: [jsonl(rows)],
      boundary: BOUNDARY,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.event_id).toBe('claude-code:msg-3');
    expect(
      result.diagnostics.find((d) => d.code === 'record_out_of_boundary')
        ?.count,
    ).toBe(2);
  });

  it('records provider-reported costUSD when the source ships one', () => {
    const blob = jsonl([
      assistantRow({
        uuid: 'uuid-1',
        timestamp: '2026-01-01T00:10:00Z',
        messageId: 'msg-1',
        costUSD: 0.05,
      }),
    ]);
    const result = runClaudeCodeAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events[0]?.actual_cost_usd).toBe(0.05);
    expect(result.events[0]?.cost_source).toBe('provider_reported');
  });

  it('handles model switches inside one boundary window', () => {
    const blob = jsonl([
      assistantRow({
        uuid: 'uuid-1',
        timestamp: '2026-01-01T00:10:00Z',
        messageId: 'msg-1',
        model: 'claude-sonnet-5',
      }),
      assistantRow({
        uuid: 'uuid-2',
        timestamp: '2026-01-01T00:11:00Z',
        messageId: 'msg-2',
        model: 'claude-opus-4-8',
        usage: { input_tokens: 200, output_tokens: 100 },
      }),
    ]);
    const result = runClaudeCodeAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(2);
    expect(result.summary?.model_segments.map((seg) => seg.model)).toEqual(
      expect.arrayContaining(['claude-sonnet-5', 'claude-opus-4-8']),
    );
  });

  it('drops malformed rows without throwing', () => {
    const blob = [
      '',
      'not-json',
      JSON.stringify({ type: 'user', sessionId: 'session-a' }),
      JSON.stringify(
        assistantRow({
          uuid: 'uuid-1',
          timestamp: '2026-01-01T00:10:00Z',
          messageId: 'msg-1',
          usage: {
            input_tokens: -1,
            output_tokens: 500,
          },
        }),
      ),
      JSON.stringify(
        assistantRow({
          uuid: 'uuid-2',
          timestamp: '2026-01-01T00:11:00Z',
          messageId: 'msg-2',
        }),
      ),
    ].join('\n');
    const result = runClaudeCodeAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('malformed_json');
    expect(codes).toContain('invalid_usage');
  });
});
