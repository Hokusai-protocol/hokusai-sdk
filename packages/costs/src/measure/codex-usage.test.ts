import { describe, expect, it } from 'vitest';
import { fromCodexUsage, type CodexUsageDiagnostics } from './usage.js';
import { createTaskCostTracker } from './tracker.js';

// Hand-computed counters, independent of the rollout parser and price engine.
describe('fromCodexUsage', () => {
  it('subtracts cached input and cache writes while retaining reasoning inside output', () => {
    expect(
      fromCodexUsage({
        input_tokens: 1000,
        cached_input_tokens: 700,
        cache_write_input_tokens: 100,
        output_tokens: 300,
        reasoning_output_tokens: 200,
      }),
    ).toEqual({
      inputTokens: 200,
      cacheReadTokens: 700,
      cacheWriteTokens: 100,
      outputTokens: 300,
      reasoningTokens: 200,
    });
  });

  it.each([
    { input_tokens: 100, cached_input_tokens: 150 },
    {
      input_tokens: 100,
      cached_input_tokens: 75,
      cache_write_input_tokens: 50,
    },
  ])(
    'clamps cache underflow and increments a count-only diagnostic: %j',
    (raw) => {
      const diagnostics: CodexUsageDiagnostics = {
        codex_cache_exceeds_input: 2,
      };
      expect(fromCodexUsage(raw, diagnostics).inputTokens).toBe(0);
      expect(diagnostics).toEqual({ codex_cache_exceeds_input: 3 });
      expect(fromCodexUsage(raw).inputTokens).toBe(0);
    },
  );

  it('allows all input to be cached without recording an overflow', () => {
    const diagnostics: CodexUsageDiagnostics = {};
    expect(
      fromCodexUsage(
        { input_tokens: 100, cached_input_tokens: 100 },
        diagnostics,
      ).inputTokens,
    ).toBe(0);
    expect(diagnostics).toEqual({});
  });

  it.each([undefined, null, [], 'invalid', {}])(
    'keeps unreported usage null: %j',
    (raw) => {
      expect(fromCodexUsage(raw)).toEqual({
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
      });
    },
  );

  it('keeps missing input unknown even when cache usage is available', () => {
    const diagnostics: CodexUsageDiagnostics = {};
    expect(fromCodexUsage({ cached_input_tokens: 40 }, diagnostics)).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: 40,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
    expect(diagnostics).toEqual({});
  });

  it('does not fabricate cache or reasoning counters when only input/output are reported', () => {
    expect(fromCodexUsage({ input_tokens: 100, output_tokens: 20 })).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
  });

  it.each([-1, 1.5, NaN, Infinity, '10'])(
    'maps malformed counters to null: %j',
    (value) => {
      expect(
        fromCodexUsage({
          input_tokens: value,
          output_tokens: value,
          cached_input_tokens: value,
          cache_write_input_tokens: value,
          reasoning_output_tokens: value,
        }),
      ).toEqual({
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
      });
    },
  );

  it('preserves explicit zero counters', () => {
    expect(
      fromCodexUsage({
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        reasoning_output_tokens: 0,
      }),
    ).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
  });

  it('does not read or return unrelated payload fields or change the input', () => {
    const raw = Object.freeze({
      input_tokens: 100,
      cached_input_tokens: 80,
      get prompt(): never {
        throw new Error('prompt read');
      },
      get account_id(): never {
        throw new Error('identity read');
      },
      get cost_basis(): never {
        throw new Error('billing arrangement read');
      },
    });
    expect(fromCodexUsage(raw)).toEqual({
      inputTokens: 20,
      outputTokens: null,
      cacheReadTokens: 80,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
    expect(raw.input_tokens).toBe(100);
  });

  it('meters a CLI turn without charging cached or reasoning tokens twice', () => {
    const tracker = createTaskCostTracker({
      taskId: 'codex-host',
      harness: 'codex',
    });
    tracker.recordUsage({
      model: 'gpt-5-codex',
      usage: fromCodexUsage({
        input_tokens: 1000,
        cached_input_tokens: 800,
        output_tokens: 300,
        reasoning_output_tokens: 200,
      }),
    });
    const cost = tracker.summary();
    // 200 uncached * $1.25/M + 800 cached * $0.125/M + 300 output * $10/M.
    expect(cost.totalUsd).toBeCloseTo(0.00335, 9);
    expect(cost.usage.reasoningTokens).toBe(200);
  });
});
