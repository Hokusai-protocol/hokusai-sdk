import { eventFactory, eventId, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  harnessVersion: '2.1.0',
};
const event = eventFactory(profile);

/**
 * Turn 2 was observed once (event 2), then retried: event 3 re-emits the same
 * turn with its final usage and supersedes event 2. Both stay in the ledger for
 * audit; only event 3 contributes to the summary.
 */
const events = [
  event({ n: 1, model: 'claude-sonnet-5', usage: tokens(1000, 500, 0, 0, 0), estimated: 0.0105 }),
  event({ n: 2, model: 'claude-sonnet-5', usage: tokens(2000, 900, 0, 0, 0), estimated: 0.0195 }),
  event({
    n: 3,
    turn: 'turn-0002',
    model: 'claude-sonnet-5',
    usage: tokens(2000, 1100, 0, 0, 0),
    estimated: 0.0225,
    replayOf: eventId(2),
  }),
  event({ n: 4, model: 'claude-sonnet-5', usage: tokens(800, 300, 0, 0, 0), estimated: 0.0069 }),
];

export const claudeCodeRetryFixture: TaskCostFixture = {
  name: 'claude-code-retry',
  description: 'A retried turn supersedes its first attempt; the superseded usage and cost are not counted.',
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
          usage: tokens(3800, 1900, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0399,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(3800, 1900, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0399,
      total_cost_usd: 0.0399,
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
      event_count: 3,
      event_ids: [
        '01900000-0000-7000-8000-000000000001',
        '01900000-0000-7000-8000-000000000003',
        '01900000-0000-7000-8000-000000000004',
      ],
      diagnostics: [],
    },
  ],
};
