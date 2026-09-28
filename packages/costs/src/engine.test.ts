import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_PRICING_AS_OF,
  TaskCostValidationError,
  computeActualCostUsd,
  type TaskCostEventV1,
} from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { createTaskCostEngine, type IngestUsageInput } from './engine.js';

const FULL_USAGE = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
} as const;

/** A valid friendly input; claude-sonnet-4-6 prices to $0.0105 at the built-in table. */
function input(overrides: Partial<IngestUsageInput> = {}): IngestUsageInput {
  return {
    eventId: 'evt-0001',
    taskId: 'task-0001',
    sessionId: 'session-0001',
    turnId: 'turn-0001',
    sequence: 1,
    harness: 'claude-code',
    providerContractVersion: 'claude-code/1',
    observedModel: 'claude-sonnet-4-6',
    usage: { ...FULL_USAGE },
    observedAt: '2026-01-01T00:01:00Z',
    ...overrides,
  };
}

function engineFor(taskId = 'task-0001') {
  return createTaskCostEngine({ taskId });
}

describe('construction', () => {
  it('requires a non-empty taskId', () => {
    expect(() => createTaskCostEngine({ taskId: '' })).toThrow(TypeError);
  });

  it('REQ-F6d: rejects a negative override rate at construction, naming the model', () => {
    expect(() =>
      createTaskCostEngine({
        taskId: 'task-0001',
        priceOverrides: [
          { model: 'local-llama', inputPerMTokUsd: -1, outputPerMTokUsd: 0 },
        ],
      }),
    ).toThrow(/local-llama/);
  });
});

describe('REQ-F2: idempotent replay of an event id', () => {
  it('accepts once, reports duplicates, and keeps totals stable', () => {
    const engine = engineFor();
    const first = engine.ingest(input());
    expect(first.status).toBe('accepted');
    const baseline = engine.snapshot();

    for (let i = 0; i < 2; i += 1) {
      const replay = engine.ingest(input());
      expect(replay.status).toBe('duplicate');
      if (replay.status === 'duplicate') {
        expect(replay.eventId).toBe('evt-0001');
        expect(replay.event).toEqual(
          first.status === 'accepted' ? first.event : undefined,
        );
      }
    }

    expect(engine.events()).toHaveLength(1);
    const after = engine.snapshot();
    expect(after).toEqual(baseline);
    // Engine-level dedupe means the duplicate never reaches the reducer.
    expect(after.diagnostics).not.toContain('replay_dropped');
  });

  it('dedupes pre-built contract events by event_id too', () => {
    const engine = engineFor();
    const accepted = engine.ingest(input());
    if (accepted.status !== 'accepted') throw new Error('expected accepted');
    expect(engine.ingest(accepted.event).status).toBe('duplicate');
    expect(engine.events()).toHaveLength(1);
  });
});

describe('REQ-F3: task isolation', () => {
  it('two engines never share accounting state', () => {
    const engineA = engineFor('task-0001');
    const engineB = engineFor('task-0002');
    engineB.ingest(input({ taskId: 'task-0002' }));
    const snapshotBBefore = engineB.snapshot();

    engineA.ingest(input());
    engineA.ingest(
      input({ eventId: 'evt-0002', turnId: 'turn-0002', sequence: 2 }),
    );

    expect(engineB.snapshot()).toEqual(snapshotBBefore);
    expect(engineB.events()).toHaveLength(1);
  });

  it('rejects an event for another task without mutating state', () => {
    const engine = engineFor('task-0001');
    const result = engine.ingest(input({ taskId: 'task-0002' }));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected')
      expect(result.reason).toMatch(/task-0002.*task-0001/);
    expect(engine.events()).toHaveLength(0);
  });
});

