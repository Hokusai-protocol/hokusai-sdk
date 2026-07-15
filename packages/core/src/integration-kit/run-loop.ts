import {
  DEFAULT_REDACTION_CONFIG,
  type RedactionConfig,
} from '../anonymization.js';
import {
  HokusaiDispatchBuilder,
  type ContributionAcceptedResponse,
  type ContributionRequest,
} from '../client.js';
import {
  buildHarnessOutcomeRow,
  type HarnessOutcomeRowV1,
} from '../contribution/index.js';
import {
  InMemoryModelRegistry,
  mapRecommendation,
  type ModelDefinition,
} from '../model-registry.js';
import { computeActualCostUsd } from '../pricing.js';
import { type RouteRequest, type RouteResponse } from '../schemas.js';
import {
  deriveTaskDescriptor,
  type TaskDescriptorFields,
  type TaskDescriptorSignals,
} from '../task-descriptor.js';
import type { HostAdapter } from './host-adapter.js';

export interface HokusaiLoopClient {
  route(request: RouteRequest): Promise<RouteResponse>;
  submitContribution(
    request: ContributionRequest,
  ): Promise<ContributionAcceptedResponse>;
}

export interface RunHokusaiLoopOptions {
  adapter: HostAdapter;
  client: HokusaiLoopClient;
  repositorySignals?: TaskDescriptorSignals;
  budgetUsd?: number;
  reportCost?: boolean;
  redactionConfig: RedactionConfig;
  idempotencyKey: string;
  harnessName?: string;
  sdkVersion?: string;
  observedAt?: string;
  consentSubjectId?: string;
  clock?: () => Date;
  log?: (line: string) => void;
}

export interface RunHokusaiLoopResult {
  routeId: string;
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

function createRedactionConfig(config: RedactionConfig): RedactionConfig {
  return {
    ...DEFAULT_REDACTION_CONFIG,
    ...config,
    knownNames: [
      ...(config.knownNames ?? DEFAULT_REDACTION_CONFIG.knownNames ?? []),
    ],
    customRules: [
      ...(config.customRules ?? DEFAULT_REDACTION_CONFIG.customRules ?? []),
    ],
  };
}

function requireRunnableModels(models: ModelDefinition[]): string[] {
  if (models.length === 0) {
    throw new Error('Host adapter must return at least one runnable model.');
  }

  return models.map((model) => model.id);
}

export async function runHokusaiLoop(
  options: RunHokusaiLoopOptions,
): Promise<RunHokusaiLoopResult> {
  const log = options.log ?? noop;
  const clock = options.clock ?? (() => new Date());
  const observedAt = options.observedAt ?? clock().toISOString();

  log('[1/8] Collecting task context and discovering runnable models');
  const context = await options.adapter.collectTaskContext();
  const discoveredModels =
    await options.adapter.discoverRunnableModels(context);
  const allowedModels = requireRunnableModels(discoveredModels);
  const defaultModel = allowedModels[0];
  if (!defaultModel) {
    throw new Error('Host adapter must return at least one runnable model.');
  }
  log(`        runnable models: ${allowedModels.join(', ')}`);

  const registry = new InMemoryModelRegistry(discoveredModels);
  const dispatchBuilder = new HokusaiDispatchBuilder({
    consent: {
      subjectId:
        options.consentSubjectId ?? options.harnessName ?? 'hokusai-host',
      grantedScopes: ['task-execution'],
    },
    modelRegistry: registry,
    redactionConfig: createRedactionConfig(options.redactionConfig),
    clock,
  });

  log('[2/8] Deriving task descriptor (categorical labels only)');
  const derived = deriveTaskDescriptor({
    taskText: context.task.prompt,
    ...(options.repositorySignals
      ? { repositorySignals: options.repositorySignals }
      : {}),
  });
  const taskDescriptor =
    Object.keys(derived).length > 0 ? derived : { task_type: 'unknown' };
  for (const [key, value] of Object.entries(taskDescriptor)) {
    log(`        ${key}: ${value}`);
  }

  log('[3/8] Previewing anonymized dispatch payload');
  const dispatchPayload = await dispatchBuilder.prepareDispatch(
    context.task,
    defaultModel,
  );
  const preview = await options.adapter.previewRedactedPayload(dispatchPayload);
  log(`        prompt:     ${preview.promptPreview}`);
  log(`        redactions: ${preview.redactionCount}`);

  log('[4/8] Routing');
  const route = await options.client.route(dispatchPayload);
  const routeId = route.routeId;
  const inferenceLogId = routeId;
  log(`        inference_log_id: ${inferenceLogId}`);

  log('[5/8] Mapping the recommendation to a local model');
  const recommended = route.recommendation?.model ?? defaultModel;
  const mapped = mapRecommendation({ model: recommended }, { registry });
  log(`        ${recommended} -> ${mapped.id}`);

  log('[6/8] Executing the task');
  const execution = await options.adapter.executeWithModel({
    task: context.task,
    model: mapped,
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
    ...(options.budgetUsd !== undefined
      ? { budgetUsd: options.budgetUsd }
      : {}),
    ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
    wallClockSeconds: execution.wallClockSeconds,
    ...(options.harnessName ? { harness: options.harnessName } : {}),
    ...(options.sdkVersion ? { sdkVersion: options.sdkVersion } : {}),
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
    routeId,
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
