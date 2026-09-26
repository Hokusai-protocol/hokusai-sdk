import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'codex',
  providerContractVersion: 'codex/1',
  harnessVersion: '0.50.0',
};
const event = eventFactory(profile);

/**
 * Event 1 reported input tokens but no output or reasoning count. Those are
 * missing (`null`), not zero, and without output tokens the turn cannot be
 * priced. Event 2 is complete: gpt-5, 2000 in / 500 out -> 0.0025 + 0.005 = 0.0075.
 * Summed output is therefore a lower bound (500), flagged by `partial`.
 */
const events = [
  event({ n: 1, model: 'gpt-5', usage: tokens(1000, null, 0, 0, null) }),
  event({ n: 2, model: 'gpt-5', usage: tokens(2000, 500, 0, 0, 0), estimated: 0.0075 }),
];

export const partialUsageFixture: TaskCostFixture = {
  name: 'partial-usage',
  description: 'Missing (null) output tokens stay null, mark usage partial, and block pricing for that turn.',
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
      models: ['gpt-5'],
      model_segments: [
        {
          model: 'gpt-5',
          turn_count: 2,
          usage: tokens(3000, 500, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0075,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(3000, 500, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0075,
      total_cost_usd: null,
      cost_source: 'local_estimate',
      cost_basis: 'per_token_api',
      coverage: 'partial',
      field_availability: {
        usage: 'partial',
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
      diagnostics: ['missing_token_usage', 'mixed_coverage'],
    },
  ],
};
