/**
 * Claude Code source adapter: golden-fixture parity through the engine,
 * boundary correlation (concurrency / resumption), and fail-soft parsing.
 */

import { taskCostFixtures, type TaskCostFixture } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { createTaskCostEngine } from '../engine.js';
import { extractClaudeCodeUsage } from './claude-code/index.js';
import {
  boundaryFor,
  claudeAssistantLine,
  claudeLineFromGolden,
  claudeUsage,
  claudeUserLine,
} from './test-support.js';

const T0 = '2026-01-01T00:01:00Z';
const T1 = '2026-01-01T00:02:00Z';
const T2 = '2026-01-01T00:03:00Z';

function goldenFixture(name: string): TaskCostFixture {
  const fixture = taskCostFixtures.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`missing golden fixture "${name}"`);
  return fixture;
}

describe('golden fixture parity: sanitized transcript -> adapter -> engine', () => {
  const fixtures: TaskCostFixture[] = [
    goldenFixture('claude-code-simple'),
    goldenFixture('claude-code-model-switch'),
    goldenFixture('claude-code-cache-tiers'),
  ];

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s reproduces the expected summary exactly',
    (_name, fixture) => {
      for (const expected of fixture.expectedSummaries) {
        const transcript = fixture.events
          .filter((event) => event.task_id === expected.task_id)
          .map((event) => claudeLineFromGolden(event))
          .join('\n');
        const result = extractClaudeCodeUsage({
          boundary: boundaryFor(expected.task_id, expected.session_ids),
          files: [transcript],
        });
        expect(result.diagnostics).toEqual({});
        expect(result.sourceVersions).toEqual(['2.1.0']);

        const engine = createTaskCostEngine({
          taskId: expected.task_id,
          collectedAt: expected.collected_at,
        });
        for (const ingest of engine.ingestMany(result.inputs)) {
          expect(ingest.status).toBe('accepted');
        }
        expect(engine.snapshot()).toEqual(expected);
      }
    },
  );
});

describe('task boundaries', () => {
  const sessionA = 'session-aaaa';
  const sessionB = 'session-bbbb';
  const fileA = [
    claudeUserLine(sessionA, T0),
    claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-1', timestamp: T0 }),
    claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-2', timestamp: T1 }),
  ].join('\n');
  const fileB = [
    claudeAssistantLine({ sessionId: sessionB, uuid: 'ub-1', timestamp: T0 }),
  ].join('\n');

  it('concurrent sessions never cross-charge: only boundary sessions are attributed', () => {
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [fileA, fileB],
    });
    expect(result.inputs).toHaveLength(2);
    expect(result.inputs.every((input) => input.sessionId === sessionA)).toBe(
      true,
    );
    expect(result.inputs.every((input) => input.taskId === 'task-a')).toBe(
      true,
    );
    expect(result.diagnostics).toEqual({ session_not_in_boundary: 1 });
  });

  it('rows outside the time window are dropped, not guessed in', () => {
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA], T1, '2026-01-02T00:00:00Z'),
      files: [fileA],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]?.observedAt).toBe(T1);
    expect(result.diagnostics).toEqual({ outside_time_window: 1 });
  });

  it('session resumption does not double-charge: copied history dedupes by message id', () => {
    const original = [
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-1', timestamp: T0 }),
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-2', timestamp: T1 }),
    ].join('\n');
    const resumed = [
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-1', timestamp: T0 }),
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-2', timestamp: T1 }),
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-3', timestamp: T2 }),
    ].join('\n');
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [original, resumed],
    });
    expect(result.inputs).toHaveLength(3);
    expect(result.diagnostics).toEqual({ duplicate_row: 2 });
    expect(result.inputs.map((input) => input.sequence)).toEqual([1, 2, 3]);
  });

  it('retry (same message.id, different requestId) yields two events (REQ-F2)', () => {
    const transcript = [
      claudeAssistantLine({
        sessionId: sessionA,
        uuid: 'ua-1',
        messageId: 'msg-1',
        timestamp: T0,
        requestId: 'req-a1',
        usage: claudeUsage(1000, 100, 0, 0, 0),
      }),
      claudeAssistantLine({
        sessionId: sessionA,
        uuid: 'ua-2',
        messageId: 'msg-1',
        timestamp: T1,
        requestId: 'req-b2',
        usage: claudeUsage(1000, 200, 0, 0, 0),
      }),
    ].join('\n');
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [transcript],
    });
    expect(result.inputs).toHaveLength(2);
    expect(result.diagnostics).toEqual({});
  });

  it('streamed rows sharing a message id AND requestId collapse to the final row', () => {
    const transcript = [
      claudeAssistantLine({
        sessionId: sessionA,
        uuid: 'ua-1',
        messageId: 'msg-1',
        timestamp: T0,
        requestId: 'req-shared',
        usage: claudeUsage(1000, 100, 0, 0, 0),
      }),
      claudeAssistantLine({
        sessionId: sessionA,
        uuid: 'ua-2',
        messageId: 'msg-1',
        timestamp: T0,
        requestId: 'req-shared',
        usage: claudeUsage(1000, 900, 0, 0, 0),
      }),
    ].join('\n');
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [transcript],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]?.usage.output_tokens).toBe(900);
    expect(result.diagnostics).toEqual({ duplicate_row: 1 });
  });

  it('streamed rows sharing a message id collapse to the final row', () => {
    const transcript = [
      claudeAssistantLine({
        sessionId: sessionA,
        uuid: 'ua-1',
        messageId: 'msg-1',
        timestamp: T0,
        usage: claudeUsage(1000, 100, 0, 0, 0),
      }),
      claudeAssistantLine({
        sessionId: sessionA,
        uuid: 'ua-2',
        messageId: 'msg-1',
        timestamp: T0,
        usage: claudeUsage(1000, 900, 0, 0, 0),
      }),
    ].join('\n');
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [transcript],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]?.usage.output_tokens).toBe(900);
    expect(result.diagnostics).toEqual({ duplicate_row: 1 });
  });
});

