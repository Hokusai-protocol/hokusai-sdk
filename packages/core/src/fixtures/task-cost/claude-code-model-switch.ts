import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/** Opus for two turns, then a mid-task switch to Sonnet; no provider cost reported. */
const events = [
  event({ n: 1, model: 'claude-opus-4-8', usage: tokens(3000, 1200, 0, 0, 0), estimated: 0.045 }),
  event({ n: 2, model: 'claude-opus-4-8', usage: tokens(2000, 800, 0, 0, 0), estimated: 0.03 }),
  event({ n: 3, model: 'claude-sonnet-5', usage: tokens(4000, 1500, 0, 0, 0), estimated: 0.0345 }),
  event({ n: 4, model: 'claude-sonnet-5', usage: tokens(1000, 400, 0, 0, 0), estimated: 0.009 }),
];

export const claudeCodeModelSwitchFixture: TaskCostFixture = {
  name: 'claude-code-model-switch',
  description: 'Mid-task Opus -> Sonnet switch; model_segments preserve the switch structure.',
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
      models: ['claude-opus-4-8', 'claude-sonnet-5'],
      model_segments: [
        {
          model: 'claude-opus-4-8',
          turn_count: 2,
          usage: tokens(5000, 2000, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.075,
          cost_source: 'local_estimate',
        },
        {
          model: 'claude-sonnet-5',
          turn_count: 2,
          usage: tokens(5000, 1900, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0435,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 4,
      turns_truncated: false,
      usage: tokens(10000, 3900, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.1185,
      total_cost_usd: 0.1185,
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
      diagnostics: [],
    },
  ],
};
