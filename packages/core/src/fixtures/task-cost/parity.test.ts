import { describe, expect, it } from 'vitest';
import { aggregateTaskCost, type TaskCostSummaryV1 } from '../../task-cost/index.js';
import { taskCostFixtures } from './index.js';
import { wavemillGoldens, type WavemillGoldenSession } from './wavemill-golden.js';

/**
 * Projects an SDK summary onto the cost-relevant subset of Wavemill's
 * `ExecutionEconomicsSession`. Wavemill-only fields (stage role, trigger
 * source, model identity) have no SDK counterpart and are not compared.
 */
function toWavemillShape(summary: TaskCostSummaryV1): WavemillGoldenSession {
  return {
    providerContractVersion: summary.provider_contract_version,
    harness: summary.harness as WavemillGoldenSession['harness'],
    usage: {
      inputTokens: summary.usage.input_tokens,
      outputTokens: summary.usage.output_tokens,
      cacheReadTokens: summary.usage.cache_read_tokens,
      cacheWriteTokens: summary.usage.cache_write_tokens,
      reasoningTokens: summary.usage.reasoning_tokens,
    },
    actualCostUsd: summary.actual_cost_usd,
    estimatedCostUsd: summary.estimated_cost_usd,
    costSource: summary.cost_source as WavemillGoldenSession['costSource'],
    pricingRevision: summary.pricing_revision ?? null,
    pricingTimestamp: summary.pricing_timestamp ?? null,
    coverage: summary.coverage,
    turnCount: summary.turn_count,
    modelSegments: summary.model_segments.map(({ model, turn_count }) => ({
      model,
      turnCount: turn_count,
    })),
  };
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

function sameTime(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/** Top-level keys on which the SDK and Wavemill disagree. */
function differingFields(sdk: WavemillGoldenSession, wavemill: WavemillGoldenSession): string[] {
  const differing: string[] = [];
  const check = (key: string, equal: boolean): void => {
    if (!equal) differing.push(key);
  };
  check('providerContractVersion', sdk.providerContractVersion === wavemill.providerContractVersion);
  check('harness', sdk.harness === wavemill.harness);
  check(
    'usage',
    (Object.keys(sdk.usage) as Array<keyof typeof sdk.usage>).every((key) =>
      sameNumber(sdk.usage[key], wavemill.usage[key]),
    ),
  );
  check('actualCostUsd', sameNumber(sdk.actualCostUsd, wavemill.actualCostUsd));
  check('estimatedCostUsd', sameNumber(sdk.estimatedCostUsd, wavemill.estimatedCostUsd));
  check('costSource', sdk.costSource === wavemill.costSource);
  check('pricingRevision', sdk.pricingRevision === wavemill.pricingRevision);
  check('pricingTimestamp', sameTime(sdk.pricingTimestamp, wavemill.pricingTimestamp));
  check('coverage', sdk.coverage === wavemill.coverage);
  check('turnCount', sdk.turnCount === wavemill.turnCount);
  check('modelSegments', JSON.stringify(sdk.modelSegments) === JSON.stringify(wavemill.modelSegments));
  return differing;
}

/**
 * The complete list of permitted differences, per fixture. The test requires
 * the *actual* differing fields to equal this list exactly, so both new drift
 * and stale exemptions fail. Rationale for each lives in `wavemill-parity.md`.
 */
const PERMITTED_DIFFERENCES: Readonly<Record<string, readonly string[]>> = {
  'claude-code-simple': [],
  'claude-code-model-switch': [],
  'claude-code-cache-tiers': [],
  'codex-simple': [],
  'codex-provider-override': [],
  'wavemill-parity': [],
  // SDK keeps the priced turn's estimate as a lower bound and its pricing
  // revision; Wavemill withholds the whole estimate when any model is unpriced.
  'codex-unknown-pricing': ['estimatedCostUsd', 'costSource', 'pricingRevision', 'pricingTimestamp'],
  // Wavemill prices session *totals* for single-model sessions, so a turn with
  // missing output silently undercounts and still reports `complete`. The SDK
  // reasons per event and reports `partial` with no total.
  'partial-usage': ['estimatedCostUsd', 'coverage'],
};

describe('Wavemill parity oracle', () => {
  it('has a golden and a permitted-differences entry for every parity fixture', () => {
    expect(Object.keys(wavemillGoldens).sort()).toEqual(Object.keys(PERMITTED_DIFFERENCES).sort());
    for (const name of Object.keys(wavemillGoldens)) {
      expect(taskCostFixtures.some((fixture) => fixture.name === name)).toBe(true);
    }
  });

  describe.each(Object.keys(wavemillGoldens))('%s', (name) => {
    it('differs from the Wavemill golden only where documented', () => {
      const fixture = taskCostFixtures.find((candidate) => candidate.name === name);
      const golden = wavemillGoldens[name];
      if (!fixture || !golden) throw new Error(`missing fixture or golden for ${name}`);

      const collectedAt = fixture.expectedSummaries[0]?.collected_at;
      const summary = aggregateTaskCost(fixture.events, collectedAt ? { collectedAt } : {});
      expect(differingFields(toWavemillShape(summary), golden)).toEqual(PERMITTED_DIFFERENCES[name]);
    });
  });

  it('never fabricates a total where Wavemill withholds an estimate', () => {
    const unknown = taskCostFixtures.find((fixture) => fixture.name === 'codex-unknown-pricing');
    const summary = aggregateTaskCost(unknown?.events ?? []);
    expect(wavemillGoldens['codex-unknown-pricing']?.estimatedCostUsd).toBeNull();
    expect(summary.total_cost_usd).toBeNull();
  });
});
