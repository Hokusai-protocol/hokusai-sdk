import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'native',
  providerContractVersion: 'native/1',
  harnessVersion: '1.0.0',
};
const event = eventFactory(profile);

/**
 * The native harness reports every counter, so cache tokens are *known zero*
 * (observed, `0`) rather than missing (`null`). Event 2 is a no-op turn whose
 * usage is entirely known-zero (`usage_coverage: 'known_zero'`) with a
 * known-zero estimate; it must not degrade the task's coverage.
 * event 1: haiku-4-5 ($1 / $5), 1200 in / 300 out -> 0.0012 + 0.0015 = 0.0027
 */
const events = [
  event({ n: 1, model: 'claude-haiku-4-5', usage: tokens(1200, 300, 0, 0, 0), estimated: 0.0027 }),
  event({ n: 2, model: 'claude-haiku-4-5', usage: tokens(0, 0, 0, 0, 0), estimated: 0 }),
];

export const nativeSimpleFixture: TaskCostFixture = {
  name: 'native-simple',
  description: 'Native harness: known-zero counters and a known-zero turn stay distinct from missing.',
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0001',
      session_ids: ['session-0001'],
      harness: 'native',
      harness_version: '1.0.0',
      provider_contract_version: 'native/1',
      models: ['claude-haiku-4-5'],
      model_segments: [
        {
          model: 'claude-haiku-4-5',
          turn_count: 2,
          usage: tokens(1200, 300, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0027,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(1200, 300, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0027,
      total_cost_usd: 0.0027,
      cost_source: 'local_estimate',
      cost_basis: 'per_token_api',
      coverage: 'complete',
      field_availability: {
        usage: 'available',
        actual_cost: 'unavailable',
        estimated_cost: 'available',
        pricing: 'available',
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
      diagnostics: [],
    },
  ],
};
