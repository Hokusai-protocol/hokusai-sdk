import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'codex',
  providerContractVersion: 'codex/2',
  harnessVersion: '0.50.0',
};
const event = eventFactory(profile);

/**
 * gpt-5-codex ($1.25 in / $10 out per MTok). Under the `codex/2` disjoint-
 * buckets contract (HOK-3104), `reasoning_tokens` is a reporting-only
 * breakdown of `output_tokens` — never billed separately — so the estimate
 * prices `output` as-is:
 * event 1: 2000 in, 600 out (reasoning 150) -> 0.0025 + 0.006 = 0.0085
 * event 2: 3000 in, 900 out (reasoning 300) -> 0.00375 + 0.009 = 0.01275
 */
const events = [
  event({ n: 1, model: 'gpt-5-codex', usage: tokens(2000, 600, 0, 0, 150), estimated: 0.0085 }),
  event({ n: 2, model: 'gpt-5-codex', usage: tokens(3000, 900, 0, 0, 300), estimated: 0.01275 }),
];

export const codexSimpleFixture: TaskCostFixture = {
  name: 'codex-simple',
  description: 'OpenAI-priced happy path; Codex reports no charge, so the estimate stands.',
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0001',
      session_ids: ['session-0001'],
      harness: 'codex',
      harness_version: '0.50.0',
      provider_contract_version: 'codex/2',
      models: ['gpt-5-codex'],
      model_segments: [
        {
          model: 'gpt-5-codex',
          turn_count: 2,
          usage: tokens(5000, 1500, 0, 0, 450),
          actual_cost_usd: null,
          estimated_cost_usd: 0.02125,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(5000, 1500, 0, 0, 450),
      actual_cost_usd: null,
      estimated_cost_usd: 0.02125,
      total_cost_usd: 0.02125,
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
