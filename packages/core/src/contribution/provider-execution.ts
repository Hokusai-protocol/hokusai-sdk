/** Provider execution facts, shared by host telemetry and canonical contributions. */
import {
  assertNoForbiddenKeys,
  fail,
  requireId,
  requireObject,
} from '../task-cost/validators.js';
import {
  TASK_COST_TOKEN_FIELDS,
  type TaskCostTokenUsage,
} from '../task-cost/token-usage.js';

export interface ProviderRoutingPreference {
  order?: string[];
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
}

export interface ProviderPricingSnapshot {
  /** Model reference rates must never masquerade as endpoint-specific prices. */
  scope: 'model' | 'endpoint';
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  cacheReadCostPerMTok?: number;
  cacheWriteCostPerMTok?: number;
}

export interface ProviderGenerationEvidence {
  totalCostUsd: number | null;
  providerName?: string;
  modelPermaslug?: string;
  cacheDiscountUsd?: number;
  nativeTokensPrompt?: number;
  nativeTokensCached?: number;
  nativeTokensCompletion?: number;
}

export interface NativeProviderExecution {
  /** Stable host observation identity, including turns with no provider response ID. */
  observationId?: string;
  usage?: TaskCostTokenUsage;
  sessionRef: string;
  ownershipAttemptIds: string[];
  responseId: string | null;
  transport: string;
  requestedModel: string | null;
  responseModel: string | null;
  /** Observed lookup facts, not a vendor inferred from a model slug. */
  generation: ProviderGenerationEvidence | null;
  requestedRouting?: ProviderRoutingPreference | null;
  pricingSnapshot?: ProviderPricingSnapshot | null;
}

export const EXECUTION_FAULT_CLASSES = [
  'model-fault',
  'provider-fault',
  'harness-fault',
  'selection-fault',
  'unknown-fault',
] as const;
export interface StageFailureEvidence {
  fault_class: (typeof EXECUTION_FAULT_CLASSES)[number];
}

function object(value: unknown, allowed: readonly string[], label: string) {
  const record = requireObject(value, label);
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) fail(`${label}.${key} is not allowed`);
  return record;
}
function text(value: unknown, label: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    fail(`${label} must be a non-empty string`);
}
function amount(value: unknown, label: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    fail(`${label} must be non-negative and finite`);
}

export function validateNativeProviderExecution(
  value: unknown,
): asserts value is NativeProviderExecution {
  assertNoForbiddenKeys(value);
  const row = object(
    value,
    [
      'observationId',
      'sessionRef',
      'ownershipAttemptIds',
      'responseId',
      'transport',
      'requestedModel',
      'responseModel',
      'generation',
      'requestedRouting',
      'pricingSnapshot',
      'usage',
    ],
    'provider execution',
  );
  if (row.usage !== undefined) {
    const usage = object(row.usage, TASK_COST_TOKEN_FIELDS, 'usage');
    for (const field of TASK_COST_TOKEN_FIELDS)
      amount(usage[field], `usage.${field}`, true);
  }
  if (row.observationId !== undefined)
    requireId(row.observationId, 'observationId');
  requireId(row.sessionRef, 'sessionRef');
  if (
    !Array.isArray(row.ownershipAttemptIds) ||
    new Set(row.ownershipAttemptIds).size !== row.ownershipAttemptIds.length
  )
    fail('ownershipAttemptIds must be unique IDs');
  for (const id of row.ownershipAttemptIds as unknown[])
    requireId(id, 'ownershipAttemptIds');
  if (row.responseId !== null) requireId(row.responseId, 'responseId');
  text(row.transport, 'transport');
  text(row.requestedModel, 'requestedModel', true);
  text(row.responseModel, 'responseModel', true);
  if (row.generation !== null) {
    if (row.transport !== 'openrouter')
      fail('generation evidence requires the openrouter transport');
    const generation = object(
      row.generation,
      [
        'totalCostUsd',
        'providerName',
        'modelPermaslug',
        'cacheDiscountUsd',
        'nativeTokensPrompt',
        'nativeTokensCached',
        'nativeTokensCompletion',
      ],
      'generation',
    );
    amount(generation.totalCostUsd, 'generation.totalCostUsd', true);
    for (const key of ['providerName', 'modelPermaslug'])
      if (generation[key] !== undefined) text(generation[key], key);
    for (const key of [
      'cacheDiscountUsd',
      'nativeTokensPrompt',
      'nativeTokensCached',
      'nativeTokensCompletion',
    ])
      if (generation[key] !== undefined) amount(generation[key], key);
  }
  if (row.requestedRouting != null) {
    const routing = object(
      row.requestedRouting,
      [
        'order',
        'only',
        'ignore',
        'quantizations',
        'allow_fallbacks',
        'require_parameters',
      ],
      'requestedRouting',
    );
    for (const [key, entry] of Object.entries(routing)) {
      if (key === 'allow_fallbacks' || key === 'require_parameters') {
        if (typeof entry !== 'boolean')
          fail(`requestedRouting.${key} must be boolean`);
      } else {
        if (!Array.isArray(entry) || entry.length === 0)
          fail(`requestedRouting.${key} must be a non-empty array`);
        for (const item of entry as unknown[]) text(item, key);
      }
    }
  }
  if (row.pricingSnapshot != null) {
    const pricing = object(
      row.pricingSnapshot,
      [
        'scope',
        'inputCostPerMTok',
        'outputCostPerMTok',
        'cacheReadCostPerMTok',
        'cacheWriteCostPerMTok',
      ],
      'pricingSnapshot',
    );
    if (pricing.scope !== 'model' && pricing.scope !== 'endpoint')
      fail('pricingSnapshot.scope must be model or endpoint');
    for (const key of ['inputCostPerMTok', 'outputCostPerMTok'])
      amount(pricing[key], key);
    for (const key of ['cacheReadCostPerMTok', 'cacheWriteCostPerMTok'])
      if (pricing[key] !== undefined) amount(pricing[key], key);
  }
}

export function validateStageFailureEvidence(
  value: unknown,
): asserts value is StageFailureEvidence {
  const row = object(value, ['fault_class'], 'failure');
  if (
    !(EXECUTION_FAULT_CLASSES as readonly unknown[]).includes(row.fault_class)
  )
    fail('failure.fault_class is invalid');
}