describe('REQ-F4: unknown model/price yields unavailable, not zero', () => {
  it('keeps the estimate null and flags unpriced_model', () => {
    const engine = engineFor();
    const result = engine.ingest(input({ observedModel: 'mystery-model-9' }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.estimated_cost_usd).toBeNull();
    expect(result.event.actual_cost_usd).toBeNull();
    expect(result.event.cost_source).toBe('none');
    expect(result.event.diagnostics).toContain('unpriced_model');

    const summary = engine.snapshot();
    expect(summary.total_cost_usd).toBeNull();
    expect(summary.estimated_cost_usd).toBeNull();
    expect(summary.coverage).toBe('partial');
  });
});

describe('REQ-F5: partial coverage as a lower bound', () => {
  it('one priced + one unpriced event -> partial estimate, null total', () => {
    const engine = engineFor();
    engine.ingest(input());
    engine.ingest(
      input({
        eventId: 'evt-0002',
        turnId: 'turn-0002',
        sequence: 2,
        observedModel: 'mystery-model-9',
      }),
    );

    const summary = engine.snapshot();
    expect(summary.estimated_cost_usd).toBe(0.0105); // lower bound: only the priced event
    expect(summary.total_cost_usd).toBeNull(); // never presents an undercount as a total
    expect(summary.field_availability.estimated_cost).toBe('partial');
    expect(summary.coverage).toBe('partial');
    expect(summary.diagnostics).toContain('mixed_coverage');
  });
});

describe('REQ-F6: explicit zero requires known-zero evidence', () => {
  it('(a) a zero-rate override prices real usage to a confirmed $0', () => {
    const engine = createTaskCostEngine({
      taskId: 'task-0001',
      priceOverrides: [
        { model: 'local-llama', inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
      ],
    });
    const result = engine.ingest(input({ observedModel: 'local-llama' }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.estimated_cost_usd).toBe(0);
    expect(result.event.pricing_source).toBe('local_estimate');

    const summary = engine.snapshot();
    expect(summary.coverage).toBe('complete'); // usage was real, cost is a confirmed zero
    expect(summary.field_availability.estimated_cost).toBe('known_zero');
  });

  it('(a-ii) fully-zero usage priced at zero is known_zero coverage', () => {
    const engine = engineFor();
    engine.ingest(
      input({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
        },
      }),
    );
    const summary = engine.snapshot();
    expect(summary.estimated_cost_usd).toBe(0);
    expect(summary.coverage).toBe('known_zero');
  });

  it('(b) a provider-reported zero charge is a known-zero, provider-sourced cost', () => {
    const engine = engineFor();
    const result = engine.ingest(input({ actualCostUsd: 0 }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.actual_cost_usd).toBe(0);
    expect(result.event.cost_source).toBe('provider_reported');
    const summary = engine.snapshot();
    expect(summary.actual_cost_usd).toBe(0);
    expect(summary.field_availability.actual_cost).toBe('known_zero');
    expect(summary.coverage).toBe('known_zero');
  });

  it('(c) no evidence at all -> null cost, source none', () => {
    const engine = engineFor();
    const result = engine.ingest(input({ observedModel: 'mystery-model-9' }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.actual_cost_usd).toBeNull();
    expect(result.event.estimated_cost_usd).toBeNull();
    expect(result.event.cost_source).toBe('none');
  });
});

describe('REQ-F7: provider-reported cost takes precedence', () => {
  it('keeps both figures; the charge wins as the resolved total', () => {
    const engine = engineFor();
    const result = engine.ingest(input({ actualCostUsd: 0.0042 }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.actual_cost_usd).toBe(0.0042);
    expect(result.event.estimated_cost_usd).toBe(0.0105); // table estimate kept as a cross-check
    expect(result.event.cost_source).toBe('provider_reported');

    const summary = engine.snapshot();
    expect(summary.total_cost_usd).toBe(0.0042);
    expect(summary.cost_source).toBe('provider_reported');
    expect(summary.diagnostics).toContain('provider_reported_cost');
  });
});

describe('REQ-F8: host override beats the built-in table', () => {
  it('prices a table-known model from the override', () => {
    const engine = createTaskCostEngine({
      taskId: 'task-0001',
      priceOverrides: [
        { model: 'claude-sonnet-4-6', inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
      ],
    });
    const result = engine.ingest(input());
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.estimated_cost_usd).toBe(0.0015); // not the table's 0.0105
    expect(result.event.pricing_source).toBe('local_estimate');
    expect(result.event.price_table).toBe('override');
  });
});

describe('REQ-F9: cache tiers', () => {
  const cacheUsage = {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 50_000,
    cache_write_tokens: 2000,
    reasoning_tokens: 0,
  };

  it('Anthropic models use the table multipliers, matching computeActualCostUsd', () => {
    const engine = engineFor();
    const result = engine.ingest(input({ usage: { ...cacheUsage } }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.estimated_cost_usd).toBe(
      computeActualCostUsd({
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 2000,
        cacheReadTokens: 50_000,
      }),
    );
  });

  it('non-Anthropic cache tokens stay unpriced (null, no_pricing_data)', () => {
    const engine = engineFor();
    const result = engine.ingest(
      input({
        observedModel: 'gpt-5',
        harness: 'codex',
        providerContractVersion: 'codex/1',
        usage: { ...cacheUsage },
      }),
    );
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.estimated_cost_usd).toBeNull();
    expect(result.event.diagnostics).toContain('no_pricing_data');
  });

  it('override cache multipliers price cache tokens on any model', () => {
    const engine = createTaskCostEngine({
      taskId: 'task-0001',
      priceOverrides: [
        {
          model: 'gpt-5',
          inputPerMTokUsd: 2,
          outputPerMTokUsd: 4,
          cacheWriteMultiplier: 1.25,
          cacheReadMultiplier: 0.1,
        },
      ],
    });
    const result = engine.ingest(
      input({
        observedModel: 'gpt-5',
        harness: 'codex',
        providerContractVersion: 'codex/1',
        usage: { ...cacheUsage },
      }),
    );
    if (result.status !== 'accepted') throw new Error('expected accepted');
    // 0.002 + 0.002 + 2000/1e6×2×1.25 + 50000/1e6×2×0.1 = 0.004 + 0.005 + 0.01 = 0.019
    expect(result.event.estimated_cost_usd).toBe(0.019);
  });
});

describe('REQ-F10: cumulative-vs-delta usage', () => {
  function cumulative(
    n: number,
    inputTokens: number,
    outputTokens: number,
  ): IngestUsageInput {
    return input({
      eventId: `evt-000${n}`,
      turnId: `turn-000${n}`,
      sequence: n,
      usageKind: 'cumulative',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
      },
      observedAt: `2026-01-01T00:0${n}:00Z`,
    });
  }

  it('differences running totals so the summary carries the final total', () => {
    const engine = engineFor();
    engine.ingestMany([
      cumulative(1, 100, 50),
      cumulative(2, 250, 120),
      cumulative(3, 400, 200),
    ]);
    const summary = engine.snapshot();
    expect(summary.usage.input_tokens).toBe(400);
    expect(summary.usage.output_tokens).toBe(200);
    expect(summary.diagnostics).not.toContain('cumulative_backward_jump');
  });

  it('clamps a backward jump to zero and flags it', () => {
    const engine = engineFor();
    engine.ingestMany([
      cumulative(1, 100, 50),
      cumulative(2, 250, 120),
      cumulative(3, 200, 100),
    ]);
    const summary = engine.snapshot();
    expect(summary.diagnostics).toContain('cumulative_backward_jump');
    expect(summary.usage.input_tokens).toBe(250); // 100 + 150 + clamped 0
    for (const value of Object.values(summary.usage)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('REQ-F11: price provenance per row', () => {
  it('table-priced rows carry the table revision and family table', () => {
    const engine = engineFor();
    const result = engine.ingest(input());
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.pricing_revision).toBe(MODEL_PRICING_AS_OF);
    expect(result.event.price_table).toBe('anthropic');
  });

  it('override-priced rows carry the override asOf revision', () => {
    const engine = createTaskCostEngine({
      taskId: 'task-0001',
      priceOverrides: [
        {
          model: 'local-llama',
          inputPerMTokUsd: 1,
          outputPerMTokUsd: 2,
          asOf: '2026-01-01',
        },
      ],
    });
    const result = engine.ingest(input({ observedModel: 'local-llama' }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.pricing_revision).toBe('2026-01-01');
    expect(result.event.price_table).toBe('override');
  });

  it('caller-supplied estimates carry the caller provenance', () => {
    const engine = engineFor();
    const result = engine.ingest(
      input({
        estimatedCostUsd: 0.02,
        pricingSource: 'openrouter_api',
        priceTable: 'openrouter',
      }),
    );
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.estimated_cost_usd).toBe(0.02);
    expect(result.event.pricing_source).toBe('openrouter_api');
    expect(result.event.price_table).toBe('openrouter');
  });
});

describe('REQ-F12: malformed inputs', () => {
  it('rejects an empty object', () => {
    const engine = engineFor();
    const result = engine.ingest({} as unknown as IngestUsageInput);
    expect(result.status).toBe('rejected');
    expect(engine.events()).toHaveLength(0);
  });

  it.each([
    ['negative', -5],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s token counter with invalid_token_usage', (_label, bad) => {
    const engine = engineFor();
    const result = engine.ingest(
      input({ usage: { ...FULL_USAGE, input_tokens: bad } }),
    );
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toContain('invalid_token_usage');
      expect(result.diagnostics).toContain('invalid_token_usage');
    }
    expect(engine.events()).toHaveLength(0);
  });

  it('a missing counter is allowed and stored as null, never 0', () => {
    const engine = engineFor();
    const result = engine.ingest(
      input({ usage: { input_tokens: 1000, output_tokens: 500 } }),
    );
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.usage.cache_read_tokens).toBeNull();
    expect(result.event.usage.reasoning_tokens).toBeNull();
    expect(result.event.usage_coverage).toBe('partial');
  });

  it.each([
    ['NaN', Number.NaN],
    ['negative', -1],
  ])(
    'degrades a %s provider charge to null with a diagnostic (event still accepted)',
    (_label, bad) => {
      const engine = engineFor();
      const result = engine.ingest(input({ actualCostUsd: bad }));
      if (result.status !== 'accepted') throw new Error('expected accepted');
      expect(result.event.actual_cost_usd).toBeNull();
      expect(result.event.diagnostics).toContain('invalid_token_usage');
    },
  );

  it('rejects a subscription-basis input that claims a real charge', () => {
    const engine = engineFor();
    const result = engine.ingest(
      input({ costBasis: 'subscription', actualCostUsd: 0.01 }),
    );
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected')
      expect(result.reason).toContain('subscription');
  });

  it('accepts a subscription-basis input without a charge', () => {
    const engine = engineFor();
    const result = engine.ingest(input({ costBasis: 'subscription' }));
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.actual_cost_usd).toBeNull();
    expect(result.event.cost_basis).toBe('subscription');
    expect(engine.snapshot().diagnostics).toContain(
      'subscription_basis_no_charge',
    );
  });

  it('rejects malformed ids and timestamps via the contract validator', () => {
    const engine = engineFor();
    expect(engine.ingest(input({ eventId: '/etc/passwd' })).status).toBe(
      'rejected',
    );
    expect(engine.ingest(input({ observedAt: 'yesterday' })).status).toBe(
      'rejected',
    );
    expect(
      engine.ingest(input({ observedAt: '2026-02-30T00:00:00Z' })).status,
    ).toBe('rejected');
    expect(engine.events()).toHaveLength(0);
  });

  it('rejects a negative caller-supplied estimate', () => {
    const engine = engineFor();
    expect(engine.ingest(input({ estimatedCostUsd: -0.5 })).status).toBe(
      'rejected',
    );
  });

  it('rejects a malformed pre-built event', () => {
    const engine = engineFor();
    const accepted = engine.ingest(input());
    if (accepted.status !== 'accepted') throw new Error('expected accepted');
    const corrupted = {
      ...accepted.event,
      event_id: 'evt-0002',
      cost_source: 'none',
    } as TaskCostEventV1;
    const result = engine.ingest(corrupted);
    expect(result.status).toBe('rejected');
    expect(engine.events()).toHaveLength(1);
  });

  it('keeps the engine usable after every rejection', () => {
    const engine = engineFor();
    engine.ingest(input());
    engine.ingest(
      input({
        eventId: 'evt-0002',
        usage: { ...FULL_USAGE, input_tokens: -1 },
      }),
    );
    engine.ingest({} as unknown as IngestUsageInput);
    expect(engine.events()).toHaveLength(1);
    expect(() => engine.snapshot()).not.toThrow();
  });
});

describe('engine surface details', () => {
  it('events() returns a frozen list in ingest order', () => {
    const engine = engineFor();
    engine.ingest(input());
    engine.ingest(
      input({ eventId: 'evt-0002', turnId: 'turn-0002', sequence: 2 }),
    );
    const events = engine.events();
    expect(Object.isFrozen(events)).toBe(true);
    expect(events.map((event) => event.event_id)).toEqual([
      'evt-0001',
      'evt-0002',
    ]);
  });

  it('snapshot() on an empty engine throws TaskCostValidationError', () => {
    expect(() => engineFor().snapshot()).toThrow(TaskCostValidationError);
  });

  it('normalizes provider-prefixed model ids before pricing and storage', () => {
    const engine = engineFor();
    const result = engine.ingest(
      input({ observedModel: 'anthropic/claude-sonnet-4.6' }),
    );
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.event.observed_model).toBe('claude-sonnet-4-6');
    expect(result.event.estimated_cost_usd).toBe(0.0105);
  });

  it('multi-model tasks produce per-model segments and totals', () => {
    const engine = engineFor();
    engine.ingest(input());
    engine.ingest(
      input({
        eventId: 'evt-0002',
        turnId: 'turn-0002',
        sequence: 2,
        observedModel: 'claude-haiku-4-5',
        observedAt: '2026-01-01T00:02:00Z',
      }),
    );
    const summary = engine.snapshot();
    expect(summary.models).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5']);
    expect(summary.model_segments).toHaveLength(2);
    // sonnet 0.0105 + haiku (0.001 + 0.0025) = 0.014
    expect(summary.estimated_cost_usd).toBe(0.014);
  });
});

describe('large token values (NFR)', () => {
  it('prices MAX_SAFE_INTEGER tokens exactly through the BigInt override path', () => {
    const engine = createTaskCostEngine({
      taskId: 'task-0001',
      priceOverrides: [
        { model: 'local-llama', inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
      ],
    });
    const result = engine.ingest(
      input({
        observedModel: 'local-llama',
        usage: {
          input_tokens: Number.MAX_SAFE_INTEGER,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
        },
      }),
    );
    if (result.status !== 'accepted') throw new Error('expected accepted');
    // Hand-computed BigInt reference: (2^53 - 1) tokens × $1/MTok.
    expect(result.event.estimated_cost_usd).toBe(Number.MAX_SAFE_INTEGER / 1e6);
    expect(engine.snapshot().estimated_cost_usd).toBeCloseTo(
      Number.MAX_SAFE_INTEGER / 1e6,
      3,
    );
  });
});

describe('REQ-F14: offline by construction', () => {
  const srcDir = dirname(fileURLToPath(import.meta.url));

  it('imports no network modules and calls no fetch', () => {
    const files = readdirSync(srcDir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    const networkImport = /from\s+['"](?:node:)?(?:http|https|net|dns|tls)['"]/;
    const fetchCall = /\bfetch\s*\(/;
    for (const file of files) {
      const source = readFileSync(join(srcDir, file), 'utf8');
      expect(source, `${file} must not import network modules`).not.toMatch(
        networkImport,
      );
      expect(source, `${file} must not call fetch`).not.toMatch(fetchCall);
    }
  });

  it('depends only on @hokusai/core', () => {
    const packageJson = JSON.parse(
      readFileSync(join(srcDir, '..', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([
      '@hokusai/core',
    ]);
  });
});

describe.runIf(Boolean(process.env.HOKUSAI_COSTS_PERF))(
  'ingest throughput (perf NFR)',
  () => {
    it('ingests 100k events in under 2s', () => {
      const engine = engineFor();
      const start = performance.now();
      for (let i = 0; i < 100_000; i += 1) {
        engine.ingest(
          input({
            eventId: `evt-${String(i).padStart(6, '0')}`,
            turnId: `turn-${String(i).padStart(6, '0')}`,
            sequence: i + 1,
          }),
        );
      }
      expect(engine.events()).toHaveLength(100_000);
      expect(performance.now() - start).toBeLessThan(2000);
    });
  },
);
