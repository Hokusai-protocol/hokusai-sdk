/**
 * Privacy proof: every fixture line is laced with SENTINEL values in prompts,
 * transcript text, paths, branches, request/account identity, and emails
 * (see `test-support.ts`). Nothing matching the sentinel — case-insensitive —
 * may survive into adapter inputs, ledger events, summaries, or diagnostics.
 *
 * The contract validator's forbidden-key denylist is asserted independently:
 * every emitted event must pass `validateTaskCostEventV1`, which rejects
 * prompt/path/identity keys at any depth.
 */

import { validateTaskCostEventV1 } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { createTaskCostEngine } from '../engine.js';
import { extractClaudeCodeUsage } from './claude-code/index.js';
import { extractCodexUsage } from './codex/index.js';
import {
  PRIVACY_SENTINEL,
  boundaryFor,
  claudeAssistantLine,
  claudeUserLine,
  codexSessionMetaLine,
  codexTokenCountLine,
  codexTurnContextLine,
  codexUsage,
} from './test-support.js';

const T0 = '2026-01-01T00:01:00Z';
const T1 = '2026-01-01T00:02:00Z';

function assertSanitized(label: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized, `${label} leaked a sentinel`).not.toMatch(
    PRIVACY_SENTINEL,
  );
}

describe('raw source fields never enter adapter or ledger output', () => {
  it('Claude Code: prompts, transcript text, paths, branch, request ids', () => {
    const sessionId = 'session-aaaa';
    const transcript = [
      claudeUserLine(sessionId, T0),
      claudeAssistantLine({
        sessionId,
        uuid: 'ua-1',
        timestamp: T0,
        costUSD: 0.01,
      }),
      claudeAssistantLine({ sessionId, uuid: 'ua-2', timestamp: T1 }),
    ].join('\n');

    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [transcript],
    });
    expect(result.inputs.length).toBeGreaterThan(0);
    assertSanitized('adapter result', result);

    const engine = createTaskCostEngine({ taskId: 'task-a' });
    engine.ingestMany(result.inputs);
    for (const event of engine.events()) {
      expect(() => validateTaskCostEventV1(event)).not.toThrow();
    }
    assertSanitized('ledger events', engine.events());
    assertSanitized('summary', engine.snapshot());
  });

  it('Codex: session_meta cwd/git/user/instructions, turn_context noise', () => {
    const sessionId = 'codex-session-1';
    const rollout = [
      codexSessionMetaLine({ id: sessionId, timestamp: T0 }),
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5-codex', timestamp: T0 }),
      codexTokenCountLine({
        timestamp: T0,
        last: codexUsage(1000, 400, 0, 0, 100),
        total: codexUsage(1000, 400, 0, 0, 100),
      }),
    ].join('\n');

    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [rollout],
    });
    expect(result.inputs.length).toBeGreaterThan(0);
    assertSanitized('adapter result', result);

    const engine = createTaskCostEngine({ taskId: 'task-a' });
    engine.ingestMany(result.inputs);
    for (const event of engine.events()) {
      expect(() => validateTaskCostEventV1(event)).not.toThrow();
    }
    assertSanitized('ledger events', engine.events());
    assertSanitized('summary', engine.snapshot());
  });
});
