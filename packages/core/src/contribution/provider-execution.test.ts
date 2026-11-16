import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  validateNativeProviderExecution,
  validateStageFailureEvidence,
  type NativeProviderExecution,
} from './provider-execution.js';
import { contributionV4Fixtures } from '../fixtures/contribution-v4.js';
import { validateContributionRow } from './schema.js';

const execution: NativeProviderExecution = {
  sessionRef: 'hashed-session',
  ownershipAttemptIds: ['hashed-attempt'],
  responseId: 'hashed-response',
  transport: 'openrouter',
  requestedModel: 'kimi-k3',
  responseModel: 'moonshotai/kimi-k3',
  generation: { providerName: 'Host A', totalCostUsd: 0 },
  requestedRouting: { only: ['host-a/fp4'], allow_fallbacks: false },
  pricingSnapshot: {
    scope: 'endpoint',
    inputCostPerMTok: 0.2,
    outputCostPerMTok: 10,
  },
  usage: {
    input_tokens: 10,
    output_tokens: 2,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: null,
  },
};
const schema = JSON.parse(
  readFileSync(
    new URL('../../schemas/provider-execution.v1.schema.json', import.meta.url),
    'utf8',
  ),
);
const validateJson = new Ajv2020().compile(schema);

describe('provider execution facts', () => {
  for (const row of [
    execution,
    { ...execution, generation: null },
    {
      ...execution,
      generation: { providerName: 'Host A', totalCostUsd: null },
    },
  ]) {
    it(`preserves explicit billing ${JSON.stringify(row.generation)}`, () => {
      expect(() => validateNativeProviderExecution(row)).not.toThrow();
      expect(validateJson(row)).toBe(true);
    });
  }
  for (const row of [
    { ...execution, prompt: 'must not leave' },
    { ...execution, generation: { totalCostUsd: -1 } },
    {
      ...execution,
      generation: { totalCostUsd: null, payload: 'must not leave' },
    },
    { ...execution, ownershipAttemptIds: ['same', 'same'] },
    { ...execution, requestedRouting: { only: [] } },
    {
      ...execution,
      pricingSnapshot: {
        scope: 'endpoint',
        inputCostPerMTok: -1,
        outputCostPerMTok: 2,
      },
    },
  ]) {
    it(`rejects invalid/private evidence ${JSON.stringify(row)}`, () => {
      expect(() => validateNativeProviderExecution(row)).toThrow();
      expect(validateJson(row)).toBe(false);
    });
  }
  it('retains provider facts and a neutral harness failure through contribution validation', () => {
    const row = structuredClone(contributionV4Fixtures.singleHarness);
    const stage = row.stage_executions[0]!;
    stage.provider_executions = [
      { ...execution, sessionRef: stage.task_cost.session_ids[0]! },
    ];
    stage.failure = { fault_class: 'harness-fault' };
    expect(validateContributionRow(row)).toBe(row);
    stage.provider_executions.push(
      structuredClone(stage.provider_executions[0]!),
    );
    expect(() => validateContributionRow(row)).toThrow(
      /duplicate provider response/,
    );
  });
  it('rejects unrecognized fault classes', () => {
    expect(() =>
      validateStageFailureEvidence({ fault_class: 'made-up-fault' }),
    ).toThrow();
  });
});
