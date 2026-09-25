import { eventFactory, eventId, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'pi',
  providerContractVersion: 'pi/1',
  harnessVersion: '0.9.0',
};
const event = eventFactory(profile);

/**
 * Pi harness on gemini-2.5-flash ($0.30 in / $2.50 out per MTok); event 2 is a
 * subagent turn nested under event 1.
 * event 1: 10000 in / 2000 out -> 0.003 + 0.005 = 0.008
 * event 2: 6000 in / 1500 out -> 0.0018 + 0.00375 = 0.00555
 */
const events = [
  event({ n: 1, model: 'gemini-2.5-flash', usage: tokens(10000, 2000, 0, 0, 0), estimated: 0.008 }),
  event({
    n: 2,
    model: 'gemini-2.5-flash',
    usage: tokens(6000, 1500, 0, 0, 0),
    estimated: 0.00555,
    parent: eventId(1),
    isSubagent: true,
  }),
];

export const piSimpleFixture: TaskCostFixture = {
  name: 'pi-simple',
  description: 'Pi harness contract (pi/1) with a nested subagent turn.',
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0001',
      session_ids: ['session-0001'],
      harness: 'pi',
      harness_version: '0.9.0',
      provider_contract_version: 'pi/1',
      models: ['gemini-2.5-flash'],
      model_segments: [
        {
          model: 'gemini-2.5-flash',
          turn_count: 2,
          usage: tokens(16000, 3500, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.01355,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(16000, 3500, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.01355,
      total_cost_usd: 0.01355,
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
