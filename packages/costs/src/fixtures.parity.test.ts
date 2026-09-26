/**
 * REQ-F1 / REQ-F13: every golden fixture from `@hokusai/core` must reproduce
 * its hand-written expected summaries exactly when replayed through the
 * engine, in any event order.
 */

import { taskCostFixtures, type TaskCostEventV1 } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { createTaskCostEngine } from './engine.js';

function engineForTask(taskId: string) {
  return createTaskCostEngine({ taskId });
}

function taskEvents(
  events: readonly TaskCostEventV1[],
  taskId: string,
): TaskCostEventV1[] {
  return events.filter((event) => event.task_id === taskId);
}

/** Deterministic Fisher–Yates with a tiny LCG so permutations are reproducible. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}

describe('REQ-F1: golden fixture parity through the engine', () => {
  describe.each(
    taskCostFixtures.map((fixture) => [fixture.name, fixture] as const),
  )('%s', (_name, fixture) => {
    it('reproduces every expected summary exactly', () => {
      for (const expected of fixture.expectedSummaries) {
        const engine = engineForTask(expected.task_id);
        const results = engine.ingestMany(
          taskEvents(fixture.events, expected.task_id),
        );
        for (const result of results) expect(result.status).toBe('accepted');
        expect(engine.snapshot()).toEqual(expected);
      }
    });

    it('is order-independent (reversed ingest)', () => {
      for (const expected of fixture.expectedSummaries) {
        const engine = engineForTask(expected.task_id);
        engine.ingestMany(
          [...taskEvents(fixture.events, expected.task_id)].reverse(),
        );
        expect(engine.snapshot()).toEqual(expected);
      }
    });
  });
});

describe('concurrent tasks share a ledger but never accounting state', () => {
  const fixture = taskCostFixtures.find(
    (candidate) => candidate.name === 'concurrent-tasks',
  );
  if (!fixture) throw new Error('missing concurrent-tasks fixture');

  it('each engine accepts its own events, rejects the other task, and matches its summary', () => {
    for (const expected of fixture.expectedSummaries) {
      const engine = engineForTask(expected.task_id);
      // Feed the full interleaved ledger: foreign-task events must be
      // rejected without contaminating this task's accounting.
      const results = engine.ingestMany(fixture.events);
      for (const [index, result] of results.entries()) {
        const event = fixture.events[index] as TaskCostEventV1;
        expect(result.status).toBe(
          event.task_id === expected.task_id ? 'accepted' : 'rejected',
        );
      }
      expect(engine.snapshot()).toEqual(expected);
    }
  });

  it('the two summaries have disjoint event ids', () => {
    const [first, second] = fixture.expectedSummaries;
    expect(
      first?.event_ids.filter((id) => second?.event_ids.includes(id)),
    ).toEqual([]);
  });
});

describe('REQ-F13: order independence over seeded permutations', () => {
  const fixture = taskCostFixtures.find(
    (candidate) => candidate.name === 'mixed-model',
  );
  if (!fixture) throw new Error('missing mixed-model fixture');
  const [expected] = fixture.expectedSummaries;
  if (!expected) throw new Error('mixed-model fixture has no expected summary');

  it.each(Array.from({ length: 20 }, (_, seed) => seed + 1))(
    'permutation seed %i',
    (seed) => {
      const engine = engineForTask(expected.task_id);
      engine.ingestMany(
        seededShuffle(taskEvents(fixture.events, expected.task_id), seed),
      );
      expect(engine.snapshot()).toEqual(expected);
    },
  );
});
