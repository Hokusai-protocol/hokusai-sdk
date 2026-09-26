import { describe, expect, it } from 'vitest';
import { eventFactory, eventId, tokens, type EventSpec } from '../fixtures/task-cost/builders.js';
import { TaskCostValidationError } from './validators.js';
import { addNullable, deriveUsageAvailability, promoteAvailability } from './token-usage.js';
import {
  aggregateTaskCost,
  promoteCostSource,
  promoteCoverage,
  reconcileCumulative,
  resolveReplays,
} from './aggregate.js';
import type { TaskCostEventV1 } from './event.js';

const claude = eventFactory({ harness: 'claude-code', providerContractVersion: 'claude-code/1', harnessVersion: '2.1.0' });
const codex = eventFactory({ harness: 'codex', providerContractVersion: 'codex/1' });

const sonnet = (spec: Omit<EventSpec, 'model'>): TaskCostEventV1 => claude({ model: 'claude-sonnet-5', ...spec });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof TaskCostValidationError) return error.code;
    throw error;
  }
  return undefined;
}

describe('null-preserving arithmetic', () => {
  it.each([
    [null, null, null],
    [null, 5, 5],
    [5, null, 5],
    [0, null, 0],
    [null, 0, 0],
    [2, 3, 5],
    [0, 0, 0],
  ])('addNullable(%s, %s) = %s', (a, b, expected) => {
    expect(addNullable(a, b)).toBe(expected);
  });

  it('derives usage availability', () => {
    expect(deriveUsageAvailability(tokens(null, null, null, null, null))).toBe('unavailable');
    expect(deriveUsageAvailability(tokens(0, 0, 0, 0, 0))).toBe('known_zero');
    expect(deriveUsageAvailability(tokens(1, null, 0, 0, 0))).toBe('partial');
    expect(deriveUsageAvailability(tokens(1, 1, 0, 0, 0))).toBe('available');
    expect(deriveUsageAvailability(tokens(0, 0, 0, 0, null))).toBe('partial');
  });

  it.each([
    [[], 'unavailable'],
    [['unavailable', 'unavailable'], 'unavailable'],
    [['known_zero', 'known_zero'], 'known_zero'],
    [['available', 'known_zero'], 'available'],
    [['available', 'available'], 'available'],
    [['available', 'unavailable'], 'partial'],
    [['partial', 'available'], 'partial'],
    [['known_zero', 'unavailable'], 'partial'],
  ] as const)('promoteAvailability(%j) = %s', (values, expected) => {
    expect(promoteAvailability(values)).toBe(expected);
  });

  it.each([
    [[], 'unavailable'],
    [['complete', 'complete'], 'complete'],
    [['unavailable', 'unavailable'], 'unavailable'],
    [['known_zero', 'known_zero'], 'known_zero'],
    [['complete', 'known_zero'], 'complete'],
    [['complete', 'partial'], 'partial'],
    [['complete', 'unavailable'], 'partial'],
    [['known_zero', 'unavailable'], 'partial'],
    [['partial'], 'partial'],
  ] as const)('promoteCoverage(%j) = %s', (values, expected) => {
    expect(promoteCoverage(values)).toBe(expected);
  });

  it.each([
    [[], 'none'],
    [['none', 'none'], 'none'],
    [['provider_reported'], 'provider_reported'],
    [['local_estimate', 'none'], 'local_estimate'],
    [['provider_reported', 'none'], 'provider_reported'],
    [['provider_reported', 'local_estimate'], 'mixed'],
    [['mixed', 'none'], 'mixed'],
    [['mixed', 'local_estimate'], 'mixed'],
  ] as const)('promoteCostSource(%j) = %s', (values, expected) => {
    expect(promoteCostSource(values)).toBe(expected);
  });
});

