import { describe, expect, it } from 'vitest';
import { taskCostFixtures } from '../fixtures/task-cost/index.js';
import {
  TASK_COST_FORBIDDEN_KEYS,
  TaskCostValidationError,
  isTaskCostEventV1,
  isTaskCostLedgerV1,
  isTaskCostSummaryV1,
  validateTaskCostEventV1,
  validateTaskCostLedgerV1,
  validateTaskCostSummaryV1,
  type TaskCostEventV1,
} from './index.js';
import { assertNoForbiddenKeys } from './validators.js';

const baseEvent = (): TaskCostEventV1 => {
  const event = taskCostFixtures[0]?.events[0];
  if (!event) throw new Error('fixture missing');
  return structuredClone(event);
};

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof TaskCostValidationError) return error.code;
    throw error;
  }
  return undefined;
}

function expectEventRejected(mutate: (event: Record<string, unknown>) => void, code: string): void {
  const event = baseEvent() as unknown as Record<string, unknown>;
  mutate(event);
  expect(codeOf(() => validateTaskCostEventV1(event))).toBe(code);
  expect(isTaskCostEventV1(event)).toBe(false);
}

describe('validators: positive', () => {
  it('accepts every fixture event, ledger, and expected summary', () => {
    for (const fixture of taskCostFixtures) {
      expect(isTaskCostLedgerV1(fixture.ledger)).toBe(true);
      for (const event of fixture.events) expect(isTaskCostEventV1(event)).toBe(true);
      for (const summary of fixture.expectedSummaries) expect(isTaskCostSummaryV1(summary)).toBe(true);
    }
  });

  it('tolerates unknown additive fields', () => {
    const event = { ...baseEvent(), future_optional_field: 'ok' };
    expect(() => validateTaskCostEventV1(event)).not.toThrow();
  });

  it('accepts fractional-second timestamps', () => {
    const event = { ...baseEvent(), observed_at: '2026-01-01T00:00:00.123Z' };
    expect(() => validateTaskCostEventV1(event)).not.toThrow();
  });
});

describe('validators: event schema', () => {
  it('rejects non-objects', () => {
    for (const value of [null, undefined, 1, 'x', []]) {
      expect(codeOf(() => validateTaskCostEventV1(value))).toBe('schema_validation_failed');
    }
  });

  it('rejects a missing or unknown schema_version', () => {
    expectEventRejected((e) => delete e.schema_version, 'schema_validation_failed');
    expectEventRejected((e) => (e.schema_version = 'task_cost_event/v2'), 'unknown_schema_version');
    expectEventRejected((e) => (e.schema_version = 'harness_outcome_row/v1'), 'unknown_schema_version');
  });

  it.each(['event_id', 'task_id', 'session_id', 'turn_id', 'sequence', 'harness', 'observed_model', 'usage', 'observed_at', 'cost_basis', 'cost_source', 'pricing_source', 'usage_kind', 'provider_contract_version'])(
    'rejects a missing required field: %s',
    (field) => {
      const event = baseEvent() as unknown as Record<string, unknown>;
      delete event[field];
      expect(isTaskCostEventV1(event)).toBe(false);
    },
  );

  it('requires every usage counter to be present (null for missing)', () => {
    expectEventRejected((e) => delete (e.usage as Record<string, unknown>).reasoning_tokens, 'schema_validation_failed');
  });

  it('rejects negative, fractional, non-finite, and non-numeric token counts', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', undefined]) {
      expectEventRejected((e) => ((e.usage as Record<string, unknown>).input_tokens = bad), 'usage_out_of_range');
    }
  });

  it('rejects negative or non-finite costs', () => {
    expectEventRejected((e) => (e.actual_cost_usd = -0.01), 'usage_out_of_range');
    expectEventRejected((e) => (e.estimated_cost_usd = Number.NaN), 'usage_out_of_range');
    expectEventRejected((e) => (e.actual_cost_usd = undefined), 'usage_out_of_range');
  });

  it('rejects malformed timestamps', () => {
    for (const bad of ['2026-01-01', '2026-01-01T00:00:00', '2026-01-01T00:00:00+00:00', 'yesterday', '2026-02-31T00:00:00Z', '2026-13-01T00:00:00Z', 5, null]) {
      expectEventRejected((e) => (e.observed_at = bad), 'invalid_timestamp');
    }
  });

  it('rejects unknown enum values', () => {
    expectEventRejected((e) => (e.harness = 'cursor'), 'schema_validation_failed');
    expectEventRejected((e) => (e.usage_kind = 'total'), 'schema_validation_failed');
    expectEventRejected((e) => (e.cost_basis = 'free'), 'schema_validation_failed');
    expectEventRejected((e) => (e.cost_source = 'mixed'), 'schema_validation_failed');
    expectEventRejected((e) => (e.diagnostics = ['something_new']), 'schema_validation_failed');
  });

  it('rejects identifiers that look like paths, emails, or free text', () => {
    for (const bad of ['/Users/someone/repo', '../x', 'a b', 'a@b.co', '', 'x'.repeat(200), 'C:\\dir']) {
      expectEventRejected((e) => (e.task_id = bad), 'schema_validation_failed');
      expectEventRejected((e) => (e.session_id = bad), 'schema_validation_failed');
    }
    expectEventRejected((e) => (e.observed_model = '../etc/passwd'), 'schema_validation_failed');
    expectEventRejected((e) => (e.observed_model = 'a//b'), 'schema_validation_failed');
    expectEventRejected((e) => (e.harness_version = 'v 1'), 'schema_validation_failed');
  });

  it('accepts routed model ids with provider prefixes', () => {
    const event = { ...baseEvent(), observed_model: 'openrouter/anthropic/claude-sonnet-5' };
    expect(() => validateTaskCostEventV1(event)).not.toThrow();
  });

  it('rejects a self-referential replay', () => {
    expectEventRejected((e) => (e.replay_of_event_id = e.event_id), 'schema_validation_failed');
  });
});

