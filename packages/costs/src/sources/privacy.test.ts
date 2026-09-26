/**
 * Sentinel-based privacy assertions: raw source rows carry prompts, response
 * text, tool arguments, file paths, and account identifiers; none of these
 * strings may leak into emitted events, ledgers, summaries, or diagnostics.
 */

import { describe, expect, it } from 'vitest';
import { runClaudeCodeAdapter } from './claude-code/adapter.js';
import { runCodexAdapter } from './codex/adapter.js';
import type { TaskBoundary } from './types.js';

const BOUNDARY: TaskBoundary = {
  taskId: 'task-0001',
  allowedSessionIds: ['session-a'],
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-01-01T02:00:00Z',
};

const SENTINELS = [
  'SENTINEL-PROMPT-TEXT-THIS-IS-A-USER-QUESTION',
  'SENTINEL-ASSISTANT-RESPONSE-TEXT-BODY',
  'SENTINEL-TOOL-ARGUMENT-COMMAND-DELETE-EVERYTHING',
  'SENTINEL-FILE-PATH-/home/tim/secrets.env',
  'SENTINEL-ACCOUNT-EMAIL-me@timogilvie.com',
];

function containsAnySentinel(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return false;
  return SENTINELS.some((sentinel) => serialized.includes(sentinel));
}

describe('privacy: no free-text sentinel escapes source adapters', () => {
  it('claude-code adapter drops raw payload text', () => {
    const row = {
      type: 'assistant',
      sessionId: 'session-a',
      uuid: 'uuid-1',
      timestamp: '2026-01-01T00:10:00Z',
      // Free-text payloads that must never appear in ledgers.
      parentUuid: SENTINELS[3],
      cwd: SENTINELS[3],
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-5',
        role: 'assistant',
        content: [
          { type: 'text', text: SENTINELS[1] },
          { type: 'tool_use', name: 'bash', input: { command: SENTINELS[2] } },
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
      },
      user_prompt: SENTINELS[0],
      account: SENTINELS[4],
    };
    const blob = JSON.stringify(row) + '\n';
    const result = runClaudeCodeAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    for (const value of [result.events, result.summary, result.diagnostics]) {
      expect(containsAnySentinel(value)).toBe(false);
    }
  });

  it('codex adapter drops raw payload text', () => {
    const rows = [
      {
        type: 'session_meta',
        timestamp: '2026-01-01T00:00:00Z',
        payload: {
          id: 'session-a',
          cwd: SENTINELS[3],
          originator: SENTINELS[4],
        },
      },
      {
        type: 'turn_context',
        timestamp: '2026-01-01T00:00:00Z',
        payload: { model: 'gpt-5', cwd: SENTINELS[3] },
      },
      {
        type: 'event_msg',
        timestamp: '2026-01-01T00:05:00Z',
        payload: { type: 'agent_message', message: SENTINELS[1] },
      },
      {
        type: 'token_count',
        timestamp: '2026-01-01T00:10:00Z',
        payload: {
          info: {
            last_token_usage: {
              input_tokens: 1000,
              output_tokens: 500,
              cached_input_tokens: 0,
              reasoning_output_tokens: 100,
            },
            total_token_usage: {
              input_tokens: 1000,
              output_tokens: 500,
              cached_input_tokens: 0,
              reasoning_output_tokens: 100,
            },
          },
        },
      },
    ];
    const blob = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    const result = runCodexAdapter({ blobs: [blob], boundary: BOUNDARY });
    expect(result.events).toHaveLength(1);
    for (const value of [result.events, result.summary, result.diagnostics]) {
      expect(containsAnySentinel(value)).toBe(false);
    }
  });
});
