import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * Subscription plan: nothing is charged per call, so `actual_cost_usd` is
 * null. The estimate is a token-equivalent figure, not a charge.
 */
const events = [
  event({ n: 1, model: 'claude-sonnet-5', basis: 'subscription', usage: tokens(5000, 2000, 0, 0, 0), estimated: 0.045 }),
  event({ n: 2, model: 'claude-sonnet-5', basis: 'subscription', usage: tokens(3000, 1500, 0, 0, 0), estimated: 0.0315 }),
];

export const claudeCodeSubscriptionFixture: TaskCostFixture = {
  name: 'claude-code-subscription',
  description: 'Subscription cost basis: no actual charge exists; the estimate is token-equivalent only.',
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
          turn_count: 2,
          usage: tokens(8000, 3500, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0765,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(8000, 3500, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0765,
      total_cost_usd: 0.0765,
      cost_source: 'local_estimate',
      cost_basis: 'subscription',
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
      diagnostics: ['subscription_basis_no_charge'],
    },
  ],
};
