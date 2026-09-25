import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * Statusline-style cumulative snapshots. Event 3 regresses input tokens
 * (2500 -> 2400) and actual cost (0.0275 -> 0.0270), as after a counter reset:
 * its delta for those counters is clamped to 0 and the baseline rebases to the
 * lower value, so event 4 counts growth from there. Actual cost therefore sums
 * to 0.0275 + 0 + 0.006 = 0.0335, not the last snapshot's 0.0330: the drop is
 * discarded (never counted as negative) and flagged for the reader.
 */
const events = [
  event({ n: 1, kind: 'cumulative', model: 'claude-sonnet-5', usage: tokens(1000, 500, 0, 0, 0), actual: 0.0108, estimated: 0.0105 }),
  event({ n: 2, kind: 'cumulative', model: 'claude-sonnet-5', usage: tokens(2500, 1300, 0, 0, 0), actual: 0.0275, estimated: 0.027 }),
  event({ n: 3, kind: 'cumulative', model: 'claude-sonnet-5', usage: tokens(2400, 1500, 0, 0, 0), actual: 0.027, estimated: 0.0297 }),
  event({ n: 4, kind: 'cumulative', model: 'claude-sonnet-5', usage: tokens(3000, 1800, 0, 0, 0), actual: 0.033, estimated: 0.036 }),
];

export const claudeCodeCumulativeSnapshotFixture: TaskCostFixture = {
  name: 'claude-code-cumulative-snapshot',
  description: 'Cumulative snapshots are differenced; a backward jump is clamped to zero and flagged.',
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
          turn_count: 4,
          usage: tokens(3100, 1800, 0, 0, 0),
          actual_cost_usd: 0.0335,
          estimated_cost_usd: 0.036,
          cost_source: 'provider_reported',
        },
      ],
      turn_count: 4,
      turns_truncated: false,
      usage: tokens(3100, 1800, 0, 0, 0),
      actual_cost_usd: 0.0335,
      estimated_cost_usd: 0.036,
      total_cost_usd: 0.0335,
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
      pricing_timestamp: '2026-01-01T00:04:00Z',
      pricing_source: 'local_estimate',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:04:00Z',
      event_count: 4,
      event_ids: [
        '01900000-0000-7000-8000-000000000001',
        '01900000-0000-7000-8000-000000000002',
        '01900000-0000-7000-8000-000000000003',
        '01900000-0000-7000-8000-000000000004',
      ],
      diagnostics: ['provider_reported_cost', 'cumulative_backward_jump'],
    },
  ],
};
