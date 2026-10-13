import { describe, expect, it } from 'vitest';
import { createTaskCostTracker } from './tracker.js';
import { MeasureError, type TrackerRecordInput } from './types.js';

const NOW = (): Date => new Date('2026-01-01T00:01:00Z');

describe('createTaskCostTracker', () => {
  it('REQ-F3: manual records sum into the report, grouped by the caller label', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-manual', now: NOW });
    tracker.recordUsage({
      model: 'claude-sonnet-4-6',
      harness: 'custom',
      usage: { input: 1000, output: 500 },
    });
    tracker.recordUsage({
      model: 'claude-sonnet-4-6',
      harness: 'custom',
      usage: { input: 2000, output: 1000 },
    });

    const report = tracker.summary();
    expect(report.taskId).toBe('task-manual');
    // 3000 in × $3/MTok + 1500 out × $15/MTok
    expect(report.totalUsd).toBeCloseTo(0.0315, 9);
    expect(report.source.kind).toBe('manual');
    // The non-enum label is retained for grouping; the contract event under
    // the hood carries harness 'unknown'.
    expect(Object.keys(report.byHarness)).toEqual(['custom']);
    expect(report.byHarness['custom']?.usd).toBeCloseTo(0.0315, 9);
    const byModelSum = Object.values(report.byModel).reduce(
      (sum, entry) => sum + (entry.usd ?? 0),
      0,
    );
    expect(Math.abs((report.totalUsd ?? 0) - byModelSum)).toBeLessThan(1e-9);
  });

  it('contract-enum labels pass through unchanged', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-enum', now: NOW });
    tracker.recordUsage({
      model: 'claude-sonnet-4-6',
      harness: 'claude-code',
      usage: { input: 10, output: 5 },
    });
    expect(Object.keys(tracker.summary().byHarness)).toEqual(['claude-code']);
  });

  it('negative usage never throws: INVALID_USAGE diagnostic, totals unchanged', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-neg', now: NOW });
    tracker.recordUsage({
      model: 'claude-sonnet-4-6',
      usage: { input: 1000, output: 500 },
    });
    expect(() =>
      tracker.recordUsage({
        model: 'claude-sonnet-4-6',
        usage: { input: -5, output: 500 },
      }),
    ).not.toThrow();

    const report = tracker.summary();
    expect(report.totalUsd).toBeCloseTo(0.0105, 9);
    expect(report.coverage.pricedRecords).toBe(1);
    expect(
      report.diagnostics.some((d) => d.code === 'INVALID_USAGE'),
    ).toBe(true);
  });

  it('record(null) and shape-less input throw MeasureError INVALID_ARGUMENT', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-arg', now: NOW });
    const nullRecord = null as unknown as TrackerRecordInput;
    expect(() => tracker.record(nullRecord)).toThrowError(MeasureError);
    try {
      tracker.record(nullRecord);
    } catch (error) {
      expect((error as MeasureError).code).toBe('INVALID_ARGUMENT');
    }
    expect(() =>
      tracker.record({} as unknown as TrackerRecordInput),
    ).toThrowError(/model/);
    // A typo'd usage counter is a caller bug, not "not reported".
    expect(() =>
      tracker.record({
        model: 'claude-sonnet-4-6',
        usage: { inputTokens: 5 } as never,
      }),
    ).toThrowError(/usage.inputTokens/);
  });

  it('an unpriced model yields coverage none and an UNPRICED_MODEL diagnostic', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-unpriced', now: NOW });
    tracker.recordUsage({
      model: 'mystery/model-x',
      usage: { input: 100, output: 50 },
    });
    const report = tracker.summary();
    expect(report.totalUsd).toBeNull();
    expect(report.coverage.status).toBe('none');
    expect(report.coverage.unknownModels).toEqual(['mystery/model-x']);
    expect(
      report.diagnostics.some((d) => d.code === 'UNPRICED_MODEL'),
    ).toBe(true);
  });

  it('a repeated eventId is deduplicated, not double-counted', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-dupe', now: NOW });
    const record: TrackerRecordInput = {
      eventId: 'evt-fixed',
      model: 'claude-sonnet-4-6',
      usage: { input: 1000, output: 500 },
    };
    tracker.record(record);
    tracker.record(record);
    expect(tracker.summary().coverage.pricedRecords).toBe(1);
  });

  it('host price overrides beat the built-in table', () => {
    const tracker = createTaskCostTracker({
      taskId: 'task-override',
      now: NOW,
      priceOverrides: [
        { model: 'mystery/model-x', inputPerMTokUsd: 10, outputPerMTokUsd: 20 },
      ],
    });
    tracker.recordUsage({
      model: 'mystery/model-x',
      usage: { input: 1_000_000, output: 500_000 },
    });
    expect(tracker.summary().totalUsd).toBeCloseTo(20, 9);
  });

  it('reset() drops recorded usage and diagnostics', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-reset', now: NOW });
    tracker.recordUsage({
      model: 'claude-sonnet-4-6',
      usage: { input: -1 },
    });
    tracker.recordUsage({
      model: 'claude-sonnet-4-6',
      usage: { input: 1000, output: 500 },
    });
    tracker.reset();
    const report = tracker.summary();
    expect(report.totalUsd).toBeNull();
    expect(report.coverage.status).toBe('none');
    expect(report.diagnostics.map((d) => d.code)).toEqual([
      'NO_USAGE_CAPTURED',
    ]);
  });

  it('rejects a non-contract-safe taskId up front', () => {
    expect(() => createTaskCostTracker({ taskId: 'bad id!' })).toThrowError(
      MeasureError,
    );
  });

  it('generates a contract-safe taskId when none is given', () => {
    const tracker = createTaskCostTracker({ now: NOW });
    expect(tracker.taskId).toMatch(/^task-[a-z0-9-]+$/);
  });
});
