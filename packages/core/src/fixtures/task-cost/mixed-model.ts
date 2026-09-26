import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * Two Anthropic turns with provider-reported charges, then a routed OpenAI
 * turn with only an estimate. The task's cost source is `mixed`; the total sums
 * each event's best figure (charge where present, estimate otherwise).
 * event 3: gpt-5, 3000 in / 1000 out -> 0.00375 + 0.01 = 0.01375
 */
const events = [
  event({ n: 1, model: 'claude-sonnet-5', usage: tokens(2000, 1000, 0, 0, 0), actual: 0.0212, estimated: 0.021 }),
  event({ n: 2, model: 'claude-sonnet-5', usage: tokens(1000, 200, 0, 0, 0), actual: 0.0061, estimated: 0.006 }),
  event({ n: 3, model: 'gpt-5', usage: tokens(3000, 1000, 0, 0, 0), estimated: 0.01375 }),
];

export const mixedModelFixture: TaskCostFixture = {
  name: 'mixed-model',
  description: 'Anthropic (charged) then OpenAI (estimated) turns: cost_source mixed, two model segments.',
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0001',
      session_ids: ['session-0001'],
      harness: 'claude-code',
      harness_version: '2.1.0',
      provider_contract_version: 'claude-code/1',
      models: ['claude-sonnet-5', 'gpt-5'],
      model_segments: [
        {
          model: 'claude-sonnet-5',
          turn_count: 2,
          usage: tokens(3000, 1200, 0, 0, 0),
          actual_cost_usd: 0.0273,
          estimated_cost_usd: 0.027,
          cost_source: 'provider_reported',
        },
        {
          model: 'gpt-5',
          turn_count: 1,
          usage: tokens(3000, 1000, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.01375,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(6000, 2200, 0, 0, 0),
      actual_cost_usd: 0.0273,
      estimated_cost_usd: 0.04075,
      total_cost_usd: 0.04105,
      cost_source: 'mixed',
      cost_basis: 'per_token_api',
      coverage: 'complete',
      field_availability: {
        usage: 'available',
        actual_cost: 'partial',
        estimated_cost: 'available',
        pricing: 'available',
      },
      pricing_revision: '2026-07-15',
      pricing_timestamp: '2026-01-01T00:03:00Z',
      pricing_source: 'local_estimate',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:03:00Z',
      event_count: 3,
      event_ids: [
        '01900000-0000-7000-8000-000000000001',
        '01900000-0000-7000-8000-000000000002',
        '01900000-0000-7000-8000-000000000003',
      ],
      diagnostics: ['provider_reported_cost'],
    },
  ],
};
