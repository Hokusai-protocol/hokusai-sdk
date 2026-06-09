import { buildOutcomeReport, type OutcomeReport, type OutcomeReportInput } from './outcome.js';
import { type RedactionCategory } from './anonymization.js';
import { createGatedClient, type FetchTransport } from './client.js';
import type { AdapterResult, HarnessPayloadPreview } from './adapter.js';
import type { ConsentScope } from './consent.js';
import { validateOutcomeReport, type HokusaiDispatchPayload } from './schemas.js';
import {
  type ModelCapability,
  type ModelSelection,
} from './model-registry.js';
import { validateTaskPacket, type TaskPacket } from './task-packet.js';
import {
  type CorrelationRecord,
  type CorrelationStorage,
} from './storage.js';

export const conformanceFixtures = {
  privateTaskText: `Fix regression for jane.doe@example-corp.internal.
Use API key sk-FAKE123ABCDabcd before calling https://api.example-corp.internal/v2.
Worker: worker-prod-01.example-corp.internal

\`\`\`ts
const secret = "do-not-ship";
\`\`\`

2026-06-08T12:00:00.000Z ERROR auth failed for jane.doe@example-corp.internal`,
  privateValues: [
    'jane.doe@example-corp.internal',
    'sk-FAKE123ABCDabcd',
    'https://api.example-corp.internal/v2',
    'worker-prod-01.example-corp.internal',
    'const secret = "do-not-ship"',
    '2026-06-08T12:00:00.000Z ERROR auth failed',
  ] as string[],
  redactionSalt: 'conformance-test-salt-2026',
  outcomeInput: {
    correlationId: 'conformance-corr-001',
    recommendedModel: 'conformance-model',
    actualModel: 'conformance-model',
    recommendationAccepted: true,
    completionStatus: 'succeeded',
    latencyBucket: 'medium',
    costBucket: 'medium',
    tokenBucket: 'medium',
  } satisfies OutcomeReportInput,
  correlationId: 'conformance-storage-test-001',
  samplePayload: {
    task: { id: 'conformance-task-1', prompt: 'Implement the change' },
    prompt: 'Implement the change',
    consent: {
      subjectId: 'conformance-subject',
      grantedScopes: ['task-execution'] as ConsentScope[],
    },
    model: {
      id: 'conformance-model',
      provider: 'conformance',
      capabilities: ['reasoning'] as ModelCapability[],
    },
    correlation: {
      taskId: 'conformance-task-1',
      correlationId: 'conformance-corr-preview',
      createdAt: '2026-06-08T12:00:00.000Z',
    },
    redactions: [
      {
        category: 'email' as RedactionCategory,
        placeholder: 'EMAIL_deadbeef',
        count: 1,
      },
    ],
    createdAt: '2026-06-08T12:00:00.000Z',
  } satisfies HokusaiDispatchPayload,
};

export interface ConformanceSubject {
  buildTaskPacket(text: string): TaskPacket;
  buildOutcomeReport(input: OutcomeReportInput): OutcomeReport;
  previewPayload(
    payload: HokusaiDispatchPayload,
  ): HarnessPayloadPreview | Promise<HarnessPayloadPreview>;
  store: CorrelationStorage;
  mapModel(modelId: string): Promise<AdapterResult<ModelSelection>>;
  supportedModelId: string;
}

export interface ConformanceCheck {
  name: string;
  run(subject: ConformanceSubject): void | Promise<void>;
}

