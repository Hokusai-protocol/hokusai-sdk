import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * Parity fixture: a three-turn Claude Code session with a model switch, cache
 * tiers, and provider-reported cost, using only models whose prices agree in
 * the SDK table and Wavemill's default table (opus-4-8: $5/$25; sonnet-4-6:
 * $3/$15). Wavemill's `buildExecutionEconomics` produced the matching golden
 * in `wavemill-golden.ts`; see `task-cost/wavemill-parity.md`.
 */
const events = [
  event({ n: 1, model: 'claude-opus-4-8', usage: tokens(2500, 900, 12000, 3000, 200), actual: 0.0601, estimated: 0.05975 }),
  event({ n: 2, model: 'claude-opus-4-8', usage: tokens(1200, 700, 15000, 0, 100), actual: 0.0312, estimated: 0.031 }),
  event({ n: 3, model: 'claude-sonnet-4-6', usage: tokens(3000, 1000, 20000, 500, 0), actual: 0.032, estimated: 0.031875 }),
];

export const wavemillParityFixture: TaskCostFixture = {
  name: 'wavemill-parity',
  description: 'Multi-model, cache-tier session with provider-reported cost; matches a real Wavemill golden.',
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
      models: ['claude-opus-4-8', 'claude-sonnet-4-6'],
      model_segments: [
        {
          model: 'claude-opus-4-8',
          turn_count: 2,
          usage: tokens(3700, 1600, 27000, 3000, 300),
          actual_cost_usd: 0.0913,
          estimated_cost_usd: 0.09075,
          cost_source: 'provider_reported',
        },
        {
          model: 'claude-sonnet-4-6',
          turn_count: 1,
          usage: tokens(3000, 1000, 20000, 500, 0),
          actual_cost_usd: 0.032,
          estimated_cost_usd: 0.031875,
          cost_source: 'provider_reported',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(6700, 2600, 47000, 3500, 300),
      actual_cost_usd: 0.1233,
      estimated_cost_usd: 0.122625,
      total_cost_usd: 0.1233,
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
