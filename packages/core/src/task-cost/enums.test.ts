import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PROVIDER_CONTRACT_VERSIONS,
  TASK_COST_ADAPTER_CONTRACT_VERSION,
  TASK_COST_BASES,
  TASK_COST_CONTRACT_VERSION,
  TASK_COST_COVERAGES,
  TASK_COST_DIAGNOSTIC_CODES,
  TASK_COST_EVENT_SCHEMA_VERSION,
  TASK_COST_EVENT_SOURCES,
  TASK_COST_FIELD_AVAILABILITIES,
  TASK_COST_HARNESSES,
  TASK_COST_JOIN_CONFIDENCES,
  TASK_COST_LEDGER_SCHEMA_VERSION,
  TASK_COST_PRICE_TABLES,
  TASK_COST_PRICING_SOURCES,
  TASK_COST_REPLAY_DECISIONS,
  TASK_COST_SOURCES,
  TASK_COST_SUMMARY_SCHEMA_VERSION,
  TASK_COST_USAGE_KINDS,
  type TaskCostBasis,
  type TaskCostCoverage,
  type TaskCostEventSource,
  type TaskCostFieldAvailability,
  type TaskCostSource,
} from './index.js';

describe('task-cost versions', () => {
  it('pins contract and schema versions', () => {
    expect(TASK_COST_CONTRACT_VERSION).toBe('1.0.0');
    expect(TASK_COST_EVENT_SCHEMA_VERSION).toBe('task_cost_event/v1');
    expect(TASK_COST_SUMMARY_SCHEMA_VERSION).toBe('task_cost_summary/v1');
    expect(TASK_COST_LEDGER_SCHEMA_VERSION).toBe('task_cost_ledger/v1');
    expect(TASK_COST_ADAPTER_CONTRACT_VERSION).toBe('task_cost_adapter/v1');
  });

  it('mirrors Wavemill provider contract versions and adds native and pi', () => {
    expect(PROVIDER_CONTRACT_VERSIONS).toEqual({
      'claude-code': 'claude-code/1',
      codex: 'codex/1',
      native: 'native/1',
      pi: 'pi/1',
    });
    expect(Object.isFrozen(PROVIDER_CONTRACT_VERSIONS)).toBe(true);
  });
});

describe('task-cost enums', () => {
  it('lists every value exhaustively', () => {
    expect(TASK_COST_FIELD_AVAILABILITIES).toEqual(['available', 'partial', 'unavailable', 'known_zero']);
    expect(TASK_COST_COVERAGES).toEqual(['complete', 'partial', 'unavailable', 'known_zero']);
    expect(TASK_COST_SOURCES).toEqual(['provider_reported', 'local_estimate', 'mixed', 'none']);
    expect(TASK_COST_EVENT_SOURCES).toEqual(['provider_reported', 'local_estimate', 'none']);
    expect(TASK_COST_BASES).toEqual(['per_token_api', 'subscription', 'unknown']);
    expect(TASK_COST_JOIN_CONFIDENCES).toEqual(['branch_worktree', 'timestamp_window', 'unattributed']);
    expect(TASK_COST_HARNESSES).toEqual(['claude-code', 'codex', 'native', 'pi', 'wavemill', 'unknown']);
    expect(TASK_COST_USAGE_KINDS).toEqual(['delta', 'cumulative']);
    expect(TASK_COST_PRICING_SOURCES).toEqual(['local_estimate', 'openrouter_api', 'mixed', 'none']);
    expect(TASK_COST_PRICE_TABLES).toEqual(['anthropic', 'openai', 'google', 'openrouter', 'override', 'external']);
    expect(TASK_COST_REPLAY_DECISIONS).toEqual(['accept_first', 'drop_duplicate', 'supersede_prior']);
  });

  it('keeps Wavemill-compatible value sets as supersets/equal', () => {
    // Wavemill FieldAvailability / WorkflowCostAttributionCoverage / join confidence.
    expect([...TASK_COST_FIELD_AVAILABILITIES].sort()).toEqual(
      ['available', 'known_zero', 'partial', 'unavailable'],
    );
    expect([...TASK_COST_COVERAGES].sort()).toEqual(['complete', 'known_zero', 'partial', 'unavailable']);
    // Wavemill ExecutionEconomicsCostSource is the event source set.
    expect([...TASK_COST_EVENT_SOURCES].sort()).toEqual(['local_estimate', 'none', 'provider_reported']);
  });

  it('includes every Wavemill attribution reason code', () => {
    for (const code of [
      'missing_token_usage',
      'invalid_token_usage',
      'unpriced_model',
      'mixed_coverage',
      'provider_reported_cost',
      'no_pricing_data',
      'no_priced_sessions',
    ]) {
      expect(TASK_COST_DIAGNOSTIC_CODES).toContain(code);
    }
  });

  it('has no duplicate values', () => {
    for (const values of [
      TASK_COST_DIAGNOSTIC_CODES,
      TASK_COST_HARNESSES,
      TASK_COST_PRICE_TABLES,
      TASK_COST_SOURCES,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('derives union types from the tuples', () => {
    expectTypeOf<TaskCostFieldAvailability>().toEqualTypeOf<
      'available' | 'partial' | 'unavailable' | 'known_zero'
    >();
    expectTypeOf<TaskCostCoverage>().toEqualTypeOf<'complete' | 'partial' | 'unavailable' | 'known_zero'>();
    expectTypeOf<TaskCostSource>().toEqualTypeOf<'provider_reported' | 'local_estimate' | 'mixed' | 'none'>();
    expectTypeOf<TaskCostEventSource>().toEqualTypeOf<'provider_reported' | 'local_estimate' | 'none'>();
    expectTypeOf<TaskCostBasis>().toEqualTypeOf<'per_token_api' | 'subscription' | 'unknown'>();
  });
});