describe('aggregateTaskCost: basics', () => {
  it('sums delta events and keeps missing distinct from zero', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(100, 10, null, null, null), estimated: 0.5 }),
      sonnet({ n: 2, usage: tokens(200, 20, null, null, 7), estimated: 0.25 }),
    ]);
    expect(summary.usage).toEqual(tokens(300, 30, null, null, 7));
    expect(summary.estimated_cost_usd).toBe(0.75);
    expect(summary.actual_cost_usd).toBeNull();
  });

  it('never turns an all-null field into 0', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(1, 1, null, null, null), estimated: 0.1 })]);
    expect(summary.usage.cache_read_tokens).toBeNull();
    expect(summary.usage.reasoning_tokens).toBeNull();
  });

  it('withholds the total unless every event resolved a cost, but keeps component lower bounds', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0) }),
    ]);
    expect(summary.total_cost_usd).toBeNull();
    expect(summary.estimated_cost_usd).toBe(0.1);
    expect(summary.field_availability.estimated_cost).toBe('partial');
  });

  it('prefers the actual charge over the estimate per event when totalling', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), actual: 0.2, estimated: 0.1 }),
      sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.3 }),
    ]);
    expect(summary.total_cost_usd).toBe(0.5);
    expect(summary.cost_source).toBe('mixed');
  });

  it('treats a provider-reported zero charge as known zero, not missing', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(10, 5, 0, 0, 0), actual: 0 })]);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.coverage).toBe('known_zero');
    expect(summary.field_availability.actual_cost).toBe('known_zero');
  });

  it('reports known_zero coverage for fully-observed zero usage priced at zero', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(0, 0, 0, 0, 0), estimated: 0 })]);
    expect(summary.coverage).toBe('known_zero');
    expect(summary.field_availability.usage).toBe('known_zero');
    expect(summary.total_cost_usd).toBe(0);
  });

  it('reports unavailable coverage when nothing was observed', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(null, null, null, null, null) })]);
    expect(summary.coverage).toBe('unavailable');
    expect(summary.field_availability.usage).toBe('unavailable');
    expect(summary.diagnostics).toEqual(['missing_token_usage', 'no_priced_sessions']);
    expect(summary.total_cost_usd).toBeNull();
    expect(summary.cost_source).toBe('none');
  });

  it('flags priceable-but-unpriced usage as unpriced_model with partial coverage', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(10, 5, 0, 0, 0) })]);
    expect(summary.coverage).toBe('partial');
    expect(summary.diagnostics).toEqual(['unpriced_model', 'mixed_coverage', 'no_priced_sessions']);
  });

  it('marks a charge with incomplete usage as partial', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(10, null, 0, 0, 0), actual: 0.1 })]);
    expect(summary.coverage).toBe('partial');
    expect(summary.total_cost_usd).toBe(0.1);
  });

  it('rounds USD sums to strip floating-point noise', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.2 }),
    ]);
    expect(summary.estimated_cost_usd).toBe(0.3);
  });

  it('passes event-level diagnostics through and orders diagnostics by contract order', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1, diagnostics: ['no_pricing_data', 'invalid_token_usage'] }),
    ]);
    expect(summary.diagnostics).toEqual(['invalid_token_usage', 'no_pricing_data']);
  });
});

