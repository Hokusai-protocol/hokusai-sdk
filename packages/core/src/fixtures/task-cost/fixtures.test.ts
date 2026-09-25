import { describe, expect, it } from 'vitest';
import { computeActualCostUsd } from '../../pricing.js';
import {
  aggregateTaskCost,
  assertNoForbiddenKeys,
  validateTaskCostEventV1,
  validateTaskCostLedgerV1,
  validateTaskCostSummaryV1,
  type TaskCostEventV1,
} from '../../task-cost/index.js';
import { taskCostFixtures } from './index.js';

/** Price an event the way the fixtures' estimates were derived. */
function priceEvent(event: TaskCostEventV1): number | undefined {
  const { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens } =
    event.usage;
  if (input_tokens === null || output_tokens === null) return undefined;
  // Codex bills reasoning tokens as output; Claude Code's are already inside output.
  const output = event.harness === 'codex' ? output_tokens + (reasoning_tokens ?? 0) : output_tokens;
  return computeActualCostUsd({
    model: event.observed_model,
    inputTokens: input_tokens,
    outputTokens: output,
    cacheReadTokens: cache_read_tokens ?? 0,
    cacheCreationTokens: cache_write_tokens ?? 0,
  });
}

describe('task-cost fixtures', () => {
  it('ships the full coverage matrix', () => {
    expect(taskCostFixtures.map((fixture) => fixture.name)).toEqual([
      'claude-code-simple',
      'claude-code-model-switch',
      'claude-code-cache-tiers',
      'claude-code-retry',
      'claude-code-cumulative-snapshot',
      'claude-code-subscription',
      'codex-simple',
      'codex-unknown-pricing',
      'codex-provider-override',
      'mixed-model',
      'native-simple',
      'pi-simple',
      'concurrent-tasks',
      'partial-usage',
      'wavemill-parity',
    ]);
    expect(new Set(taskCostFixtures.map((fixture) => fixture.name)).size).toBe(taskCostFixtures.length);
  });

  describe.each(taskCostFixtures.map((fixture) => [fixture.name, fixture] as const))('%s', (_name, fixture) => {
    it('has a valid ledger and valid events', () => {
      expect(() => validateTaskCostLedgerV1(fixture.ledger)).not.toThrow();
      for (const event of fixture.events) {
        expect(() => validateTaskCostEventV1(event)).not.toThrow();
      }
      expect(fixture.ledger.events).toEqual(fixture.events);
    });

    it('has one valid expected summary per task', () => {
      expect(fixture.expectedSummaries.map((summary) => summary.task_id)).toEqual(fixture.ledger.task_ids);
      for (const summary of fixture.expectedSummaries) {
        expect(() => validateTaskCostSummaryV1(summary)).not.toThrow();
      }
    });

    it('reduces to the hand-written expected summaries', () => {
      for (const expected of fixture.expectedSummaries) {
        expect(aggregateTaskCost(fixture.events, { taskId: expected.task_id })).toEqual(expected);
      }
    });

    it('is order-independent for events (replay and cumulative rules use ids/sequence, not array order)', () => {
      for (const expected of fixture.expectedSummaries) {
        const reversed = [...fixture.events].reverse();
        expect(aggregateTaskCost(reversed, { taskId: expected.task_id })).toEqual(expected);
      }
    });

    it('keeps local estimates consistent with the SDK price table', () => {
      for (const event of fixture.events) {
        if (event.estimated_cost_usd === null || event.observed_model === 'claude-haiku-4-5') continue;
        if (event.usage_kind === 'cumulative') continue;
        expect(event.estimated_cost_usd).toBeCloseTo(priceEvent(event) ?? Number.NaN, 9);
      }
    });

    it('contains no forbidden keys and no path/credential/identity-shaped values', () => {
      assertNoForbiddenKeys(fixture.ledger);
      for (const summary of fixture.expectedSummaries) assertNoForbiddenKeys(summary);

      const serialized = JSON.stringify([fixture.ledger, fixture.expectedSummaries]);
      const strings = [...serialized.matchAll(/"([^"\\]*)"/g)].map((match) => match[1] ?? '');
      for (const value of strings) {
        expect(value, `value ${value}`).not.toMatch(/^\/|^~|^[A-Za-z]:\\|\\|\.\.\//);
        expect(value, `value ${value}`).not.toMatch(/@/);
        expect(value, `value ${value}`).not.toMatch(/(^|[^A-Za-z])sk-[A-Za-z0-9]|bearer |api[_-]?key|password|secret/i);
        expect(value, `value ${value}`).not.toMatch(/https?:\/\//i);
        expect(value, `value ${value}`).not.toMatch(/\.(md|ts|js|json|jsonl|txt)$/i);
      }
    });

    it('uses synthetic ids only', () => {
      for (const event of fixture.events) {
        expect(event.task_id).toMatch(/^task-\d{4}$/);
        expect(event.session_id).toMatch(/^session-\d{4}$/);
        expect(event.turn_id).toMatch(/^turn-\d{4}$/);
        expect(event.event_id).toMatch(/^01900000-0000-7000-8000-\d{12}$/);
      }
    });
  });
});

describe('fixture scenario assertions', () => {
  const byName = (name: string) => {
    const fixture = taskCostFixtures.find((candidate) => candidate.name === name);
    if (!fixture) throw new Error(`missing fixture ${name}`);
    return fixture;
  };

  it('retry: superseded event is excluded and no replay_dropped is reported', () => {
    const summary = aggregateTaskCost(byName('claude-code-retry').events);
    expect(summary.event_count).toBe(3);
    expect(summary.event_ids).not.toContain('01900000-0000-7000-8000-000000000002');
    expect(summary.diagnostics).not.toContain('replay_dropped');
  });

  it('cumulative: never produces negative usage and flags the backward jump', () => {
    const summary = aggregateTaskCost(byName('claude-code-cumulative-snapshot').events);
    expect(summary.diagnostics).toContain('cumulative_backward_jump');
    for (const value of Object.values(summary.usage)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('subscription: actual is null, estimate is positive, diagnostic present', () => {
    const summary = aggregateTaskCost(byName('claude-code-subscription').events);
    expect(summary.actual_cost_usd).toBeNull();
    expect(summary.estimated_cost_usd).toBeGreaterThan(0);
    expect(summary.diagnostics).toContain('subscription_basis_no_charge');
  });

  it('mixed-model: cost_source is mixed with two segments', () => {
    const summary = aggregateTaskCost(byName('mixed-model').events);
    expect(summary.cost_source).toBe('mixed');
    expect(summary.model_segments).toHaveLength(2);
  });

  it('unknown pricing: unpriced cost is null, never 0', () => {
    const summary = aggregateTaskCost(byName('codex-unknown-pricing').events);
    expect(summary.total_cost_usd).toBeNull();
    const unpriced = summary.model_segments.find((segment) => segment.model === 'codex-unlisted-model');
    expect(unpriced?.estimated_cost_usd).toBeNull();
  });

  it('concurrent tasks: two summaries with disjoint event ids from one ledger', () => {
    const fixture = byName('concurrent-tasks');
    expect(fixture.ledger.task_ids).toEqual(['task-0001', 'task-0002']);
    const [first, second] = fixture.expectedSummaries;
    expect(first?.event_ids.filter((id) => second?.event_ids.includes(id))).toEqual([]);
  });

  it('native: known-zero counters are 0, not null', () => {
    const summary = aggregateTaskCost(byName('native-simple').events);
    expect(summary.usage.cache_read_tokens).toBe(0);
    expect(summary.usage.cache_write_tokens).toBe(0);
  });

  it('partial usage: missing output stays a gap instead of becoming 0', () => {
    const [first] = byName('partial-usage').events;
    expect(first?.usage.output_tokens).toBeNull();
    expect(first?.usage_coverage).toBe('partial');
  });
});
