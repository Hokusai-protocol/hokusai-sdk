import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/** Single model, delta events, provider-reported cost alongside a local estimate. */
const events = [
  event({ n: 1, model: 'claude-sonnet-5', usage: tokens(1000, 500, 0, 0, 0), actual: 0.0108, estimated: 0.0105 }),
  event({ n: 2, model: 'claude-sonnet-5', usage: tokens(2000, 1000, 0, 0, 0), actual: 0.0215, estimated: 0.021 }),
  event({ n: 3, model: 'claude-sonnet-5', usage: tokens(1500, 800, 0, 0, 0), actual: 0.0166, estimated: 0.0165 }),
];

export const claudeCodeSimpleFixture: TaskCostFixture = {
  name: 'claude-code-simple',
  description: 'Happy path: one model, delta events, provider-reported cost wins over the estimate.',
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
      models: ['claude-sonnet-5'],
      model_segments: [
        {
          model: 'claude-sonnet-5',
          turn_count: 3,
          usage: tokens(4500, 2300, 0, 0, 0),
          actual_cost_usd: 0.0489,
          estimated_cost_usd: 0.048,
          cost_source: 'provider_reported',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(4500, 2300, 0, 0, 0),
      actual_cost_usd: 0.0489,
      estimated_cost_usd: 0.048,
      total_cost_usd: 0.0489,
      cost_source: 'provider_reported',
      cost_basis: 'per_token_api',
      coverage: 'complete',
      field_availability: {
        usage: 'available',
        actual_cost: 'available',
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