describe('validators: event invariants', () => {
  it('requires usage_coverage to match the usage', () => {
    expectEventRejected((e) => (e.usage_coverage = 'partial'), 'schema_validation_failed');
    expectEventRejected((e) => (e.usage_coverage = 'known_zero'), 'schema_validation_failed');
  });

  it('derives coverage from null/zero patterns', () => {
    const nulls = { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: null };
    const zeros = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 };
    const cases: Array<[Record<string, number | null>, string]> = [
      [nulls, 'unavailable'],
      [zeros, 'known_zero'],
      [{ ...zeros, output_tokens: null }, 'partial'],
      [{ ...zeros, output_tokens: 5 }, 'available'],
    ];
    for (const [usage, coverage] of cases) {
      const event = { ...baseEvent(), usage, usage_coverage: coverage, actual_cost_usd: null, estimated_cost_usd: null, cost_source: 'none', pricing_source: 'none' };
      expect(() => validateTaskCostEventV1(event), coverage).not.toThrow();
    }
  });

  it('requires cost_source to match the cost fields', () => {
    expectEventRejected((e) => (e.cost_source = 'none'), 'schema_validation_failed');
    expectEventRejected((e) => (e.cost_source = 'local_estimate'), 'schema_validation_failed');
    expectEventRejected((e) => {
      e.actual_cost_usd = null;
      e.estimated_cost_usd = null;
      e.pricing_source = 'none';
      e.cost_source = 'provider_reported';
    }, 'schema_validation_failed');
  });

  it('forbids an actual charge under a subscription basis', () => {
    expectEventRejected((e) => (e.cost_basis = 'subscription'), 'schema_validation_failed');
  });

  it('keeps missing distinct from zero: a known-zero charge is legal, undefined is not', () => {
    const zeroCharge = { ...baseEvent(), actual_cost_usd: 0 };
    expect(() => validateTaskCostEventV1(zeroCharge)).not.toThrow();
  });

  it('couples pricing_source to the presence of an estimate', () => {
    expectEventRejected((e) => (e.pricing_source = 'none'), 'schema_validation_failed');
    expectEventRejected((e) => (e.pricing_source = 'mixed'), 'schema_validation_failed');
    expectEventRejected((e) => {
      e.estimated_cost_usd = null;
      e.actual_cost_usd = 0.01;
      e.pricing_source = 'local_estimate';
    }, 'schema_validation_failed');
  });
});