describe('aggregateTaskCost: models and basis', () => {
  it('builds consecutive-run model segments and lists distinct models in first-seen order', () => {
    const summary = aggregateTaskCost([
      claude({ n: 1, model: 'claude-opus-4-8', usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      claude({ n: 2, model: 'claude-sonnet-5', usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      claude({ n: 3, model: 'claude-opus-4-8', usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
    ]);
    expect(summary.models).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(summary.model_segments.map((segment) => [segment.model, segment.turn_count])).toEqual([
      ['claude-opus-4-8', 1],
      ['claude-sonnet-5', 1],
      ['claude-opus-4-8', 1],
    ]);
  });

  it('collapses mixed cost bases to unknown and keeps subscription diagnostics', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1, basis: 'subscription' }),
      sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1, basis: 'per_token_api' }),
    ]);
    expect(summary.cost_basis).toBe('unknown');
    expect(summary.diagnostics).toContain('subscription_basis_no_charge');
  });

  it('reports stale_pricing_revision when revisions differ and keeps the latest', () => {
    const older = { ...sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }), pricing_revision: '2026-01-01' };
    const newer = sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 });
    const summary = aggregateTaskCost([older, newer]);
    expect(summary.diagnostics).toContain('stale_pricing_revision');
    expect(summary.pricing_revision).toBe('2026-07-15');
  });

  it('combines pricing sources to mixed, and omits pricing fields with no estimate', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1, pricingSource: 'openrouter_api', table: 'openrouter' }),
      sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
    ]);
    expect(summary.pricing_source).toBe('mixed');

    const none = aggregateTaskCost([sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), actual: 0.1 })]);
    expect(none.pricing_source).toBe('none');
    expect(none.pricing_revision).toBeUndefined();
    expect(none.pricing_timestamp).toBeUndefined();
  });

  it('omits harness_version when events disagree', () => {
    const a = sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 });
    const b = { ...sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }), harness_version: '2.2.0' };
    expect(aggregateTaskCost([a, b]).harness_version).toBeUndefined();
  });

  it('applies options', () => {
    const summary = aggregateTaskCost([sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 })], {
      collectedAt: '2026-06-01T00:00:00Z',
      joinConfidence: 'branch_worktree',
      rootSessionId: 'session-root',
      turnsTruncated: true,
    });
    expect(summary).toMatchObject({
      collected_at: '2026-06-01T00:00:00Z',
      pricing_timestamp: '2026-06-01T00:00:00Z',
      join_confidence: 'branch_worktree',
      root_session_id: 'session-root',
      turns_truncated: true,
    });
  });
});

describe('aggregateTaskCost: scope and validation', () => {
  it('requires taskId when events span tasks, and selects one when given', () => {
    const events = [
      sonnet({ n: 1, task: 'task-0001', usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      sonnet({ n: 2, task: 'task-0002', usage: tokens(2, 2, 0, 0, 0), estimated: 0.2 }),
    ];
    expect(codeOf(() => aggregateTaskCost(events))).toBe('mixed_scope');
    expect(aggregateTaskCost(events, { taskId: 'task-0002' }).usage.input_tokens).toBe(2);
  });

  it('rejects empty input and unknown tasks', () => {
    expect(codeOf(() => aggregateTaskCost([]))).toBe('schema_validation_failed');
    const events = [sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 })];
    expect(codeOf(() => aggregateTaskCost(events, { taskId: 'task-9999' }))).toBe('schema_validation_failed');
  });

  it('refuses to mix harnesses or provider contracts in one summary', () => {
    const events = [
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      codex({ n: 2, model: 'gpt-5', usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
    ];
    expect(codeOf(() => aggregateTaskCost(events))).toBe('mixed_scope');
    const bumped = { ...sonnet({ n: 2, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }), provider_contract_version: 'claude-code/2' };
    expect(codeOf(() => aggregateTaskCost([sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }), bumped]))).toBe('mixed_scope');
  });

  it('rejects invalid events', () => {
    const bad = { ...sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }), observed_at: 'nope' };
    expect(codeOf(() => aggregateTaskCost([bad]))).toBe('invalid_timestamp');
  });

  it('does not mutate its input and is independent of input order', () => {
    const events = [
      sonnet({ n: 1, usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      sonnet({ n: 2, usage: tokens(2, 2, 0, 0, 0), estimated: 0.2 }),
      sonnet({ n: 3, usage: tokens(3, 3, 0, 0, 0), estimated: 0.3 }),
    ];
    const snapshot = structuredClone(events);
    const forward = aggregateTaskCost(events);
    expect(events).toEqual(snapshot);
    expect(aggregateTaskCost([...events].reverse())).toEqual(forward);
    expect(aggregateTaskCost([events[1] as TaskCostEventV1, events[2] as TaskCostEventV1, events[0] as TaskCostEventV1])).toEqual(forward);
  });

  it('derives per-task summaries from one concurrent ledger', () => {
    const events = [
      sonnet({ n: 1, task: 'task-0001', usage: tokens(1, 1, 0, 0, 0), estimated: 0.1 }),
      sonnet({ n: 2, task: 'task-0002', usage: tokens(2, 2, 0, 0, 0), estimated: 0.2 }),
      sonnet({ n: 3, task: 'task-0001', usage: tokens(3, 3, 0, 0, 0), estimated: 0.3 }),
    ];
    const first = aggregateTaskCost(events, { taskId: 'task-0001' });
    const second = aggregateTaskCost(events, { taskId: 'task-0002' });
    expect(first.usage.input_tokens).toBe(4);
    expect(second.usage.input_tokens).toBe(2);
    expect(first.event_ids.filter((id) => second.event_ids.includes(id))).toEqual([]);
  });
});

