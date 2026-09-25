import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * Opus 4.8 ($5 in / $25 out per MTok): cache writes bill at 1.25x input
 * ($6.25), cache reads at 0.1x input ($0.50). Estimates are per-event sums of
 * each tier.
 */
const events = [
  // 1000 in, 8000 cache write, 500 out
  event({ n: 1, model: 'claude-opus-4-8', usage: tokens(1000, 500, 0, 8000, 0), estimated: 0.0675 }),
  // 200 in, 8000 cache read, 600 out
  event({ n: 2, model: 'claude-opus-4-8', usage: tokens(200, 600, 8000, 0, 0), estimated: 0.02 }),
  // 300 in, 8000 cache read, 1000 cache write, 400 out
  event({ n: 3, model: 'claude-opus-4-8', usage: tokens(300, 400, 8000, 1000, 0), estimated: 0.02175 }),
];

export const claudeCodeCacheTiersFixture: TaskCostFixture = {
  name: 'claude-code-cache-tiers',
  description: 'Cache writes (1.25x) and reads (0.1x) tallied separately and priced per tier.',
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
      models: ['claude-opus-4-8'],
      model_segments: [
        {
          model: 'claude-opus-4-8',
          turn_count: 3,
          usage: tokens(1500, 1500, 16000, 9000, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.10925,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(1500, 1500, 16000, 9000, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.10925,
      total_cost_usd: 0.10925,
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
      diagnostics: [],
    },
  ],
};
