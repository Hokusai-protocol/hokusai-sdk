import { validateTaskCostSummaryV1 } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { TaskCostMeasureError } from './errors.js';
import { createTaskCostTracker } from './tracker.js';
import { fromAnthropicUsage, fromOpenAIUsage } from './usage.js';
import type {
  TaskCostTrackerOptions,
  TaskCostUsage,
  TaskUsageRecord,
} from './types.js';

const fixedNow = (): Date => new Date('2026-01-01T00:00:00Z');

function tracker(options: TaskCostTrackerOptions = {}) {
  return createTaskCostTracker({
    taskId: 'task-0001',
    now: fixedNow,
    ...options,
  });
}

function usage(input: number, output: number): Partial<TaskCostUsage> {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
}

describe('createTaskCostTracker: totals (REQ-F3)', () => {
  it('prices two models and reconciles byModel with the total', () => {
    const t = tracker({ harness: 'native' });
    expect(
      t.recordUsage({ model: 'claude-sonnet-5', usage: usage(1_000_000, 0) })
        .status,
    ).toBe('accepted');
    expect(
      t.recordUsage({ model: 'gpt-5', usage: usage(0, 1_000_000) }).status,
    ).toBe('accepted');

    const report = t.summary();
    expect(report.taskId).toBe('task-0001');
    expect(report.byModel['claude-sonnet-5']?.totalUsd).toBeCloseTo(3, 9);
    expect(report.byModel['gpt-5']?.totalUsd).toBeCloseTo(10, 9);
    expect(report.byHarness.native?.totalUsd).toBeCloseTo(13, 9);
    const sumOfModels = Object.values(report.byModel).reduce(
      (sum, slice) => sum + (slice.totalUsd ?? 0),
      0,
    );
    expect(
      Math.abs((report.totalUsd ?? Number.NaN) - sumOfModels),
    ).toBeLessThan(1e-9);
    expect(report.coverage.status).toBe('complete');
    expect(report.eventCount).toBe(2);
    expect(report.source.cost).toBe('local_estimate');
    expect(report.source.capture).toEqual(['manual']);
    expect(report.pricing.revision).not.toBeNull();
    expect(report.pricing.priceTables).toEqual(['anthropic', 'openai']);
  });

  it('rejects invalid usage with a diagnostic and unchanged totals', () => {
    const t = tracker();
    t.recordUsage({ model: 'claude-sonnet-5', usage: usage(1000, 100) });
    const before = t.summary();
    const result = t.recordUsage({
      model: 'claude-sonnet-5',
      usage: { ...usage(0, 0), inputTokens: -5 },
    });
    expect(result.status).toBe('rejected');
    const after = t.summary();
    expect(after.totalUsd).toBe(before.totalUsd);
    expect(after.eventCount).toBe(before.eventCount);
    const diagnostic = after.diagnostics.find(
      (d) => d.code === 'invalid_usage',
    );
    expect(diagnostic).toMatchObject({ level: 'warn', count: 1 });
  });

  it('returns a well-formed unavailable report when empty', () => {
    const report = tracker().summary();
    expect(report.totalUsd).toBeNull();
    expect(report.actualUsd).toBeNull();
    expect(report.estimatedUsd).toBeNull();
    expect(report.byModel).toEqual({});
    expect(report.byHarness).toEqual({});
    expect(report.usage.inputTokens).toBeNull();
    expect(report.eventCount).toBe(0);
    expect(report.coverage.status).toBe('unavailable');
    expect(report.source.cost).toBe('none');
    expect(report.source.basis).toBe('unknown');
    expect(report.summaries).toEqual([]);
    const warn = report.diagnostics.find((d) => d.code === 'no_usage_captured');
    expect(warn?.level).toBe('warn');
    expect(warn?.message).toContain('usage events or session files');
  });

  it('reset() makes the tracker equivalent to a new, empty one', () => {
    const t = tracker();
    t.recordUsage({ model: 'claude-sonnet-5', usage: usage(10, 10) });
    t.recordUsage({ model: 'not-priced', usage: { inputTokens: -1 } });
    t.reset();
    expect(t.summary()).toEqual(tracker().summary());
    expect(t.events()).toEqual([]);
    // And it keeps working after the reset.
    expect(
      t.recordUsage({ model: 'claude-sonnet-5', usage: usage(10, 10) }).status,
    ).toBe('accepted');
  });

  it('throws INVALID_ARGUMENT for programmer errors', () => {
    const t = tracker();
    for (const call of [
      () => t.recordUsage(null as unknown as TaskUsageRecord),
      () => t.recordUsage({ model: 'm', harness: 'not-a-harness' as never }),
      () => createTaskCostTracker({ taskId: '/etc/passwd' }),
      () => createTaskCostTracker({ harness: 'bogus' as never }),
      () => createTaskCostTracker({ now: 5 as never }),
      () =>
        createTaskCostTracker({
          priceOverrides: [
            { model: 'm', inputPerMTokUsd: -1, outputPerMTokUsd: 1 },
          ],
        }),
    ]) {
      expect(call).toThrowError(TaskCostMeasureError);
      try {
        call();
      } catch (error) {
        expect((error as TaskCostMeasureError).code).toBe('INVALID_ARGUMENT');
      }
    }
  });
});

