/**
 * HOK-3412: OpenAI pricing through the engine — the long-context tier applies
 * per request only, and Codex responses on a non-Standard service tier stay
 * unpriced.
 */
import { describe, expect, it } from 'vitest';
import { createTaskCostTracker } from './measure/index.js';
import { extractCodexUsage } from './sources/codex/index.js';
import { createTaskCostEngine } from './engine.js';

const MODEL = 'gpt-6.1-sol';

function priced(record: Parameters<ReturnType<typeof createTaskCostTracker>['recordUsage']>[0]) {
  const tracker = createTaskCostTracker({ taskId: 'task-openai', harness: 'codex', now: () => new Date('2026-11-04T12:00:00Z') });
  expect(tracker.recordUsage(record).status).toBe('accepted');
  return tracker.summary();
}

describe('long-context tier (>272K input tokens)', () => {
  it('prices a single request above the threshold at the long rates', () => {
    const report = priced({ model: MODEL, usage: { inputTokens: 272_001, outputTokens: 1000 } });
    // 272,001 * $4 + 1,000 * $15 per MTok
    expect(report.totalUsd).toBe(1.103004);
  });

  it('prices a request at the threshold at the standard rates', () => {
    const report = priced({ model: MODEL, usage: { inputTokens: 272_000, outputTokens: 1000 } });
    expect(report.totalUsd).toBe(0.554); // 272,000 * $2 + 1,000 * $10
  });

  it('never applies the long tier to a declared aggregate', () => {
    const report = priced({ model: MODEL, usage: { inputTokens: 500_000, outputTokens: 1000 }, aggregate: true });
    expect(report.totalUsd).toBe(1.01); // 500,000 * $2 + 1,000 * $10
  });

  it('never applies the long tier to a cumulative snapshot', () => {
    const report = priced({ model: MODEL, usage: { inputTokens: 500_000, outputTokens: 1000 }, usageKind: 'cumulative' });
    expect(report.totalUsd).toBe(1.01);
  });
});

function rollout(serviceTier: string | undefined): string {
  const lines = [
    { timestamp: '2026-11-04T10:00:00.000Z', type: 'session_meta', payload: { id: 'sess-tier', cli_version: '0.166.0' } },
    ...(serviceTier !== undefined
      ? [{ timestamp: '2026-11-04T10:00:00.500Z', type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { service_tier: serviceTier } } }]
      : []),
    { timestamp: '2026-11-04T10:00:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: MODEL } },
    {
      timestamp: '2026-11-04T10:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 39_258, cached_input_tokens: 26_624, output_tokens: 118, reasoning_output_tokens: 0 },
        },
      },
    },
  ];
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

function measureRollout(serviceTier: string | undefined) {
  const result = extractCodexUsage({
    boundary: { boundaryVersion: 1, taskId: 'task-tier', sessionIds: ['sess-tier'], startedAt: '2026-11-04T09:00:00Z', endedAt: '2026-11-04T11:00:00Z' },
    files: [rollout(serviceTier)],
  });
  const engine = createTaskCostEngine({ taskId: 'task-tier' });
  for (const ingest of engine.ingestMany(result.inputs)) expect(ingest.status).toBe('accepted');
  return { diagnostics: result.diagnostics, summary: engine.snapshot() };
}

describe('Codex service tier', () => {
  it('prices a Standard (`default`) response: the HOK-3412 spike turn', () => {
    const { summary, diagnostics } = measureRollout('default');
    expect(diagnostics).toEqual({});
    // 12,634 uncached * $2 + 26,624 cached * $0.10 + 118 * $10 per MTok
    expect(summary.total_cost_usd).toBe(0.02911);
  });

  it('prices a rollout that never states a tier as Standard', () => {
    expect(measureRollout(undefined).summary.total_cost_usd).toBe(0.02911);
  });

  it('leaves a non-Standard response unpriced instead of billing Standard rates', () => {
    const { summary, diagnostics } = measureRollout('priority');
    expect(diagnostics).toEqual({ unpriced_service_tier: 1 });
    expect(summary.total_cost_usd).toBeNull();
    expect(summary.usage.output_tokens).toBe(118);
    expect(summary.diagnostics).toContain('no_pricing_data');
  });
});
