/**
 * Codex source adapter: golden-fixture parity through the engine, delta
 * precedence, cumulative fallback with baselines/resets, and boundary
 * correlation.
 */

import { taskCostFixtures, type TaskCostFixture } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { createTaskCostEngine } from '../engine.js';
import { extractCodexUsage } from './codex/index.js';
import {
  boundaryFor,
  codexLinesFromGolden,
  codexSessionMetaLine,
  codexTokenCountLine,
  codexTurnContextLine,
  codexUsage,
} from './test-support.js';

const T0 = '2026-01-01T00:01:00Z';
const T1 = '2026-01-01T00:02:00Z';
const T2 = '2026-01-01T00:03:00Z';

function goldenFixture(name: string): TaskCostFixture {
  const fixture = taskCostFixtures.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`missing golden fixture "${name}"`);
  return fixture;
}

describe('golden fixture parity: sanitized rollout -> adapter -> engine', () => {
  const fixtures: TaskCostFixture[] = [
    goldenFixture('codex-simple'),
    goldenFixture('codex-unknown-pricing'),
  ];

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s reproduces the expected summary exactly',
    (_name, fixture) => {
      for (const expected of fixture.expectedSummaries) {
        const events = fixture.events.filter(
          (event) => event.task_id === expected.task_id,
        );
        const sessionId = expected.session_ids[0] ?? 'session-0001';
        const rollout = [
          codexSessionMetaLine({
            id: sessionId,
            timestamp: '2026-01-01T00:00:30Z',
            ...(expected.harness_version !== undefined
              ? { cliVersion: expected.harness_version }
              : {}),
          }),
          ...events.flatMap((event) => codexLinesFromGolden(event)),
        ].join('\n');

        const result = extractCodexUsage({
          boundary: boundaryFor(expected.task_id, expected.session_ids),
          files: [rollout],
        });
        expect(result.diagnostics).toEqual({});

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

describe('cumulative fallback', () => {
  const sessionId = 'codex-session-1';
  const meta = codexSessionMetaLine({ id: sessionId, timestamp: T0 });

  it('derives per-turn deltas from total_token_usage when no delta is reported', () => {
    const rollout = [
      meta,
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5-codex', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, total: codexUsage(1000, 200, 0, 0, 50) }),
      codexTurnContextLine({ turnId: 'turn-2', model: 'gpt-5-codex', timestamp: T1 }),
      codexTokenCountLine({ timestamp: T1, total: codexUsage(3000, 500, 0, 0, 125) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [rollout],
    });
    expect(result.diagnostics).toEqual({});
    expect(result.inputs).toHaveLength(2);
    expect(result.inputs[0]?.usage).toEqual({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 50,
    });
    expect(result.inputs[1]?.usage).toEqual({
      input_tokens: 2000,
      output_tokens: 300,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 75,
    });
  });

  it('a missing cumulative counter stays null in the delta, never 0', () => {
    const rollout = [
      meta,
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5-codex', timestamp: T0 }),
      codexTokenCountLine({
        timestamp: T0,
        total: { input_tokens: 1000, output_tokens: 200 },
      }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [rollout],
    });
    expect(result.inputs[0]?.usage).toEqual({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
    });
  });

  it('a counter reset treats the new (lower) totals as the new turn (REQ-F3)', () => {
    const rollout = [
      meta,
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5-codex', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, total: codexUsage(5000, 900, 0, 0, 0) }),
      // Counters regress (fresh backend context): the new lower totals count
      // as the new turn's usage per REQ-F3.
      codexTokenCountLine({ timestamp: T1, total: codexUsage(1000, 100, 0, 0, 0) }),
      // Next observation measures from the new baseline.
      codexTokenCountLine({ timestamp: T2, total: codexUsage(1500, 300, 0, 0, 0) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [rollout],
    });
    expect(result.diagnostics).toEqual({ cumulative_counter_reset: 1 });
    expect(result.inputs).toHaveLength(3);
    expect(result.inputs[1]?.usage).toEqual({
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    });
    expect(result.inputs[2]?.usage).toEqual({
      input_tokens: 500,
      output_tokens: 200,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    });
  });

  it('resumption: pre-window turns baseline the tracker so new turns are not double-charged', () => {
    // Resumed rollout: earlier turns are copied at their original timestamps
    // (before the boundary window), then new turns land inside it. Without
    // baselining, the first in-window observation would include the carried
    // total.
    const rollout = [
      meta,
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5-codex', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, total: codexUsage(500, 100, 0, 0, 0) }),
      codexTurnContextLine({ turnId: 'turn-2', model: 'gpt-5-codex', timestamp: T2 }),
      codexTokenCountLine({ timestamp: T2, total: codexUsage(700, 180, 0, 0, 0) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId], T1, '2026-01-02T00:00:00Z'),
      files: [rollout],
    });
    expect(result.diagnostics).toEqual({ outside_time_window: 1 });
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]?.usage).toEqual({
      input_tokens: 200,
      output_tokens: 80,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    });
  });

  it('pre-window observations advance the baseline without being charged', () => {
    const rollout = [
      meta,
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5-codex', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, total: codexUsage(4000, 800, 0, 0, 0) }),
      codexTurnContextLine({ turnId: 'turn-2', model: 'gpt-5-codex', timestamp: T2 }),
      codexTokenCountLine({ timestamp: T2, total: codexUsage(4600, 950, 0, 0, 0) }),
    ].join('\n');
    // The boundary starts after turn-1: a resumed session only charges the
    // task for usage inside its window.
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId], T1, '2026-01-02T00:00:00Z'),
      files: [rollout],
    });
    expect(result.diagnostics).toEqual({ outside_time_window: 1 });
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]?.usage).toEqual({
      input_tokens: 600,
      output_tokens: 150,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    });
  });
});

