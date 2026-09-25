import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * One session interleaves two tasks. A single ledger spans both `task_id`s;
 * each summary is derived by filtering the events to its task, and the two
 * summaries share no event ids.
 */
const events = [
  event({ n: 1, task: 'task-0001', model: 'claude-sonnet-5', usage: tokens(1000, 400, 0, 0, 0), estimated: 0.009 }),
  event({ n: 2, task: 'task-0002', model: 'claude-sonnet-5', usage: tokens(4000, 1000, 0, 0, 0), estimated: 0.027 }),
  event({ n: 3, task: 'task-0001', model: 'claude-sonnet-5', usage: tokens(2000, 600, 0, 0, 0), estimated: 0.015 }),
  event({ n: 4, task: 'task-0002', model: 'claude-sonnet-5', usage: tokens(1500, 500, 0, 0, 0), estimated: 0.012 }),
  event({ n: 5, task: 'task-0001', model: 'claude-sonnet-5', usage: tokens(500, 200, 0, 0, 0), estimated: 0.0045 }),
  event({ n: 6, task: 'task-0002', model: 'claude-sonnet-5', usage: tokens(800, 300, 0, 0, 0), estimated: 0.0069 }),
];

export const concurrentTasksFixture: TaskCostFixture = {
  name: 'concurrent-tasks',
  description: 'One session, two interleaved tasks: one ledger, two disjoint summaries.',
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
          usage: tokens(3500, 1200, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0285,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(3500, 1200, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0285,
      total_cost_usd: 0.0285,
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
      pricing_timestamp: '2026-01-01T00:05:00Z',
      pricing_source: 'local_estimate',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:05:00Z',
      event_count: 3,
      event_ids: [
        '01900000-0000-7000-8000-000000000001',
        '01900000-0000-7000-8000-000000000003',
        '01900000-0000-7000-8000-000000000005',
      ],
      diagnostics: [],
    },
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0002',
      session_ids: ['session-0001'],
      harness: 'claude-code',
      harness_version: '2.1.0',
      provider_contract_version: 'claude-code/1',
      models: ['claude-sonnet-5'],
      model_segments: [
        {
          model: 'claude-sonnet-5',
          turn_count: 3,
          usage: tokens(6300, 1800, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0459,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(6300, 1800, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0459,
      total_cost_usd: 0.0459,
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
      pricing_timestamp: '2026-01-01T00:06:00Z',
      pricing_source: 'local_estimate',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:06:00Z',
      event_count: 3,
      event_ids: [
        '01900000-0000-7000-8000-000000000002',
        '01900000-0000-7000-8000-000000000004',
        '01900000-0000-7000-8000-000000000006',
      ],
      diagnostics: [],
    },
  ],
};