describe('fail-soft parsing', () => {
  const sessionA = 'session-aaaa';

  it('malformed lines, missing usage, and bad session ids degrade to counts', () => {
    const transcript = [
      'this is not json',
      JSON.stringify({ type: 'assistant', sessionId: sessionA }),
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-x', timestamp: 'nonsense' }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'no-session',
        timestamp: T0,
        message: { usage: { input_tokens: 5, output_tokens: 5 } },
      }),
      claudeAssistantLine({ sessionId: sessionA, uuid: 'ua-1', timestamp: T0 }),
    ].join('\n');
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [transcript],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.diagnostics).toEqual({
      malformed_line: 1,
      missing_usage: 1,
      missing_timestamp: 1,
      missing_session_id: 1,
    });
  });

  it('present-but-malformed counters become null with an event diagnostic, never 0', () => {
    const transcript = claudeAssistantLine({
      sessionId: sessionA,
      uuid: 'ua-1',
      timestamp: T0,
      usage: claudeUsage(1000, -5, 'many', 0, 0),
    });
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: [transcript],
    });
    expect(result.inputs).toHaveLength(1);
    const input = result.inputs[0];
    if (input === undefined) throw new Error('expected input');
    expect(input.usage.output_tokens).toBeNull();
    expect(input.usage.cache_read_tokens).toBeNull();
    expect(input.diagnostics).toEqual(['invalid_token_usage']);
    expect(result.diagnostics).toEqual({ invalid_usage_value: 1 });

    // The engine accepts the degraded row with partial coverage.
    const engine = createTaskCostEngine({ taskId: 'task-a' });
    const [ingested] = engine.ingestMany(result.inputs);
    expect(ingested?.status).toBe('accepted');
    expect(engine.snapshot().field_availability.usage).toBe('partial');
  });

  it('empty input yields no inputs and no diagnostics, without throwing', () => {
    const result = extractClaudeCodeUsage({
      boundary: boundaryFor('task-a', [sessionA]),
      files: ['', '\n\n'],
    });
    expect(result.inputs).toEqual([]);
    expect(result.diagnostics).toEqual({});
    expect(result.sourceVersions).toEqual([]);
  });

  it('a misconfigured boundary throws TypeError eagerly', () => {
    expect(() =>
      extractClaudeCodeUsage({
        boundary: boundaryFor('task-a', []),
        files: [],
      }),
    ).toThrow(TypeError);
  });
});
