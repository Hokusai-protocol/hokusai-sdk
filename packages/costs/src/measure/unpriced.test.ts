/**
 * REQ-F4, as reconciled with the initiative plan and the HOK-3072 contract:
 * an unknown model never yields `$0` and never lets a priced subtotal pose as
 * the total. The priced subtotal stays visible in `estimatedUsd`/`actualUsd`
 * (documented lower bounds), `totalUsd` stays `null`, and the unknown model
 * is called out in `coverage.unknownModels` plus an `unpriced_model`
 * diagnostic.
 */

import { describe, expect, it } from 'vitest';
import { createTaskCostTracker } from './tracker.js';

const fixedNow = (): Date => new Date('2026-01-01T00:00:00Z');

function fullUsage(input: number, output: number) {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
}

describe('unpriced models (REQ-F4)', () => {
  it('nulls the total while exposing the priced subtotal as a lower bound', () => {
    const t = createTaskCostTracker({ taskId: 'task-0001', now: fixedNow });
    t.recordUsage({ model: 'claude-sonnet-5', usage: fullUsage(1_000_000, 0) });
    t.recordUsage({ model: 'unknown-model-xyz', usage: fullUsage(500, 100) });

    const report = t.summary();
    expect(report.totalUsd).toBeNull();
    expect(report.estimatedUsd).toBeCloseTo(3, 9); // the priced subtotal
    expect(report.actualUsd).toBeNull();
    expect(report.coverage.status).toBe('partial');
    expect(report.coverage.unknownModels).toEqual(['unknown-model-xyz']);
    expect(report.coverage.pricedEvents).toBe(1);
    expect(report.coverage.unpricedEvents).toBe(1);
    expect(report.byModel['unknown-model-xyz']?.totalUsd).toBeNull();
    expect(report.byModel['unknown-model-xyz']?.estimatedUsd).toBeNull();
    expect(report.byModel['claude-sonnet-5']?.totalUsd).toBeCloseTo(3, 9);
    const diagnostic = report.diagnostics.find((d) => d.code === 'unpriced_model');
    expect(diagnostic).toMatchObject({ level: 'warn', count: 1 });
  });

  it('lists a thrice-used unknown model once, with one diagnostic counting 3', () => {
    const t = createTaskCostTracker({ taskId: 'task-0001', now: fixedNow });
    for (let i = 0; i < 3; i += 1) {
      t.recordUsage({ model: 'unknown-model-xyz', usage: fullUsage(100, 10) });
    }
    t.recordUsage({ model: 'claude-sonnet-5', usage: fullUsage(100, 10) });

    const report = t.summary();
    expect(report.coverage.unknownModels).toEqual(['unknown-model-xyz']);
    const diagnostics = report.diagnostics.filter((d) => d.code === 'unpriced_model');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.count).toBe(3);
  });

  it('keeps a fully-unpriced task partial (usage known, cost unknown), never $0', () => {
    // The contract rule: usage was observed, so coverage is 'partial', not
    // 'unavailable' — and the unknown cost is null, never zero.
    const t = createTaskCostTracker({ taskId: 'task-0001', now: fixedNow });
    t.recordUsage({ model: 'unknown-model-a', usage: fullUsage(100, 10) });
    t.recordUsage({ model: 'unknown-model-b', usage: fullUsage(200, 20) });

    const report = t.summary();
    expect(report.totalUsd).toBeNull();
    expect(report.estimatedUsd).toBeNull();
    expect(report.coverage.status).toBe('partial');
    expect(report.coverage.pricedEvents).toBe(0);
    expect(report.coverage.unpricedEvents).toBe(2);
    expect(report.coverage.unknownModels).toEqual(['unknown-model-a', 'unknown-model-b']);
    expect(report.diagnostics.some((d) => d.code === 'no_priced_sessions')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('"totalUsd":0');
  });
});