describe('replay semantics', () => {
  const usage = tokens(100, 10, 0, 0, 0);

  it('drops a repeated event_id (first wins) and reports replay_dropped', () => {
    const original = sonnet({ n: 1, usage, estimated: 0.1 });
    const resubmitted = { ...original, usage: tokens(999, 99, 0, 0, 0), usage_coverage: 'available' as const };
    const summary = aggregateTaskCost([original, resubmitted]);
    expect(summary.event_count).toBe(1);
    expect(summary.usage.input_tokens).toBe(100);
    expect(summary.diagnostics).toContain('replay_dropped');
  });

  it('is idempotent when a whole ledger is replayed', () => {
    const events = [sonnet({ n: 1, usage, estimated: 0.1 }), sonnet({ n: 2, usage, estimated: 0.1 })];
    const once = aggregateTaskCost(events);
    const twice = aggregateTaskCost([...events, ...events]);
    expect({ ...twice, diagnostics: [] }).toEqual({ ...once, diagnostics: [] });
    expect(twice.diagnostics).toEqual(['replay_dropped']);
  });

  it('supersedes the referenced event without a replay_dropped diagnostic', () => {
    const first = sonnet({ n: 1, usage, estimated: 0.1 });
    const retry = sonnet({ n: 2, turn: first.turn_id, usage: tokens(300, 30, 0, 0, 0), estimated: 0.3, replayOf: first.event_id });
    const summary = aggregateTaskCost([first, retry]);
    expect(summary.event_ids).toEqual([retry.event_id]);
    expect(summary.usage.input_tokens).toBe(300);
    expect(summary.diagnostics).not.toContain('replay_dropped');
  });

  it('supersedes regardless of array order', () => {
    const first = sonnet({ n: 1, usage, estimated: 0.1 });
    const retry = sonnet({ n: 2, usage: tokens(300, 30, 0, 0, 0), estimated: 0.3, replayOf: first.event_id });
    expect(aggregateTaskCost([retry, first])).toEqual(aggregateTaskCost([first, retry]));
  });

  it('resolves supersede chains to the last link', () => {
    const a = sonnet({ n: 1, usage, estimated: 0.1 });
    const b = sonnet({ n: 2, usage, estimated: 0.2, replayOf: a.event_id });
    const c = sonnet({ n: 3, usage, estimated: 0.3, replayOf: b.event_id });
    const summary = aggregateTaskCost([a, b, c]);
    expect(summary.event_ids).toEqual([c.event_id]);
    expect(summary.estimated_cost_usd).toBe(0.3);
  });

  it('treats a supersede of an absent event as a normal observation', () => {
    const orphan = sonnet({ n: 2, usage, estimated: 0.1, replayOf: eventId(1) });
    const { contributing, decisions } = resolveReplays([orphan]);
    expect(contributing).toEqual([orphan]);
    expect(decisions).toEqual(['accept_first']);
  });

  it('reports per-input decisions', () => {
    const a = sonnet({ n: 1, usage, estimated: 0.1 });
    const b = sonnet({ n: 2, usage, estimated: 0.1, replayOf: a.event_id });
    expect(resolveReplays([a, b, a]).decisions).toEqual(['accept_first', 'supersede_prior', 'drop_duplicate']);
    expect(resolveReplays([a, b, a]).droppedDuplicates).toBe(1);
  });

  it('rejects replay cycles', () => {
    const a = sonnet({ n: 1, usage, estimated: 0.1, replayOf: eventId(2) });
    const b = sonnet({ n: 2, usage, estimated: 0.1, replayOf: eventId(1) });
    expect(codeOf(() => aggregateTaskCost([a, b]))).toBe('replay_cycle');
  });
});

