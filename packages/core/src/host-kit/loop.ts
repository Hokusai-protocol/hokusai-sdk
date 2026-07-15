import {
  type ContributionAcceptedResponse,
  type ContributionRequest,
  type HokusaiClient,
  HokusaiDispatchBuilder,
} from '../client.js';
import type { ConsentConfig } from '../consent.js';
import { buildHarnessOutcomeRow } from '../contribution/index.js';
import type { ModelDefinition } from '../model-registry.js';
import { InMemoryModelRegistry, mapRecommendation } from '../model-registry.js';
import { computeActualCostUsd } from '../pricing.js';
import type { RedactionConfig } from '../anonymization.js';
import { DEFAULT_REDACTION_CONFIG } from '../anonymization.js';
import type { TaskDescriptorFields, TaskDescriptorSignals } from '../task-descriptor.js';
import { deriveTaskDescriptor } from '../task-descriptor.js';
import type { RouteRequest, RouteResponse } from '../schemas.js';
import type { HarnessOutcomeRowV1 } from '../contribution/schema.js';
import type { HostAdapter } from './host-adapter.js';

export interface HokusaiLoopClient {
  route(request: RouteRequest): Promise<RouteResponse>;
  submitContribution(
    request: ContributionRequest,
  ): Promise<ContributionAcceptedResponse>;
}

function isValidationSuccess(
  value: unknown,
): value is { ok: true; request: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok?: unknown }).ok === true &&
    'request' in value
  );
}

export function asHokusaiLoopClient(client: HokusaiClient): HokusaiLoopClient {
  return {
    async route(request) {
      const response = await client.route(request);
      if (isValidationSuccess(response)) {
        throw new Error(
          'HokusaiClient.route() returned a dry-run validation result; runHokusaiLoop requires a concrete RouteResponse.',
        );
      }
      return response;
    },
    async submitContribution(request) {
      const response = await client.submitContribution(request);
      if (isValidationSuccess(response)) {
        throw new Error(
          'HokusaiClient.submitContribution() returned a dry-run validation result; runHokusaiLoop requires a concrete ContributionAcceptedResponse.',
        );
      }
      return response;
    },
  };
}

export interface HokusaiLoopOptions {
  adapter: HostAdapter;
  client: HokusaiLoopClient;
  models: ModelDefinition[];
  harness: string;
  sdkVersion: string;
  idempotencyKey: string;
  consent?: ConsentConfig;
  redactionConfig?: RedactionConfig;
  repositorySignals?: TaskDescriptorSignals;
  budgetUsd?: number;
  reportCost?: boolean;
  clock?: () => Date;
  observedAt?: string;
  log?: (line: string) => void;
}

export interface HokusaiLoopResult {
  inferenceLogId: string;
  taskDescriptor: TaskDescriptorFields;
  allowedModels: string[];
  selectedModel: string;
  promptPreview: string;
  redactionCount: number;
  actualCostUsd: number | undefined;
  row: HarnessOutcomeRowV1;
  response: ContributionAcceptedResponse;
  fidelityTier: string | undefined;
}

function noop(): void {
  /* silent by default */
}

export async function runHokusaiLoop(
  options: HokusaiLoopOptions,
): Promise<HokusaiLoopResult> {
  const log = options.log ?? noop;
  const registry = new InMemoryModelRegistry(options.models);
  const allowedModels = options.models.map((model) => model.id);
  const clock = options.clock ?? (() => new Date());
  const observedAt = options.observedAt ?? clock().toISOString();

  const dispatchBuilder = new HokusaiDispatchBuilder({
    consent: options.consent ?? {
      subjectId: options.harness,
      grantedScopes: ['task-execution'],
    },
    modelRegistry: registry,
    redactionConfig: options.redactionConfig ?? DEFAULT_REDACTION_CONFIG,
    clock,
  });

  log('[1/8] Collecting task context');
  const context = await options.adapter.collectTaskContext();

  log('[2/8] Deriving task descriptor (categorical labels only)');
  const derived = deriveTaskDescriptor({
    taskText: context.task.prompt,
    ...(options.repositorySignals ? { repositorySignals: options.repositorySignals } : {}),
  });
  const taskDescriptor =
    Object.keys(derived).length > 0 ? derived : { task_type: 'unknown' };
  for (const [key, value] of Object.entries(taskDescriptor)) {
    log(`        ${key}: ${String(value)}`);
  }

  log('[3/8] Previewing anonymized dispatch payload');
  const dispatchPayload = await dispatchBuilder.prepareDispatch(
    context.task,
    allowedModels[0] as string,
  );
  const preview = options.adapter.previewPayload(dispatchPayload);
  log(`        prompt:     ${preview.promptPreview}`);
  log(`        redactions: ${preview.redactionCount}`);

  log('[4/8] Routing');
  const route = await options.client.route(dispatchPayload);
  const inferenceLogId = route.routeId;
  log(`        inference_log_id: ${inferenceLogId}`);

  log('[5/8] Mapping the recommendation to a local model');
  const recommended = route.recommendation?.model ?? allowedModels[0];
  const mapped = mapRecommendation({ model: recommended }, { registry });
  log(`        ${recommended} -> ${mapped.id}`);

  log('[6/8] Executing the task');
  const execution = await options.adapter.executeTask({
    task: context.task,
    model: { id: mapped.id, provider: mapped.provider },
  });
  log(
    `        result: ${execution.completionResult}  ` +
      `in=${execution.inputTokens} out=${execution.outputTokens}`,
  );

  log('[7/8] Deriving actual_cost_usd from token usage');
  const actualCostUsd =
    options.reportCost === false
      ? undefined
      : computeActualCostUsd({
          model: mapped.id,
          inputTokens: execution.inputTokens,
          outputTokens: execution.outputTokens,
          ...(execution.cacheCreationTokens !== undefined
            ? { cacheCreationTokens: execution.cacheCreationTokens }
            : {}),
          ...(execution.cacheReadTokens !== undefined
            ? { cacheReadTokens: execution.cacheReadTokens }
            : {}),
        });
  log(
    actualCostUsd === undefined
      ? '        actual_cost_usd: (omitted)'
      : `        actual_cost_usd: $${actualCostUsd.toFixed(6)}`,
  );

  log('[8/8] Submitting the contribution row');
  const row = buildHarnessOutcomeRow({
    inferenceLogId,
    taskDescriptor,
    allowedModels,
    selectedModels: { coder: mapped.id, reviewer: mapped.id },
    completionResult: execution.completionResult,
    ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
    ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
    wallClockSeconds: execution.wallClockSeconds,
    harness: options.harness,
    sdkVersion: options.sdkVersion,
    taskId: context.task.id,
    observedAt,
  });
  const response = await options.client.submitContribution({
    rows: [row],
    metadata: { idempotency_key: options.idempotencyKey },
  });

  const fidelityTier = response.rowFidelityTiers?.[0];
  log(
    `        accepted=${String(response.accepted)} ` +
      `rowsAccepted=${String(response.rowsAccepted ?? 0)}`,
  );
  log(`        fidelity tier: ${fidelityTier ?? '(not reported by this API)'}`);

  return {
    inferenceLogId,
    taskDescriptor,
    allowedModels,
    selectedModel: mapped.id,
    promptPreview: preview.promptPreview,
    redactionCount: preview.redactionCount,
    actualCostUsd,
    row,
    response,
    fidelityTier,
  };
}
