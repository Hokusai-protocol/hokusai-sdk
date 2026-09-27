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
import { extractEventSourceUsage } from './event-source.js';
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
        // requestId flows into event_id for retry dedupe: use a real-shaped
        // value so any sentinel appearance in output would be a genuine leak.
        requestId: 'req-a1b2',
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

  it('event-source: extra caller fields (prompt, userId, cwd) never survive projection', () => {
    const sessionId = 'session-evt';
    const friendly = {
      // Contract-shaped fields (allow-listed).
      eventId: 'evt-friendly-1',
      taskId: 'task-a',
      sessionId,
      turnId: 'turn-1',
      sequence: 1,
      harness: 'pi',
      harnessVersion: '1.2.3',
      providerContractVersion: 'pi/1',
      observedModel: 'claude-sonnet-5',
      usage: { input_tokens: 1000, output_tokens: 500 },
      observedAt: T0,
      // Sentinel-laced fields that must never enter the output.
      prompt: 'SENTINEL_PROMPT do the task',
      userId: 'user_SENTINEL',
      cwd: '/Users/sentinel-user/SENTINEL_PATH/repo',
      transcript: 'SENTINEL_TRANSCRIPT_TEXT',
      accountId: 'acct_SENTINEL',
      path: '/home/SENTINEL_PATH/log.jsonl',
    };
    const prebuilt = {
      schema_version: 'task_cost_event/v1',
      event_id: 'evt-prebuilt-1',
      task_id: 'task-a',
      session_id: sessionId,
      turn_id: 'turn-2',
      sequence: 2,
      harness: 'pi',
      harness_version: '1.2.3',
      provider_contract_version: 'pi/1',
      observed_model: 'claude-sonnet-5',
      usage_kind: 'delta',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: null,
        cache_write_tokens: null,
        reasoning_tokens: null,
      },
      usage_coverage: 'partial',
      actual_cost_usd: null,
      estimated_cost_usd: null,
      cost_source: 'none',
      cost_basis: 'per_token_api',
      pricing_source: 'none',
      observed_at: T1,
      // Sentinel-laced fields the adapter must strip when rebuilding.
      prompt: 'SENTINEL_PROMPT',
      cwd: '/Users/sentinel-user/SENTINEL_PATH/repo',
      messages: [{ role: 'user', content: 'SENTINEL_TRANSCRIPT_TEXT' }],
      email: 'sentinel@example.com',
    };

    const result = extractEventSourceUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      records: [friendly, prebuilt],
    });
    expect(result.inputs).toHaveLength(2);
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