describe('cumulative reconciliation', () => {
  const snap = (n: number, input: number | null, output: number | null, actual: number | null, extra: Partial<EventSpec> = {}) =>
    sonnet({ n, kind: 'cumulative', usage: tokens(input, output, 0, 0, 0), actual, ...extra });

  it('differences snapshots against the previous one', () => {
    const summary = aggregateTaskCost([snap(1, 100, 10, 0.1), snap(2, 250, 40, 0.25), snap(3, 250, 40, 0.25)]);
    expect(summary.usage).toEqual(tokens(250, 40, 0, 0, 0));
    expect(summary.actual_cost_usd).toBe(0.25);
    expect(summary.diagnostics).not.toContain('cumulative_backward_jump');
  });

  it('counts the first snapshot in full', () => {
    const { observations } = reconcileCumulative([snap(1, 100, 10, 0.1)]);
    expect(observations[0]?.usage.input_tokens).toBe(100);
    expect(observations[0]?.actual).toBe(0.1);
  });

  it('clamps a backward jump to zero, flags it, and rebases', () => {
    const summary = aggregateTaskCost([snap(1, 100, 10, 0.1), snap(2, 60, 20, 0.06), snap(3, 90, 30, 0.09)]);
    // input: 100 + 0 (clamped) + 30 (from rebased 60); output: 10 + 10 + 10.
    expect(summary.usage.input_tokens).toBe(130);
    expect(summary.usage.output_tokens).toBe(30);
    expect(summary.actual_cost_usd).toBe(0.13);
    expect(summary.diagnostics).toContain('cumulative_backward_jump');
    for (const value of Object.values(summary.usage)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('flags a backward jump on cost alone', () => {
    const summary = aggregateTaskCost([snap(1, 100, 10, 0.1), snap(2, 110, 12, 0.05)]);
    expect(summary.diagnostics).toContain('cumulative_backward_jump');
    expect(summary.actual_cost_usd).toBe(0.1);
  });

  it('treats a null counter as missing and leaves the baseline untouched', () => {
    const { observations } = reconcileCumulative([snap(1, 100, 10, 0.1), snap(2, null, 20, 0.2), snap(3, 150, 30, 0.3)]);
    expect(observations.map((o) => o.usage.input_tokens)).toEqual([100, null, 50]);
  });

  it('keeps separate baselines per session', () => {
    const a = snap(1, 100, 10, 0.1, { session: 'session-0001' });
    const b = snap(2, 40, 4, 0.04, { session: 'session-0002' });
    const c = snap(3, 130, 13, 0.13, { session: 'session-0001' });
    const summary = aggregateTaskCost([a, b, c]);
    expect(summary.usage.input_tokens).toBe(170);
    expect(summary.diagnostics).not.toContain('cumulative_backward_jump');
    expect(summary.session_ids).toEqual(['session-0001', 'session-0002']);
  });

  it('orders snapshots by sequence, not by array position', () => {
    const forward = aggregateTaskCost([snap(1, 100, 10, 0.1), snap(2, 200, 20, 0.2)]);
    const shuffled = aggregateTaskCost([snap(2, 200, 20, 0.2), snap(1, 100, 10, 0.1)]);
    expect(shuffled).toEqual(forward);
  });

  it('lets delta events pass through without moving the baseline', () => {
    const summary = aggregateTaskCost([
      snap(1, 100, 10, 0.1),
      sonnet({ n: 2, usage: tokens(5, 5, 0, 0, 0), estimated: 0.01 }),
      snap(3, 150, 15, 0.15),
    ]);
    expect(summary.usage.input_tokens).toBe(155);
  });

  it('derives estimated-cost deltas independently of actual-cost deltas', () => {
    const summary = aggregateTaskCost([
      sonnet({ n: 1, kind: 'cumulative', usage: tokens(100, 10, 0, 0, 0), estimated: 0.1 }),
      sonnet({ n: 2, kind: 'cumulative', usage: tokens(200, 20, 0, 0, 0), estimated: 0.3 }),
    ]);
    expect(summary.estimated_cost_usd).toBe(0.3);
    expect(summary.actual_cost_usd).toBeNull();
  });
});
