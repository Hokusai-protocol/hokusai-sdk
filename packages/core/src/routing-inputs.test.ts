import { describe, expect, it } from 'vitest';
import {
  classifyRoutingPools,
  effectiveRolePool,
  resolveRoutingInput,
  singletonRoles,
  validateRoutingInput,
} from './routing-inputs.js';

describe('classifyRoutingPools', () => {
  it('treats a fully omitted pool as unconstrained ranking', () => {
    expect(classifyRoutingPools({})).toBe('ranking');
  });

  it('is ranking when every constrained role has two or more models', () => {
    expect(classifyRoutingPools({ availableModels: ['a', 'b'] })).toBe(
      'ranking',
    );
  });

  it('is non_ranking when the only constraint is a singleton', () => {
    expect(classifyRoutingPools({ availableModels: ['a'] })).toBe(
      'non_ranking',
    );
  });

  it('deduplicates before deciding a pool is a singleton', () => {
    expect(classifyRoutingPools({ availableModels: ['a', 'a', ' a '] })).toBe(
      'non_ranking',
    );
  });

  it('is partially_ranking when some roles rank and others do not', () => {
    expect(
      classifyRoutingPools({
        availableModels: ['a', 'b'],
        availableCoderModels: ['a'],
      }),
    ).toBe('partially_ranking');
  });

  it('falls a role back to the general pool when its own pool is omitted', () => {
    expect(effectiveRolePool({ availableModels: ['a', 'b'] }, 'coder')).toEqual(
      ['a', 'b'],
    );
    expect(
      effectiveRolePool(
        { availableModels: ['a', 'b'], availablePlannerModels: ['a'] },
        'planner',
      ),
    ).toEqual(['a']);
  });

  it('reports exactly which roles are singletons', () => {
    expect(
      singletonRoles({
        availableModels: ['a', 'b'],
        availablePlannerModels: ['a'],
      }),
    ).toEqual(['planner']);
  });
});

describe('validateRoutingInput', () => {
  it('accepts an omitted routing block', () => {
    expect(validateRoutingInput(undefined)).toEqual([]);
  });

  it('rejects an explicit empty candidate pool', () => {
    const errors = validateRoutingInput({ availableModels: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('routing.availableModels');
    expect(errors[0]?.code).toBe('invalid_value');
  });

  it('rejects a pool that is not an array', () => {
    const errors = validateRoutingInput({
      availableCoderModels: 'a,b' as unknown as string[],
    });
    expect(errors[0]?.code).toBe('invalid_type');
  });
});

describe('resolveRoutingInput', () => {
  it('prefers typed fields over CSV metadata and the fallback', () => {
    const resolved = resolveRoutingInput({
      routing: { availableModels: ['typed-a', 'typed-b'] },
      metadata: { available_models: 'csv-a,csv-b' },
      fallbackModels: ['fallback'],
    });
    expect(resolved.routing.availableModels).toEqual(['typed-a', 'typed-b']);
    expect(resolved.deprecations).toEqual([]);
    expect(resolved.fidelity).toBe('ranking');
  });

  it('honours deprecated CSV metadata and reports it', () => {
    const resolved = resolveRoutingInput({
      metadata: { available_models: 'csv-a, csv-b' },
      fallbackModels: ['fallback'],
    });
    expect(resolved.routing.availableModels).toEqual(['csv-a', 'csv-b']);
    expect(resolved.deprecations).toHaveLength(1);
    expect(resolved.deprecations[0]).toContain('available_models');
  });

  it('falls back to the registry pool only for availableModels', () => {
    const resolved = resolveRoutingInput({
      fallbackModels: ['reg-a', 'reg-b'],
    });
    expect(resolved.routing.availableModels).toEqual(['reg-a', 'reg-b']);
    expect(resolved.routing.availablePlannerModels).toBeUndefined();
    expect(resolved.routing.availableCoderModels).toBeUndefined();
    expect(resolved.routing.availableReviewerModels).toBeUndefined();
  });

  it('maps scalar CSV metadata (objective, budget, latency, flags)', () => {
    const resolved = resolveRoutingInput({
      metadata: {
        objective: 'speed',
        max_cost_usd: '0.5',
        max_latency_seconds: '30',
        prioritize_quality: 'true',
        prioritize_speed: 'false',
      },
      fallbackModels: ['a', 'b'],
    });
    expect(resolved.routing.objective).toBe('fastest_completion');
    expect(resolved.routing.maxCostUsd).toBe(0.5);
    expect(resolved.routing.maxLatencySeconds).toBe(30);
    expect(resolved.routing.prioritizeQuality).toBe(true);
    expect(resolved.routing.prioritizeSpeed).toBe(false);
  });

  it('classifies a CSV-derived singleton as non_ranking', () => {
    const resolved = resolveRoutingInput({
      metadata: { available_models: 'only-one' },
      fallbackModels: ['ignored'],
    });
    expect(resolved.fidelity).toBe('non_ranking');
  });
});
