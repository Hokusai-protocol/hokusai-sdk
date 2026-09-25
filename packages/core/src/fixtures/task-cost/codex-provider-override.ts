import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'codex',
  providerContractVersion: 'codex/1',
  harnessVersion: '0.50.0',
};
const event = eventFactory(profile);

/**
 * Each event carries both a provider-reported charge and an OpenRouter-priced
 * estimate. The charge wins: `cost_source` is `provider_reported` and the
 * estimate is kept only as a cross-check.
 * event 1: gpt-5, 1000 in / 500 out -> 0.00125 + 0.005 = 0.00625
 * event 2: gpt-5, 2000 in / 800 out -> 0.0025 + 0.008 = 0.0105
 */
const events = [
  event({ n: 1, model: 'gpt-5', usage: tokens(1000, 500, 0, 0, 0), actual: 0.0061, estimated: 0.00625, pricingSource: 'openrouter_api', table: 'openrouter' }),
  event({ n: 2, model: 'gpt-5', usage: tokens(2000, 800, 0, 0, 0), actual: 0.0102, estimated: 0.0105, pricingSource: 'openrouter_api', table: 'openrouter' }),
];

export const codexProviderOverrideFixture: TaskCostFixture = {
  name: 'codex-provider-override',
  description: 'A provider-reported charge supersedes the local/OpenRouter estimate as the resolved cost.',
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: 'task_cost_summary/v1',
      task_id: 'task-0001',
      session_ids: ['session-0001'],
      harness: 'codex',
      harness_version: '0.50.0',
      provider_contract_version: 'codex/1',
      models: ['gpt-5'],
      model_segments: [
        {
          model: 'gpt-5',
          turn_count: 2,
          usage: tokens(3000, 1300, 0, 0, 0),
          actual_cost_usd: 0.0163,
          estimated_cost_usd: 0.01675,
          cost_source: 'provider_reported',
        },
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(3000, 1300, 0, 0, 0),
      actual_cost_usd: 0.0163,
      estimated_cost_usd: 0.01675,
      total_cost_usd: 0.0163,
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
      pricing_timestamp: '2026-01-01T00:02:00Z',
      pricing_source: 'openrouter_api',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:02:00Z',
      event_count: 2,
      event_ids: [
        '01900000-0000-7000-8000-000000000001',
        '01900000-0000-7000-8000-000000000002',
      ],
      diagnostics: ['provider_reported_cost'],
    },
  ],
};