describe('validators: forbidden keys', () => {
  const forbidden = ['prompt', 'messages', 'email', 'api_key', 'apiKey', 'path', 'cwd', 'repo', 'workspace', 'transcript', 'prompt_hash', 'account_id', 'accountId', 'credentials', 'token', 'Authorization', 'worktree', 'branch'];

  it.each(forbidden)('rejects %s at the top level of an event', (key) => {
    const event = { ...baseEvent(), [key]: 'x' };
    expect(codeOf(() => validateTaskCostEventV1(event))).toBe('forbidden_field');
  });

  it.each(forbidden)('rejects %s nested inside usage', (key) => {
    const event = baseEvent();
    (event.usage as unknown as Record<string, unknown>)[key] = 'x';
    expect(codeOf(() => validateTaskCostEventV1(event))).toBe('forbidden_field');
  });

  it('rejects forbidden keys inside ledger events and summary segments', () => {
    const fixture = taskCostFixtures[0];
    if (!fixture) throw new Error('fixture missing');
    const ledger = structuredClone(fixture.ledger) as unknown as { events: Array<Record<string, unknown>> };
    ledger.events[0] = { ...ledger.events[0], cwd: '/tmp' };
    expect(codeOf(() => validateTaskCostLedgerV1(ledger))).toBe('forbidden_field');

    const summary = structuredClone(fixture.expectedSummaries[0]) as unknown as { model_segments: Array<Record<string, unknown>> };
    summary.model_segments[0] = { ...summary.model_segments[0], transcript: 'x' };
    expect(codeOf(() => validateTaskCostSummaryV1(summary))).toBe('forbidden_field');
  });

  it('normalizes key spelling', () => {
    for (const key of ['Account-ID', 'ACCOUNT_ID', 'accountId']) {
      expect(() => assertNoForbiddenKeys({ [key]: 1 })).toThrow(TaskCostValidationError);
    }
  });

  it('allows the legitimate token-count keys', () => {
    expect(() => assertNoForbiddenKeys({ input_tokens: 1, cache_read_tokens: 2 })).not.toThrow();
    expect(TASK_COST_FORBIDDEN_KEYS.has('inputtokens')).toBe(false);
  });

  it('reports the offending path', () => {
    expect(() => assertNoForbiddenKeys({ a: [{ b: { path: 'x' } }] })).toThrow(/a\.0\.b\.path/);
  });
});

describe('validators: summary and ledger', () => {
  it('rejects a summary whose event_count disagrees with event_ids', () => {
    const summary = structuredClone(taskCostFixtures[0]?.expectedSummaries[0]) as unknown as Record<string, unknown>;
    summary.event_count = 99;
    expect(isTaskCostSummaryV1(summary)).toBe(false);
  });

  it('rejects a summary with an unknown schema_version', () => {
    const summary = structuredClone(taskCostFixtures[0]?.expectedSummaries[0]) as unknown as Record<string, unknown>;
    summary.schema_version = 'task_cost_summary/v9';
    expect(codeOf(() => validateTaskCostSummaryV1(summary))).toBe('unknown_schema_version');
  });

  it('rejects a ledger whose event_count or task_ids disagree with its events', () => {
    const ledger = structuredClone(taskCostFixtures[0]?.ledger) as unknown as Record<string, unknown>;
    expect(isTaskCostLedgerV1({ ...ledger, event_count: 99 })).toBe(false);
    expect(isTaskCostLedgerV1({ ...ledger, task_ids: ['task-0009'] })).toBe(false);
  });

  it('rejects ledger events from another session, harness, or provider contract', () => {
    const base = structuredClone(taskCostFixtures[0]?.ledger) as unknown as { events: Array<Record<string, unknown>> };
    for (const patch of [{ session_id: 'session-0002' }, { harness: 'codex' }, { provider_contract_version: 'codex/1' }]) {
      const ledger = structuredClone(base);
      ledger.events[0] = { ...ledger.events[0], ...patch };
      expect(isTaskCostLedgerV1(ledger)).toBe(false);
    }
  });

  it('propagates event validation errors from inside a ledger', () => {
    const ledger = structuredClone(taskCostFixtures[0]?.ledger) as unknown as { events: Array<Record<string, unknown>> };
    ledger.events[0] = { ...ledger.events[0], observed_at: 'nope' };
    expect(codeOf(() => validateTaskCostLedgerV1(ledger))).toBe('invalid_timestamp');
  });

  it('accepts a ledger spanning several tasks', () => {
    const concurrent = taskCostFixtures.find((fixture) => fixture.name === 'concurrent-tasks');
    expect(isTaskCostLedgerV1(concurrent?.ledger)).toBe(true);
  });
});
