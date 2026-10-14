import { eventFactory, ledgerFor, tokens, type HarnessProfile, type TaskCostFixture } from './builders.js';

const profile: HarnessProfile = {
  harness: 'codex',
  providerContractVersion: 'codex/2',
  harnessVersion: '0.50.0',
};
const event = eventFactory(profile);

/**
 * Sanitized real-world Codex `token_count` shape (HOK-3104). The raw rollout
 * carries non-disjoint buckets:
 *   raw_input 2978251 = 133579 (new input) + 2844672 (cached)
 *   total    2986594 = 2978251 (raw_input) + 8343 (output)
 *   reasoning 545 is a subset of output 8343
 *
 * Under the `codex/2` contract the adapter subtracts the cached slice from
 * input, so the fixture stores the normalized, disjoint buckets. The
 * estimate is hand-computed at the shared cache-read multiplier (0.1×):
 *   133579/1e6 × 1.25 + 2844672/1e6 × 1.25 × 0.1 + 8343/1e6 × 10
 *     = 0.16697375 + 0.355584    + 0.08343
 *     = 0.60598775, rounded to micro-USD = 0.605988.
 */
const events = [
  event({
    n: 1,
    model: 'gpt-5-codex',
    usage: tokens(133579, 8343, 2844672, 0, 545),
    estimated: 0.605988,
  }),
];

export const codexRealCacheFixture: TaskCostFixture = {
  name: 'codex-real-cache',
  description:
    'Sanitized real `token_count` with cache-heavy input; disjoint buckets per codex/2 (HOK-3104).',
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
          turn_count: 1,
          usage: tokens(133579, 8343, 2844672, 0, 545),
          actual_cost_usd: null,
          estimated_cost_usd: 0.605988,
          cost_source: 'local_estimate',
        },
      ],
      turn_count: 1,
      turns_truncated: false,
      usage: tokens(133579, 8343, 2844672, 0, 545),
      actual_cost_usd: null,
      estimated_cost_usd: 0.605988,
      total_cost_usd: 0.605988,
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
      pricing_timestamp: '2026-01-01T00:01:00Z',
      pricing_source: 'local_estimate',
      join_confidence: 'unattributed',
      collected_at: '2026-01-01T00:01:00Z',
      event_count: 1,
      event_ids: ['01900000-0000-7000-8000-000000000001'],
      diagnostics: [],
    },
  ],
};