export const conformanceChecks: ConformanceCheck[] = [
  {
    name: 'task-packet-schema',
    run(subject) {
      const packet = subject.buildTaskPacket(conformanceFixtures.privateTaskText);
      const result = validateTaskPacket(packet);

      if (!result.ok) {
        throw new Error(
          `Task packet failed schema validation: ${formatMessages(result.errors.map((error) => `${error.path}: ${error.message}`))}`,
        );
      }
    },
  },
  {
    name: 'outcome-report-schema',
    run(subject) {
      const report = subject.buildOutcomeReport(conformanceFixtures.outcomeInput);
      const errors = validateOutcomeReport(report);

      if (errors.length > 0) {
        throw new Error(
          `Outcome report failed schema validation: ${formatMessages(errors.map((error) => `${error.path}: ${error.message}`))}`,
        );
      }
    },
  },
  {
    name: 'redaction',
    run(subject) {
      const packet = subject.buildTaskPacket(conformanceFixtures.privateTaskText);
      const serializedPacket = JSON.stringify(packet);
      const leakedValue = conformanceFixtures.privateValues.find((value) =>
        serializedPacket.includes(value),
      );

      if (leakedValue) {
        throw new Error(`Task packet leaked private value: ${leakedValue}`);
      }
    },
  },
  {
    name: 'payload-preview',
    async run(subject) {
      const preview = await subject.previewPayload(conformanceFixtures.samplePayload);

      if (typeof preview.summary !== 'string' || preview.summary.trim().length === 0) {
        throw new Error('Payload preview must include a non-empty summary.');
      }

      if (
        typeof preview.promptPreview !== 'string' ||
        preview.promptPreview.trim().length === 0
      ) {
        throw new Error('Payload preview must include a non-empty promptPreview.');
      }

      if (preview.redactionCount < 1) {
        throw new Error('Payload preview must report at least one redaction.');
      }
    },
  },
  {
    name: 'consent-gate',
    async run() {
      const routeRequest = conformanceFixtures.samplePayload;
      const outcomeRequest = buildOutcomeReport(conformanceFixtures.outcomeInput);
      const noAuthClient = createConformanceGatedClient({
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: true,
      });
      const noConsentClient = createConformanceGatedClient({
        apiKey: 'hk_live_conformance',
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
      });
      const allowedClient = createConformanceGatedClient({
        apiKey: 'hk_live_conformance',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: true,
      });

      await expectConsentError(
        noAuthClient.route(routeRequest),
        'routing',
        'no-auth',
      );
      await expectConsentError(
        noAuthClient.reportOutcome(outcomeRequest),
        'outcome',
        'no-auth',
      );
      await expectConsentError(
        noConsentClient.route(routeRequest),
        'routing',
        'no-consent',
      );
      await expectConsentError(
        noConsentClient.reportOutcome(outcomeRequest),
        'outcome',
        'no-consent',
      );

      await allowedClient.route(routeRequest);
      await allowedClient.reportOutcome(outcomeRequest);
    },
  },
  {
    name: 'correlation-storage',
    async run(subject) {
      const record: CorrelationRecord = {
        taskId: 'conformance-task-storage',
        correlationId: conformanceFixtures.correlationId,
        createdAt: '2026-06-08T12:00:00.000Z',
      };

      await subject.store.set(record);
      const stored = await subject.store.get(record.taskId);

      if (!stored) {
        throw new Error('Correlation record was not persisted.');
      }

      if (
        stored.taskId !== record.taskId ||
        stored.correlationId !== record.correlationId ||
        stored.createdAt !== record.createdAt
      ) {
        throw new Error('Correlation storage did not return the original record.');
      }
    },
  },
  {
    name: 'unsupported-model',
    async run(subject) {
      const supportedResult = await subject.mapModel(subject.supportedModelId);
      if (!supportedResult.ok) {
        throw new Error(
          `Supported model mapping failed: ${supportedResult.error.code} ${supportedResult.error.message}`,
        );
      }

      const unsupportedResult = await subject.mapModel(
        'conformance-unknown-model-xyz-99',
      );
      if (unsupportedResult.ok) {
        throw new Error('Unsupported model unexpectedly mapped successfully.');
      }

      if (
        typeof unsupportedResult.error.code !== 'string' ||
        unsupportedResult.error.code.trim().length === 0
      ) {
        throw new Error('Unsupported model error must include a non-empty code.');
      }
    },
  },
];

export async function runAdapterConformance(
  subject: ConformanceSubject,
): Promise<void> {
  const failures: string[] = [];

  for (const check of conformanceChecks) {
    try {
      await check.run(subject);
    } catch (error) {
      failures.push(
        `${check.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Adapter conformance failed:\n${failures.join('\n')}`);
  }
}

function createConformanceGatedClient(config: {
  apiKey?: string;
  routingConsentEnabled: boolean;
  outcomeSubmissionEnabled: boolean;
}) {
  return createGatedClient({
    config: {
      apiBaseUrl: 'https://api.hokusai.app',
      modelAllowlist: ['conformance-model'],
      ...config,
    },
    transport: createMockTransport(),
  });
}

function createMockTransport(): FetchTransport {
  return (input) => {
    if (input.endsWith('/v1/route')) {
      return Promise.resolve({
        status: 200,
        headers: {
          get() {
            return null;
          },
        },
        text() {
          return Promise.resolve(
            JSON.stringify({
              routeId: 'conformance-route-1',
              taskId: conformanceFixtures.samplePayload.task.id,
              status: 'accepted',
            }),
          );
        },
      });
    }

    return Promise.resolve({
      status: 202,
      headers: {
        get() {
          return null;
        },
      },
      text() {
        return Promise.resolve(
          JSON.stringify({
            taskId: conformanceFixtures.outcomeInput.correlationId,
            status: 'accepted',
          }),
        );
      },
    });
  };
}

async function expectConsentError(
  promise: Promise<unknown>,
  scope: 'routing' | 'outcome',
  reason: 'no-auth' | 'no-consent',
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (
      error instanceof Error &&
      'scope' in error &&
      'reason' in error &&
      error.scope === scope &&
      error.reason === reason
    ) {
      return;
    }

    throw new Error(
      `Expected ${scope}/${reason} consent error, got ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  throw new Error(`Expected ${scope}/${reason} consent error, but request succeeded.`);
}

function formatMessages(messages: string[]): string {
  return messages.join('; ');
}
