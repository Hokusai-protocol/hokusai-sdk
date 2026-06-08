import {
  buildOutcomeReport,
  buildTaskPacket,
  DEFAULT_REDACTION_CONFIG,
  HokusaiDispatchBuilder,
  InMemoryLocalStore,
  InMemoryModelRegistry,
  mapRecommendation,
  previewOutcomePayload,
  type AdapterResult,
  type HarnessAdapter,
  type HokusaiDispatchPayload,
  type HokusaiOutcome,
  type HokusaiTaskInput,
  type ModelDefinition,
  type OutcomeReport,
  type OutcomeResponse,
  type RouteResponse,
} from '@hokusai/core';
import { FAKE_OUTCOME, FAKE_TASK_CONTEXT } from './fake-data.js';
import {
  createMockHokusaiClient,
  type MockHokusaiClient,
} from './mock-client.js';

export const REFERENCE_MODEL: ModelDefinition = {
  id: 'gpt-5-reference',
  provider: 'openai',
  family: 'gpt-5',
  capabilities: ['reasoning', 'tool-use'],
  default: true,
};

const REDACTION_SALT = 'reference-harness-salt';
const FAKE_SECRET = 'fake-secret-DO-NOT-USE';

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function requireOk<T>(result: AdapterResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

export function createReferenceHarnessAdapter(): HarnessAdapter {
  const storage = new Map<string, string>();

  return {
    context: {
      collectTaskContext() {
        return Promise.resolve(ok(FAKE_TASK_CONTEXT));
      },
    },
    models: {
      discoverModels() {
        return Promise.resolve(ok([
          {
            id: REFERENCE_MODEL.id,
            label: 'GPT-5 Reference',
            metadata: {
              provider: REFERENCE_MODEL.provider,
            },
          },
        ]));
      },
      mapModel(request) {
        const availableModel = request.availableModels.find(
          (model) => model.id === request.harnessModelId,
        );

        if (!availableModel) {
          return Promise.resolve({
            ok: false as const,
            error: {
              code: 'model_not_found',
              message: `Model ${request.harnessModelId} is not available.`,
            },
          });
        }

        return Promise.resolve(ok({
          id: availableModel.id,
          provider: availableModel.provider,
          capabilities: [...availableModel.capabilities],
        }));
      },
    },
    recommendations: {
      displayRecommendation() {
        return ok(undefined);
      },
    },
    outcomes: {
      collectOutcome(request) {
        return Promise.resolve(ok({
          ...FAKE_OUTCOME,
          taskId: request.task.id,
        }));
      },
    },
    payloads: {
      previewPayload(request) {
        return ok(previewDispatchPayload(request.payload));
      },
    },
    consent: {
      promptConsent(request) {
        return Promise.resolve(ok({
          outcome: 'granted',
          scope: request.scope,
        }));
      },
    },
    storage: {
      get(key) {
        return Promise.resolve(ok(storage.get(key)));
      },
      set(key, value) {
        storage.set(key, value);
        return Promise.resolve(ok(undefined));
      },
      delete(key) {
        storage.delete(key);
        return Promise.resolve(ok(undefined));
      },
    },
  };
}

function previewDispatchPayload(payload: HokusaiDispatchPayload) {
  return {
    summary: `Dispatch ${payload.task.id} with ${payload.model.id}`,
    promptPreview: payload.prompt,
    redactionCount: payload.redactions.length,
  };
}

function logStep(step: number, message: string): void {
  console.log(`[${step}/9] ${message}`);
}

export interface ReferenceFlowSummary {
  task: HokusaiTaskInput;
  packetPrompt: string;
  packetRedactionCount: number;
  packet: ReturnType<typeof buildTaskPacket>;
  routeStatus: 'accepted';
  correlationId: string;
  storedDecisionId: string;
  mappedModelId: string;
  outcome: HokusaiOutcome;
  report: OutcomeReport;
  reportNotes: string | undefined;
  submittedCorrelationId: string;
  reportStatus: 'recorded';
}

export async function runReferenceFlow(): Promise<ReferenceFlowSummary> {
  const adapter = createReferenceHarnessAdapter();
  const mockClient: MockHokusaiClient = createMockHokusaiClient();
  const registry = new InMemoryModelRegistry([REFERENCE_MODEL]);
  const dispatchBuilder = new HokusaiDispatchBuilder({
    consent: {
      subjectId: FAKE_TASK_CONTEXT.task.id,
      grantedScopes: ['task-execution'],
    },
    modelRegistry: registry,
    redactionConfig: {
      ...DEFAULT_REDACTION_CONFIG,
      salt: REDACTION_SALT,
      customRules: [
        {
          category: 'secret',
          pattern: new RegExp(FAKE_SECRET, 'g'),
        },
      ],
    },
    clock: () => new Date('2026-06-08T00:00:00.000Z'),
  });
  const localStore = new InMemoryLocalStore();

  logStep(1, 'Collecting task context');
  const ctx = requireOk<typeof FAKE_TASK_CONTEXT>(
    await adapter.context.collectTaskContext({}),
  );

  logStep(2, 'Building generic task packet');
  const packet = buildTaskPacket({
    userIntent: ctx.task.prompt,
    taskFamily: 'feature',
    reasoningDepth: 'standard',
    languageSignals: ['TypeScript'],
    frameworkSignals: ['Node.js'],
  });

  logStep(3, 'Previewing anonymized dispatch payload');
  const dispatchPayload = await dispatchBuilder.prepareDispatch(
    ctx.task,
    REFERENCE_MODEL.id,
  );
  const preview = requireOk<ReturnType<typeof previewDispatchPayload>>(
    await adapter.payloads.previewPayload({ payload: dispatchPayload }),
  );
  console.log(`prompt=${preview.promptPreview}`);
  console.log(`redactions=${preview.redactionCount}`);

  logStep(4, 'Calling mock route');
  const routeResponse: RouteResponse = await mockClient.route(dispatchPayload);

  logStep(5, 'Mapping recommended model');
  const mappedModel = mapRecommendation(
    { model: REFERENCE_MODEL.id },
    { registry },
  );

  logStep(6, 'Persisting local decision id');
  await localStore.putCorrelation({
    correlationId: routeResponse.routeId,
    packetHash: 'fake-hash-for-example',
    createdAt: Date.now(),
  });
  const stored = await localStore.getCorrelation(routeResponse.routeId);
  if (!stored) {
    throw new Error('Local decision id was not stored.');
  }

  logStep(7, 'Collecting fake outcome');
  const outcome = requireOk<HokusaiOutcome>(
    await adapter.outcomes.collectOutcome({
      task: ctx.task,
      model: {
        id: mappedModel.id,
        provider: mappedModel.provider,
        capabilities: [...mappedModel.capabilities],
      },
    }),
  );

  logStep(8, 'Previewing anonymized outcome report');
  const reportInput = {
    correlationId: stored.correlationId,
    recommendedModel: mappedModel.id,
    actualModel: mappedModel.id,
    recommendationAccepted: true,
    completionStatus: 'succeeded' as const,
    latencyBucket: 'low' as const,
    costBucket: 'low' as const,
    tokenBucket: 'medium' as const,
    notes: outcome.summary,
    redactionSalt: REDACTION_SALT,
  };
  const report = buildOutcomeReport(reportInput);
  const reportPreview = previewOutcomePayload(reportInput);
  console.log(`notes=${reportPreview.notes ?? ''}`);

  logStep(9, 'Submitting report');
  const ack: OutcomeResponse = await mockClient.reportOutcome(report);
  if (ack.status !== 'recorded') {
    throw new Error(`Unexpected outcome acknowledgement: ${ack.status}`);
  }
  console.log(`[9/9] Submitting report -> ${ack.status}`);

  return {
    task: ctx.task,
    packetPrompt: preview.promptPreview,
    packetRedactionCount: preview.redactionCount,
    packet,
    routeStatus: routeResponse.status,
    correlationId: routeResponse.routeId,
    storedDecisionId: stored.correlationId,
    mappedModelId: mappedModel.id,
    outcome,
    report,
    reportNotes: reportPreview.notes,
    submittedCorrelationId: report.correlationId,
    reportStatus: ack.status,
  };
}

async function main(): Promise<void> {
  await runReferenceFlow();
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntrypoint) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