describe('correlation and fail-soft behavior', () => {
  it('a rollout without session_meta yields no inputs, only a count', () => {
    const rollout = [
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, last: codexUsage(100, 50, 0, 0, 0) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', ['some-session']),
      files: [rollout],
    });
    expect(result.inputs).toEqual([]);
    expect(result.diagnostics).toEqual({ missing_session_id: 1 });
  });

  it('a session outside the boundary is never attributed', () => {
    const rollout = [
      codexSessionMetaLine({ id: 'other-session', timestamp: T0 }),
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, last: codexUsage(100, 50, 0, 0, 0) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', ['bound-session']),
      files: [rollout],
    });
    expect(result.inputs).toEqual([]);
    expect(result.diagnostics).toEqual({ session_not_in_boundary: 1 });
  });

  it('model transitions are carried per event', () => {
    const sessionId = 'codex-session-1';
    const rollout = [
      codexSessionMetaLine({ id: sessionId, timestamp: T0 }),
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, last: codexUsage(100, 50, 0, 0, 0) }),
      codexTurnContextLine({ turnId: 'turn-2', model: 'gpt-5-codex', timestamp: T1 }),
      codexTokenCountLine({ timestamp: T1, last: codexUsage(200, 80, 0, 0, 0) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [rollout],
    });
    expect(result.inputs.map((input) => input.observedModel)).toEqual([
      'gpt-5',
      'gpt-5-codex',
    ]);
  });

  it('a duplicated rollout (re-supplied file) does not double-charge', () => {
    const sessionId = 'codex-session-1';
    const rollout = [
      codexSessionMetaLine({ id: sessionId, timestamp: T0 }),
      codexTurnContextLine({ turnId: 'turn-1', model: 'gpt-5', timestamp: T0 }),
      codexTokenCountLine({ timestamp: T0, last: codexUsage(100, 50, 0, 0, 0) }),
    ].join('\n');
    const result = extractCodexUsage({
      boundary: boundaryFor('task-a', [sessionId]),
      files: [rollout, rollout],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.diagnostics).toEqual({ duplicate_row: 1 });
  });
});
