/**
 * Shared builders for the measure tests AND the committed example fixture
 * (`examples/fixtures/claude-code-session.jsonl`). Test-only; excluded from
 * the published build. The fixture content is generated from the sanitized
 * `sources/test-support.ts` builders, so it carries SENTINEL placeholders in
 * every privacy-sensitive field and no real prompt/path/account content; a
 * test asserts the committed file equals this generator's output, so the two
 * cannot drift.
 *
 * @module measure/test-support
 */

import {
  claudeAssistantLine,
  claudeUsage,
  claudeUserLine,
} from '../sources/test-support.js';

/** Boundary values the session-file example and tests share. */
export const EXAMPLE_SESSION_ID = 'example-session-0001';
export const EXAMPLE_TASK_ID = 'task-offline-example';
export const EXAMPLE_WINDOW = {
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T01:00:00Z',
} as const;

/** The bundled Claude Code session fixture: two priced turns, one user line. */
export function buildExampleClaudeSessionJsonl(): string {
  const lines = [
    claudeUserLine(EXAMPLE_SESSION_ID, '2026-01-01T00:09:00Z'),
    claudeAssistantLine({
      sessionId: EXAMPLE_SESSION_ID,
      uuid: 'example-turn-0001',
      messageId: 'msg-example-0001',
      requestId: 'req-example-0001',
      timestamp: '2026-01-01T00:10:00Z',
      model: 'claude-sonnet-5',
      usage: claudeUsage(12_000, 1_800, 2_000, 500, 300),
    }),
    claudeAssistantLine({
      sessionId: EXAMPLE_SESSION_ID,
      uuid: 'example-turn-0002',
      messageId: 'msg-example-0002',
      requestId: 'req-example-0002',
      timestamp: '2026-01-01T00:20:00Z',
      model: 'claude-sonnet-5',
      usage: claudeUsage(9_500, 2_400, 6_000, 0, 150),
    }),
  ];
  return `${lines.join('\n')}\n`;
}
