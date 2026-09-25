import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'codex',
  providerContractVersion: 'codex/1',
  harnessVersion: '0.50.0',
};
const event = eventFactory(profile);

/**
 * Event 2 ran a model absent from the price table: its usage is fully known
 * but no price exists, so its cost is null (never 0). The summary keeps the
 * priced event's estimate as a lower bound and withholds the total.
 * event 1: gpt-5, 1000 in / 400 out -> 0.00125 + 0.004 = 0.00525
 */
const events = [
  event({ n: 1, model: 'gpt-5', usage: tokens(1000, 400, 0, 0, 0), estimated: 0.00525 }),
  event({ n: 2, model: 'codex-unlisted-model', usage: tokens(2000, 700, 0, 0, 0) }),
];

export const codexUnknownPricingFixture: TaskCostFixture = {
  name: 'codex-unknown-pricing',
  description: 'A model missing from the price table yields a null cost, partial coverage, and no total.',
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0001',
      session_ids: ['session-0001'],
      harness: 'codex',
      harness_version: '0.50.0',
      provider_contract_version: 'codex/1',
      models: ['gpt-5', 'codex-unlisted-model'],
      model_segments: [
        {
          model: 'gpt-5',
          turn_count: 1,
          usage: tokens(1000, 400, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.00525,
          cost_source: 'local_estimate',
        },
        {
          model: 'codex-unlisted-model',
          turn_count: 1,
          usage: tokens(2000, 700, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: null,
          cost_source: 'none',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(3000, 1100, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.00525,
      total_cost_usd: null,
      cost_source: 'local_estimate',
      cost_basis: 'per_token_api',
      coverage: 'partial',
      field_availability: {
        usage: 'available',
        actual_cost: 'unavailable',
        estimated_cost: 'partial',
        pricing: 'partial',
      },
      pricing_revision: '2026-07-15',
      pricing_timestamp: '2026-01-01T00:02:00Z',
      pricing_source: 'local_estimate',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:02:00Z',
      event_count: 2,
      event_ids: [
        '01900000-0000-7000-8000-000000000001',
        '01900000-0000-7000-8000-000000000002',
      ],
      diagnostics: ['unpriced_model', 'mixed_coverage'],
    },
  ],
};