describe('createTaskCostTracker: multi-harness and replay', () => {
  it('splits engines per harness and null-propagates the combined total', () => {
    const t = tracker();
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(1000, 100),
      harness: 'claude-code',
    });
    t.recordUsage({
      model: 'unpriceable-model',
      usage: usage(1000, 100),
      harness: 'codex',
    });
    const report = t.summary();
    expect(report.summaries).toHaveLength(2);
    expect(report.byHarness['claude-code']?.totalUsd).not.toBeNull();
    expect(report.byHarness.codex?.totalUsd).toBeNull();
    // One harness is unpriced, so the combined total must be null, while the
    // estimated lower bound survives.
    expect(report.totalUsd).toBeNull();
    expect(report.estimatedUsd).toBeCloseTo(0.0045, 9);
    expect(report.coverage.status).toBe('partial');
  });

  it('counts a reused eventId once, within and across harnesses', () => {
    const t = tracker();
    const record: TaskUsageRecord = {
      model: 'claude-sonnet-5',
      usage: usage(1000, 100),
      eventId: 'retry-1',
      harness: 'claude-code',
    };
    expect(t.recordUsage(record).status).toBe('accepted');
    expect(t.recordUsage(record).status).toBe('duplicate');
    expect(t.recordUsage({ ...record, harness: 'codex' }).status).toBe(
      'duplicate',
    );
    const report = t.summary();
    expect(report.eventCount).toBe(1);
    expect(report.summaries).toHaveLength(1);
    const diagnostic = report.diagnostics.find(
      (d) => d.code === 'duplicate_event',
    );
    expect(diagnostic).toMatchObject({ level: 'info', count: 2 });
  });

  it('supersedes a prior event via replayOfEventId', () => {
    const t = tracker();
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(1000, 100),
      eventId: 'e1',
    });
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(2000, 200),
      eventId: 'e2',
      replayOfEventId: 'e1',
    });
    const report = t.summary();
    expect(report.eventCount).toBe(1);
    expect(report.usage.inputTokens).toBe(2000);
  });
});

describe('createTaskCostTracker: cost semantics', () => {
  it('reports providerCostUsd: 0 as known_zero', () => {
    const t = tracker();
    t.recordUsage({
      model: 'some-free-model',
      usage: usage(10, 5),
      providerCostUsd: 0,
    });
    const report = t.summary();
    expect(report.totalUsd).toBe(0);
    expect(report.actualUsd).toBe(0);
    expect(report.coverage.status).toBe('known_zero');
    expect(report.source.cost).toBe('provider_reported');
  });

  it('keeps actualUsd null on a subscription basis and flags it', () => {
    const t = tracker({ costBasis: 'subscription' });
    t.recordUsage({ model: 'claude-sonnet-5', usage: usage(1_000_000, 0) });
    const report = t.summary();
    expect(report.actualUsd).toBeNull();
    expect(report.estimatedUsd).toBeCloseTo(3, 9);
    expect(report.source.basis).toBe('subscription');
    expect(
      report.diagnostics.some((d) => d.code === 'subscription_basis_no_charge'),
    ).toBe(true);
  });

  it('applies price overrides and reflects them in pricing provenance', () => {
    const t = tracker({
      priceOverrides: [
        {
          model: 'claude-sonnet-5',
          inputPerMTokUsd: 1,
          outputPerMTokUsd: 2,
          asOf: '2026-02-02',
        },
      ],
    });
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(1_000_000, 1_000_000),
    });
    const report = t.summary();
    expect(report.totalUsd).toBeCloseTo(3, 9); // 1 + 2, not the built-in 3 + 15
    expect(report.pricing.priceTables).toEqual(['override']);
    expect(report.pricing.overrideCount).toBe(1);
    expect(report.pricing.revision).toBe('2026-02-02');
    expect(report.pricing.revisions).toEqual(['2026-02-02']);
    expect(report.pricing.effectiveDate).toBe('2026-02-02');
  });

  it('does not double count cumulative snapshots', () => {
    const t = tracker();
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(1_000_000, 0),
      usageKind: 'cumulative',
      sessionId: 's1',
    });
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(3_000_000, 0),
      usageKind: 'cumulative',
      sessionId: 's1',
    });
    const report = t.summary();
    expect(report.usage.inputTokens).toBe(3_000_000);
    expect(report.totalUsd).toBeCloseTo(9, 9);
  });

  it('maps Anthropic and OpenAI usage payload shapes', () => {
    expect(
      fromAnthropicUsage({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      reasoningTokens: null,
    });
    // OpenAI's prompt_tokens INCLUDES cached tokens; the mapper separates
    // the tiers so pricing never double counts.
    expect(
      fromOpenAIUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({
      inputTokens: 60,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: null,
      reasoningTokens: 5,
    });
    // Malformed counters become null, never 0.
    expect(fromAnthropicUsage({ input_tokens: 'NaN' }).inputTokens).toBeNull();
    expect(fromOpenAIUsage(undefined).outputTokens).toBeNull();
  });

  it('is deterministic with an injected clock', () => {
    const run = () => {
      const t = tracker();
      t.recordUsage({ model: 'claude-sonnet-5', usage: usage(1000, 100) });
      t.recordUsage({
        model: 'gpt-5',
        usage: usage(500, 50),
        harness: 'codex',
      });
      return t.summary();
    };
    expect(run()).toEqual(run());
  });

  it('emits contract-valid summaries', () => {
    const t = tracker();
    t.recordUsage({
      model: 'claude-sonnet-5',
      usage: usage(1000, 100),
      harness: 'claude-code',
    });
    t.recordUsage({
      model: 'gpt-5-codex',
      usage: usage(500, 50),
      harness: 'codex',
    });
    const report = t.summary();
    expect(report.summaries).toHaveLength(2);
    for (const summary of report.summaries) {
      expect(() => validateTaskCostSummaryV1(summary)).not.toThrow();
    }
  });
});
