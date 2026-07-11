import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FilePluginConfigStore,
  FsLocalStore,
  HokusaiClient,
  HokusaiNetworkError,
  InMemoryModelRegistry,
  claudeCodeSuccessOutcomeFixture,
  type FetchTransport,
} from '@hokusai/core';
import {
  clearClaudeCodeLocalState,
  clearPrivacyState,
  declineRecommendation,
  displayHandoff,
  displayTaskRecommendation,
  findLatestRoutingDecision,
  getReportingStatus,
  listRoutingDecisions,
  listSubmissionAudit,
  previewReportOutcome,
  previewStoredDecision,
  previewTaskPayload,
  reportTaskOutcome,
  setReportingEnabled,
  routeTask,
  resolveRetentionPolicy,
  runDoctor,
} from './commands.js';

interface MockCall {
  input: string;
  init: Parameters<FetchTransport>[1];
}

const tempDirs: string[] = [];

function createHeaders(
  values: Record<string, string> = {},
): Awaited<ReturnType<FetchTransport>>['headers'] {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    get(name: string): string | null {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

function createResponse(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): Awaited<ReturnType<FetchTransport>> {
  return {
    status,
    headers: createHeaders(headers),
    text(): Promise<string> {
      return Promise.resolve(
        body === undefined
          ? ''
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
      );
    },
  };
}

function createMockTransport(
  sequence: Array<Awaited<ReturnType<FetchTransport>> | Error>,
): {
  calls: MockCall[];
  transport: FetchTransport;
} {
  const calls: MockCall[] = [];
  let index = 0;

  return {
    calls,
    transport: (input, init) => {
      calls.push({ input, init });
      const result = sequence[index] ?? sequence[sequence.length - 1];
      index += 1;

      if (!result) {
        return Promise.reject(new Error('Mock transport sequence is empty.'));
      }

      if (result instanceof Error) {
        return Promise.reject(result);
      }

      return Promise.resolve(result);
    },
  };
}

function callsForPath(calls: MockCall[], pathname: string): MockCall[] {
  return calls.filter((call) => new URL(call.input).pathname === pathname);
}

/**
 * Path-aware transport: returns a response based on the request pathname rather
 * than call ordering. Robust to the (funnel-signal-dependent) number and order
 * of calls the report flow makes across contributions, outcomes, and signals.
 */
function createPathTransport(
  responses: Record<string, Awaited<ReturnType<FetchTransport>>>,
): { calls: MockCall[]; transport: FetchTransport } {
  const calls: MockCall[] = [];

  return {
    calls,
    transport: (input, init) => {
      calls.push({ input, init });
      const pathname = new URL(input).pathname;
      const result = responses[pathname];
      if (!result) {
        return Promise.reject(
          new Error(`No mock response registered for path ${pathname}`),
        );
      }
      return Promise.resolve(result);
    },
  };
}

// Redacted routing context / inference log id as persisted at route time, so
// the report step can build the canonical harness contribution row.
const testRouteContext = {
  taskDescriptor: { task_type: 'feature', language: 'typescript' },
  allowedModels: ['claude-3-7-sonnet', 'gpt-5-codex'],
  budgetUsd: 5,
};
const testInferenceLogId = 'inf-log-1';

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('runDoctor', () => {
  it('reports missing config as setup needed without throwing', async () => {
    const configPath = path.join(os.tmpdir(), `missing-${Date.now()}`);

    await rm(configPath, { recursive: true, force: true });

    expect(runDoctor({ configPath })).toMatchObject({
      configPresent: false,
      needsSetup: true,
    });
  });

  it('reports an existing config directory as present', async () => {
    const configPath = await createTempDir('hokusai-claude-doctor-');
    await mkdir(configPath, { recursive: true });

    expect(runDoctor({ configPath })).toMatchObject({
      configPresent: true,
      needsSetup: false,
    });
  });
});

describe('previewTaskPayload', () => {
  it('returns a redacted preview without calling the network', () => {
    const result = previewTaskPayload({
      taskId: 'task-preview',
      taskText:
        'Email alice@example.com and use sk-12345678 on db-prod.internal',
      modelId: 'claude-sonnet-4-6',
    });

    expect(result.packet.userIntent).not.toContain('alice@example.com');
    expect(result.packet.userIntent).not.toContain('sk-12345678');
    expect(result.preview.willSend.userIntent).not.toContain(
      'alice@example.com',
    );
    expect(result.harnessPreview.redactionCount).toBeGreaterThan(0);
  });
});

describe('routeTask', () => {
  it('rejects empty tasks before any network call', async () => {
    await expect(
      routeTask({
        taskText: '   ',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_TASK',
        message: 'Expected "taskText" to be a non-empty string.',
      },
    });
  });

  it('returns provider mapping errors for unsupported models', async () => {
    const registry = new InMemoryModelRegistry([
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt',
        capabilities: ['reasoning', 'tool-use'],
        default: true,
      },
    ]);

    const result = await routeTask(
      {
        taskText: 'Route this task',
      },
      {
        registry,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('PROVIDER_NOT_ALLOWED');
  });

  it('prefers the API recommendation when the route response includes one', async () => {
    const configPath = await createTempDir('hokusai-claude-route-');
    const { transport } = createMockTransport([
      createResponse(200, {
        routeId: 'route-1',
        taskId: 'task-1',
        status: 'accepted',
        requestId: 'req-1',
        recommendation: {
          model: 'claude-opus-4-8',
          reason: 'High reasoning depth needed.',
          confidence: 0.91,
          alternatives: [
            {
              model: 'claude-sonnet-4-6',
              reason: 'Faster but slightly less depth.',
              confidence: 0.73,
            },
          ],
        },
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });
    const registry = new InMemoryModelRegistry([
      {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        family: 'claude',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
        default: true,
      },
      {
        id: 'claude-opus-4-8',
        provider: 'anthropic',
        family: 'claude',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
      },
    ]);

    const result = await routeTask(
      {
        taskId: 'task-1',
        taskText: 'Deeply debug an intermittent production issue.',
      },
      {
        apiClient: client,
        configPath,
        registry,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.recommendation).toMatchObject({
      model: {
        id: 'claude-opus-4-8',
      },
      reason: 'High reasoning depth needed.',
      confidence: 0.91,
      alternatives: [
        {
          model: {
            id: 'claude-sonnet-4-6',
          },
          reason: 'Faster but slightly less depth.',
          confidence: 0.73,
        },
      ],
    });
    expect(result.value.route?.requestId).toBe('req-1');
    expect(result.value.correlationId).toBeTruthy();
    expect(result.value.routingDecisionId).toBe(result.value.correlationId);
    expect(result.value.handoff.slashCommand).toBe('/model claude-opus-4-8');

    const store = new FsLocalStore(configPath);
    const persisted = await store.getCorrelation(
      result.value.correlationId.replace(/[:.]/g, '_'),
    );

    expect(persisted?.metadata).toMatchObject({
      recommendedModelId: 'claude-opus-4-8',
      status: 'pending',
    });
    expect(
      JSON.parse(persisted?.metadata?.recommendedAlternativeIds ?? '[]'),
    ).toEqual(['claude-sonnet-4-6']);
    expect(persisted?.metadata?.reasonHash).toBeTruthy();
    expect(persisted?.metadata?.payloadHash).toBeTruthy();

    const auditEntries = await store.listAudit();
    expect(auditEntries).toEqual([
      expect.objectContaining({
        kind: 'routing',
        status: 'submitted',
        correlationId: result.value.correlationId,
      }),
    ]);

    const payloadHashes = await store.listPayloadHashes();
    expect(payloadHashes).toEqual([
      expect.objectContaining({
        algorithm: 'sha-256-hmac',
        hash: persisted?.metadata?.payloadHash,
      }),
    ]);
  });

  it('returns a no-op handoff when the current model already matches', async () => {
    const configPath = await createTempDir('hokusai-claude-noop-');
    const result = await routeTask(
      {
        taskText: 'Keep the current model.',
        modelId: 'claude-sonnet-4-6',
      },
      {
        configPath,
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
            default: true,
          },
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.handoff.instructions).toEqual([]);
    expect(displayHandoff(result.value.handoff)).toEqual([
      'Switch in Claude Code: no switch needed.',
    ]);
  });

  it('writes a failed routing audit entry on network error', async () => {
    const configPath = await createTempDir('hokusai-claude-route-fail-');
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport: () =>
        Promise.reject(
          new HokusaiNetworkError('router unavailable', {
            requestId: 'req-fail',
          }),
        ),
    });

    const result = await routeTask(
      {
        taskId: 'task-failure',
        taskText: 'Handle a failed route call.',
      },
      {
        apiClient: client,
        configPath,
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
            default: true,
          },
          {
            id: 'claude-opus-4-8',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
          },
        ]),
      },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'router unavailable',
        details: {
          requestId: 'req-fail',
        },
      },
    });

    const store = new FsLocalStore(configPath);
    expect(await store.listAudit()).toEqual([
      expect.objectContaining({
        kind: 'routing',
        status: 'failed',
        error: 'router unavailable',
      }),
    ]);
  });

  it('stores a redacted debug preview only when debug mode is enabled', async () => {
    const configPath = await createTempDir('hokusai-claude-debug-preview-');
    const rawTask =
      'Email alice@example.com about sk-12345678 and inspect db-prod.internal.';

    const debugResult = await routeTask(
      {
        taskId: 'task-debug',
        taskText: rawTask,
      },
      {
        configPath,
        env: {
          ...process.env,
          HOKUSAI_DEBUG: '1',
        },
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
            default: true,
          },
        ]),
      },
    );

    expect(debugResult.ok).toBe(true);
    if (!debugResult.ok) {
      return;
    }

    const store = new FsLocalStore(configPath);
    const persisted = await store.getCorrelation(
      debugResult.value.correlationId.replace(/[:.]/g, '_'),
    );
    expect(persisted?.metadata?.debugRedactedPayloadPreview).toContain(
      'EMAIL_',
    );
    expect(persisted?.metadata?.debugRedactedPayloadPreview).not.toContain(
      'alice@example.com',
    );

    const rawOnDisk = await readFile(
      path.join(
        configPath,
        'correlations',
        `${debugResult.value.correlationId.replace(/[:.]/g, '_')}.json`,
      ),
      'utf8',
    );
    expect(rawOnDisk).not.toContain('alice@example.com');
    expect(rawOnDisk).not.toContain('sk-12345678');
  });
});

describe('routeTask descriptor enrichment', () => {
  const anthropicRegistry = () =>
    new InMemoryModelRegistry([
      {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        family: 'claude',
        capabilities: ['reasoning', 'streaming', 'tool-use'],
        default: true,
      },
    ]);

  async function routeAndReadContext(input: Parameters<typeof routeTask>[0]) {
    const configPath = await createTempDir('hokusai-claude-descriptor-');
    const result = await routeTask(input, {
      configPath,
      registry: anthropicRegistry(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('routeTask failed');
    }

    const storedId = result.value.correlationId.replace(/[:.]/g, '_');
    const store = new FsLocalStore(configPath);
    const persisted = await store.getCorrelation(storedId);
    const rawOnDisk = await readFile(
      path.join(configPath, 'correlations', `${storedId}.json`),
      'utf8',
    );
    const routeContext = JSON.parse(
      persisted?.metadata?.routeContext ?? '{}',
    ) as { taskDescriptor: Record<string, string | number>; budgetUsd?: number };
    return { routeContext, rawOnDisk };
  }

  it('derives task_type and complexity from the task text without leaking raw text', async () => {
    const taskText =
      'Implement a new feature to add support for exporting reports as PDF files';
    const { routeContext, rawOnDisk } = await routeAndReadContext({ taskText });

    expect(routeContext.taskDescriptor).toMatchObject({
      task_type: 'feature',
      // Numeric score. The server's _complexity_number defaults any word it does
      // not recognize to 5.0, so emitting 'standard' erased the signal.
      complexity: 5,
    });
    // Privacy: only categorical labels are persisted; never the raw task text.
    expect(rawOnDisk).not.toContain('exporting reports');
    expect(rawOnDisk).not.toContain(taskText);
    expect(JSON.stringify(routeContext.taskDescriptor)).not.toContain('PDF');
  });

  it('lets harness-supplied metadata override derived descriptor labels', async () => {
    const { routeContext } = await routeAndReadContext({
      taskText:
        'Implement a new feature to add support for exporting reports as PDF files',
      metadata: { task_type: 'bugfix', complexity: 'deep' },
    });

    expect(routeContext.taskDescriptor).toMatchObject({
      task_type: 'bugfix',
      // A harness may still supply a word; it is normalized to the score.
      complexity: 8,
    });
  });

  it('normalizes a numeric complexity supplied by the harness', async () => {
    const { routeContext } = await routeAndReadContext({
      taskText: 'Implement a new feature',
      metadata: { complexity: '7' },
    });

    expect(routeContext.taskDescriptor.complexity).toBe(7);
  });

  it('derives repo_size_bucket and dominant language from repository signals', async () => {
    const { routeContext } = await routeAndReadContext({
      taskText: 'Refactor the storage layer to reduce duplication',
      repositorySignals: {
        fileCount: 250,
        extensionCounts: { ts: 10, py: 3 },
      },
    });

    expect(routeContext.taskDescriptor).toMatchObject({
      task_type: 'refactor',
      repo_size_bucket: 'medium',
      // Lowercase HokusaiLanguage enum value, not the display label.
      language: 'typescript',
    });
  });
});

describe('declineRecommendation', () => {
  it('updates the persisted routing decision to declined with a redacted reason', async () => {
    const configPath = await createTempDir('hokusai-claude-decline-');
    const routed = await routeTask(
      {
        taskId: 'task-decline',
        taskText: 'Email alice@example.com about the routing choice.',
        modelId: 'claude-sonnet-4-6',
      },
      {
        configPath,
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
            default: true,
          },
        ]),
      },
    );

    expect(routed.ok).toBe(true);
    if (!routed.ok) {
      return;
    }

    const declined = await declineRecommendation(
      {
        correlationId: routed.value.correlationId,
        reason:
          'Prefer email alice@example.com follow-up on a faster model because the task is small.',
      },
      {
        configPath,
      },
    );

    expect(declined).toEqual({
      ok: true,
      value: {
        correlationId: routed.value.correlationId,
        status: 'declined',
      },
    });

    const store = new FsLocalStore(configPath);
    const persisted = await store.getCorrelation(
      routed.value.correlationId.replace(/[:.]/g, '_'),
    );

    expect(persisted?.metadata?.status).toBe('declined');
    expect(persisted?.metadata?.declinedAt).toBeTruthy();
    expect(persisted?.metadata?.declineReason).not.toContain(
      'alice@example.com',
    );
  });

  it('returns an error for an unknown correlation id', async () => {
    await expect(
      declineRecommendation(
        {
          correlationId: 'missing-correlation',
        },
        {
          configPath: await createTempDir('hokusai-claude-missing-'),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_CORRELATION',
        message:
          'No stored routing decision matches correlation id missing-correlation.',
      },
    });
  });
});

describe('reportTaskOutcome', () => {
  it('builds a preview with redacted notes and explicit exclusions', () => {
    const result = previewReportOutcome({
      taskId: 'task-preview',
      ...claudeCodeSuccessOutcomeFixture,
      notes: 'Email alice@example.com and see https://db-prod.internal/logs',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.preview.payload.notes).not.toContain(
      'alice@example.com',
    );
    expect(result.value.preview.payload.notes).not.toContain(
      'db-prod.internal',
    );
    expect(result.value.preview.lines.join('\n')).toContain(
      'Recommended model: claude-3-7-sonnet',
    );
    expect(result.value.preview.lines.join('\n')).toContain(
      'Excluded by default: raw code, raw prompts, terminal logs, and customer data.',
    );
  });

  it('supports dry-run mode without calling the network', async () => {
    const configPath = await createTempDir('hokusai-claude-outcome-dryrun-');
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        taskId: 'task-1',
        status: 'accepted',
      }),
      createResponse(204),
      createResponse(204),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
      },
      {
        apiClient: client,
        configPath,
        dryRun: true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        submitted: false,
      },
    });
    expect(calls).toHaveLength(0);

    const store = new FsLocalStore(configPath);
    const auditEntries = await store.listAudit();
    expect(auditEntries).toEqual([
      expect.objectContaining({
        kind: 'outcome',
        status: 'skipped',
        error: 'dry-run',
      }),
    ]);
  });

  it('submits a valid outcome once', async () => {
    const configPath = await createTempDir('hokusai-claude-outcome-success-');
    const { calls, transport } = createPathTransport({
      '/api/v1/models/30/contributions': createResponse(200, {
        accepted: true,
        submissionId: 'sub-1',
        rowsAccepted: 1,
        submittedRows: 1,
      }),
      '/v1/outcomes': createResponse(200, {
        taskId: 'task-1',
        status: 'accepted',
      }),
      '/v1/signals': createResponse(204),
    });
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
        routeContext: testRouteContext,
        inferenceLogId: testInferenceLogId,
      },
      {
        apiClient: client,
        configPath,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        submitted: true,
        response: {
          taskId: 'task-1',
          status: 'accepted',
        },
        contribution: {
          accepted: true,
          submissionId: 'sub-1',
          rowsAccepted: 1,
        },
        contributionRow: {
          schema_version: 'harness_outcome_row/v1',
          inference_log_id: testInferenceLogId,
          selected_models: {
            coder: 'claude-3-7-sonnet',
            reviewer: 'claude-3-7-sonnet',
          },
          completion_result: 'success',
        },
      },
    });
    // Canonical submission to the Model 30 contributions endpoint.
    expect(callsForPath(calls, '/api/v1/models/30/contributions')).toHaveLength(
      1,
    );
    const contributionCall = callsForPath(
      calls,
      '/api/v1/models/30/contributions',
    )[0];
    expect(contributionCall?.init.headers?.['Idempotency-Key']).toBe(
      claudeCodeSuccessOutcomeFixture.correlationId,
    );
    // Retained telemetry bridge.
    expect(callsForPath(calls, '/v1/outcomes')).toHaveLength(1);
    expect(callsForPath(calls, '/v1/signals')).toHaveLength(2);

    const store = new FsLocalStore(configPath);
    const audit = await store.listAudit();
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'outcome',
          status: 'submitted',
          correlationId: claudeCodeSuccessOutcomeFixture.correlationId,
        }),
      ]),
    );
    expect(await store.listPayloadHashes()).toHaveLength(1);
  });

  it('returns validation errors without calling the network', async () => {
    const { calls, transport } = createMockTransport([
      createResponse(200, {
        taskId: 'task-1',
        status: 'accepted',
      }),
    ]);
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
        recommendedModel: '',
      },
      {
        apiClient: client,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe('OUTCOME_VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('writes a skipped audit entry when no API client is configured', async () => {
    const configPath = await createTempDir('hokusai-claude-outcome-skip-');
    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
      },
      {
        configPath,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        submitted: false,
      },
    });

    const store = new FsLocalStore(configPath);
    expect(await store.listAudit()).toEqual([
      expect.objectContaining({
        kind: 'outcome',
        status: 'skipped',
      }),
    ]);
  });

  it('writes a failed outcome audit entry on network error', async () => {
    const configPath = await createTempDir('hokusai-claude-outcome-fail-');
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport: () =>
        Promise.reject(
          new HokusaiNetworkError('outcome unavailable', {
            requestId: 'req-outcome',
          }),
        ),
    });

    const result = await reportTaskOutcome(
      {
        taskId: 'task-1',
        ...claudeCodeSuccessOutcomeFixture,
        routeContext: testRouteContext,
        inferenceLogId: testInferenceLogId,
      },
      {
        apiClient: client,
        configPath,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'outcome unavailable',
        details: {
          requestId: 'req-outcome',
        },
      },
    });

    const store = new FsLocalStore(configPath);
    expect(await store.listAudit()).toEqual([
      expect.objectContaining({
        kind: 'outcome',
        status: 'failed',
        error: 'outcome unavailable',
      }),
    ]);
  });
});

describe('contribution row training-eligibility', () => {
  const richRouteContext = {
    taskDescriptor: {
      task_type: 'feature',
      complexity: 5,
      language: 'typescript',
      repo_size_bucket: 'medium',
    },
    allowedModels: ['claude-sonnet-4-6', 'claude-opus-4-8'],
    budgetUsd: 5,
  };

  it('builds a training-eligible row when budget and actual cost are present', () => {
    const result = previewReportOutcome({
      taskId: 'task-eligible',
      ...claudeCodeSuccessOutcomeFixture,
      routeContext: richRouteContext,
      inferenceLogId: 'inf-eligible',
      actualCostUsd: 0.32,
      wallClockSeconds: 120,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // A training-eligible row carries a rich descriptor + allowed_models +
    // selected_models{coder,reviewer} + budget_usd + actual_cost_usd +
    // completion_result. The server classifies fidelity from these fields.
    expect(result.value.contributionRow).toMatchObject({
      task_descriptor: {
        task_type: 'feature',
        complexity: 5,
        language: 'typescript',
        repo_size_bucket: 'medium',
      },
      allowed_models: ['claude-sonnet-4-6', 'claude-opus-4-8'],
      selected_models: {
        coder: 'claude-3-7-sonnet',
        reviewer: 'claude-3-7-sonnet',
      },
      budget_usd: 5,
      actual_cost_usd: 0.32,
      completion_result: 'success',
    });
  });

  it('builds only a partial (telemetry-only) row when actual cost is absent', () => {
    const result = previewReportOutcome({
      taskId: 'task-partial',
      ...claudeCodeSuccessOutcomeFixture,
      routeContext: richRouteContext,
      inferenceLogId: 'inf-partial',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const row = result.value.contributionRow;
    expect(row).toBeDefined();
    // Budget and descriptor are present, but without an actual cost the row is
    // partial (telemetry only) — the field must be absent, not fabricated.
    expect(row).toMatchObject({ budget_usd: 5, completion_result: 'success' });
    expect(row).not.toHaveProperty('actual_cost_usd');
  });
});

describe('findLatestRoutingDecision', () => {
  it('returns undefined when there are no stored correlations', async () => {
    const configDir = await createTempDir('hokusai-claude-latest-empty-');

    await expect(
      findLatestRoutingDecision({ configDir }),
    ).resolves.toBeUndefined();
  });

  it('returns the only stored correlation', async () => {
    const configDir = await createTempDir('hokusai-claude-latest-one-');
    await mkdir(path.join(configDir, 'correlations'), { recursive: true });
    await writeFile(
      path.join(configDir, 'correlations', 'corr_1.json'),
      JSON.stringify({
        correlationId: 'corr_1',
        packetHash: 'task-1',
        createdAt: 100,
        metadata: {
          taskId: 'task-1',
          originalCorrelationId: 'route:1',
        },
      }),
      'utf8',
    );

    await expect(findLatestRoutingDecision({ configDir })).resolves.toEqual({
      correlationId: 'route:1',
      taskId: 'task-1',
      createdAt: new Date(100).toISOString(),
    });
  });

  it('returns the most recent stored correlation', async () => {
    const configDir = await createTempDir('hokusai-claude-latest-many-');
    await mkdir(path.join(configDir, 'correlations'), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(configDir, 'correlations', 'corr_1.json'),
        JSON.stringify({
          correlationId: 'corr_1',
          packetHash: 'task-1',
          createdAt: 100,
          metadata: {
            taskId: 'task-1',
          },
        }),
        'utf8',
      ),
      writeFile(
        path.join(configDir, 'correlations', 'corr_2.json'),
        JSON.stringify({
          correlationId: 'corr_2',
          packetHash: 'task-2',
          createdAt: 200,
          metadata: {
            taskId: 'task-2',
            originalCorrelationId: 'route:2',
          },
        }),
        'utf8',
      ),
    ]);

    await expect(findLatestRoutingDecision({ configDir })).resolves.toEqual({
      correlationId: 'route:2',
      taskId: 'task-2',
      createdAt: new Date(200).toISOString(),
    });
  });
});

describe('privacy commands', () => {
  it('lists routing decisions newest-first with limit and payload hashes', async () => {
    const configPath = await createTempDir('hokusai-claude-privacy-list-');
    const store = new FsLocalStore(configPath);
    const newerCreatedAt = Date.now();
    await store.putPayloadHash({
      hash: 'hash-1',
      algorithm: 'sha-256-hmac',
      createdAt: Date.now() - 1000,
    });
    await store.putPayloadHash({
      hash: 'hash-2',
      algorithm: 'sha-256-hmac',
      createdAt: Date.now(),
    });
    await store.putCorrelation({
      correlationId: 'corr-1',
      packetHash: 'task-1',
      createdAt: newerCreatedAt - 1,
      metadata: {
        taskId: 'task-1',
        originalCorrelationId: 'route:1',
        recommendedModelId: 'claude-sonnet-4-6',
        recommendedAlternativeIds: '["claude-opus-4-8"]',
        reasonPreview: 'first',
        status: 'pending',
        reasonHash: 'reason-1',
        payloadHash: 'hash-1',
      },
    });
    await store.putCorrelation({
      correlationId: 'corr-2',
      packetHash: 'task-2',
      createdAt: newerCreatedAt,
      metadata: {
        taskId: 'task-2',
        originalCorrelationId: 'route:2',
        recommendedModelId: 'claude-opus-4-8',
        recommendedAlternativeIds: '[]',
        reasonPreview: 'second',
        status: 'declined',
        reasonHash: 'reason-2',
        payloadHash: 'hash-2',
      },
    });

    const result = await listRoutingDecisions(
      { limit: 1 },
      {
        configPath,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        decisions: [
          expect.objectContaining({
            correlationId: 'route:2',
            taskId: 'task-2',
            recommendedModelId: 'claude-opus-4-8',
            alternatives: [],
            status: 'declined',
            payloadHash: expect.objectContaining({
              hash: 'hash-2',
            }),
          }),
        ],
      },
    });
  });

  it('previews a stored decision without debug data by default', async () => {
    const configPath = await createTempDir('hokusai-claude-privacy-preview-');
    const store = new FsLocalStore(configPath);
    await store.putCorrelation({
      correlationId: 'corr-preview',
      packetHash: 'task-preview',
      createdAt: Date.now(),
      metadata: {
        taskId: 'task-preview',
        originalCorrelationId: 'route:preview',
        recommendedModelId: 'claude-sonnet-4-6',
        recommendedAlternativeIds: '["claude-opus-4-8"]',
        reasonPreview: 'keep it short',
        status: 'pending',
        decisionAt: new Date(100).toISOString(),
        debugRedactedPayloadPreview: 'redacted debug preview',
      },
    });

    const normal = await previewStoredDecision(
      { correlationId: 'route:preview' },
      { configPath },
    );
    expect(normal.ok).toBe(true);
    if (!normal.ok) {
      return;
    }
    expect(normal.value.debugRedactedPayloadPreview).toBeUndefined();

    const debug = await previewStoredDecision(
      { correlationId: 'route:preview', debug: true },
      { configPath },
    );
    expect(debug).toEqual({
      ok: true,
      value: expect.objectContaining({
        correlationId: 'route:preview',
        debugRedactedPayloadPreview: 'redacted debug preview',
      }),
    });
  });

  it('lists audit entries newest-first and prunes expired records', async () => {
    const configPath = await createTempDir('hokusai-claude-privacy-audit-');
    const store = new FsLocalStore(configPath);
    const now = Date.UTC(2026, 5, 8);
    await store.appendAudit({
      id: 'audit-old',
      kind: 'routing',
      correlationId: 'old',
      status: 'submitted',
      timestamp: now - 10 * 24 * 60 * 60 * 1000,
    });
    await store.appendAudit({
      id: 'audit-new',
      kind: 'outcome',
      correlationId: 'new',
      status: 'failed',
      timestamp: now,
    });

    const result = await listSubmissionAudit(
      {},
      {
        clock: () => new Date(now),
        configPath,
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          expect.objectContaining({
            id: 'audit-new',
          }),
        ],
      },
    });
    expect(await store.listAudit()).toHaveLength(1);
  });

  it('clears records and audit scopes independently', async () => {
    const configPath = await createTempDir('hokusai-claude-privacy-clear-');
    const store = new FsLocalStore(configPath);
    await store.putCorrelation({
      correlationId: 'corr-clear',
      packetHash: 'task-clear',
      createdAt: 1,
    });
    await store.putPayloadHash({
      hash: 'hash-clear',
      algorithm: 'sha-256-hmac',
      createdAt: 1,
    });
    await store.appendAudit({
      id: 'audit-clear',
      kind: 'routing',
      correlationId: 'corr-clear',
      status: 'submitted',
      timestamp: 1,
    });

    await expect(
      clearPrivacyState({ scope: 'records' }, { configPath }),
    ).resolves.toEqual({
      ok: true,
      value: {
        scope: 'records',
        correlationsCleared: 1,
        payloadHashesCleared: 1,
        auditEntriesCleared: 0,
        configCleared: false,
      },
    });
    expect(await store.listCorrelations()).toHaveLength(0);
    expect(await store.listPayloadHashes()).toHaveLength(0);
    expect(await store.listAudit()).toHaveLength(1);

    await expect(
      clearPrivacyState({ scope: 'audit' }, { configPath }),
    ).resolves.toEqual({
      ok: true,
      value: {
        scope: 'audit',
        correlationsCleared: 0,
        payloadHashesCleared: 0,
        auditEntriesCleared: 1,
        configCleared: false,
      },
    });
    expect(await store.listAudit()).toHaveLength(0);
  });

  it('persists and resolves reporting status sources', async () => {
    const configPath = await createTempDir('hokusai-claude-reporting-');
    await expect(getReportingStatus({ configPath, env: {} })).resolves.toEqual({
      ok: true,
      value: {
        enabled: false,
        source: 'default',
      },
    });

    await expect(
      setReportingEnabled({ enabled: true }, { configPath }),
    ).resolves.toEqual({
      ok: true,
      value: {
        enabled: true,
      },
    });

    const store = new FilePluginConfigStore(
      path.join(configPath, 'hokusai-plugin-config.json'),
    );
    const persisted = await store.read();
    expect(persisted).toEqual({
      outcomeSubmissionEnabled: true,
    });
    expect('apiKey' in (persisted ?? {})).toBe(false);

    await expect(getReportingStatus({ configPath, env: {} })).resolves.toEqual({
      ok: true,
      value: {
        enabled: true,
        source: 'stored',
      },
    });

    await expect(
      getReportingStatus({
        configPath,
        env: {
          HOKUSAI_OUTCOME_OPT_IN: 'false',
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        enabled: false,
        source: 'env',
      },
    });
  });

  it('resolves retention policy overrides and warns on invalid values', async () => {
    expect(
      resolveRetentionPolicy({
        HOKUSAI_RETENTION_DAYS: '30',
      }).maxAgeMs,
    ).toBe(30 * 24 * 60 * 60 * 1000);

    const configPath = await createTempDir('hokusai-claude-retention-invalid-');
    const store = new FsLocalStore(configPath);
    await store.putCorrelation({
      correlationId: 'corr-retention',
      packetHash: 'task-retention',
      createdAt: 1,
    });

    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      const result = await listRoutingDecisions(
        {},
        {
          configPath,
          env: {
            HOKUSAI_RETENTION_DAYS: 'invalid',
          },
          clock: () => new Date(1),
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.warnings).toEqual([
          'Ignoring invalid HOKUSAI_RETENTION_DAYS value: invalid. Using default 7 day retention.',
        ]);
      }
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderrChunks.join('')).toContain(
      'Ignoring invalid HOKUSAI_RETENTION_DAYS',
    );
  });
});

describe('clearClaudeCodeLocalState', () => {
  it('clears persisted state and leaves doctor in setup-needed state', async () => {
    const configPath = await createTempDir('hokusai-claude-clear-');
    await writeFile(
      path.join(configPath, 'state.json'),
      '{"key":"value"}',
      'utf8',
    );
    await mkdir(path.join(configPath, 'correlations'), { recursive: true });
    await writeFile(
      path.join(configPath, 'correlations', 'task_1.json'),
      '{"correlationId":"task_1","packetHash":"task-1","createdAt":1}',
      'utf8',
    );

    await expect(clearClaudeCodeLocalState({ configPath })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(runDoctor({ configPath })).toMatchObject({
      configPresent: false,
      needsSetup: true,
    });
  });

  it('is idempotent when no local state exists', async () => {
    const configPath = path.join(os.tmpdir(), `missing-clear-${Date.now()}`);
    await rm(configPath, { recursive: true, force: true });

    await expect(clearClaudeCodeLocalState({ configPath })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
  });
});

describe('displayTaskRecommendation', () => {
  it('formats model, provider, and reason for display', () => {
    const result = displayTaskRecommendation({
      model: {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        capabilities: ['reasoning'],
      },
      reason: 'Best balanced Claude model.',
      alternatives: [
        {
          model: {
            id: 'claude-opus-4-8',
            provider: 'anthropic',
            capabilities: ['reasoning'],
          },
          reason: 'More headroom for hard problems.',
          confidence: 0.64,
        },
      ],
      confidence: 0.82,
    });

    expect(result.lines.join('\n')).toContain(
      'Recommended model: claude-sonnet-4-6',
    );
    expect(result.lines.join('\n')).toContain('Provider: anthropic');
    expect(result.lines.join('\n')).toContain(
      'Reason: Best balanced Claude model.',
    );
    expect(result.lines.join('\n')).toContain('Confidence: 82%');
    expect(result.lines.join('\n')).toContain('Alternatives: claude-opus-4-8');
  });
});

describe('route/report smoke path', () => {
  it('routes and reports successfully from a fresh config dir', async () => {
    const configPath = await createTempDir('hokusai-claude-smoke-');
    await rm(configPath, { recursive: true, force: true });

    const { calls, transport } = createPathTransport({
      '/api/v1/models/30/predict': createResponse(200, {
        routeId: 'route-1',
        taskId: 'task-smoke',
        status: 'accepted',
      }),
      '/api/v1/models/30/contributions': createResponse(200, {
        accepted: true,
        submissionId: 'sub-smoke',
        rowsAccepted: 1,
      }),
      '/v1/outcomes': createResponse(200, {
        taskId: 'task-smoke',
        status: 'accepted',
      }),
      '/v1/signals': createResponse(204),
    });
    const client = new HokusaiClient({
      apiKey: 'k_test',
      transport,
    });

    const routed = await routeTask(
      {
        taskId: 'task-smoke',
        taskText: 'Investigate alice@example.com failures and propose a fix.',
        modelId: 'claude-sonnet-4-6',
      },
      {
        apiClient: client,
        configPath,
        registry: new InMemoryModelRegistry([
          {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
            default: true,
          },
          {
            id: 'claude-opus-4-8',
            provider: 'anthropic',
            family: 'claude',
            capabilities: ['reasoning', 'streaming', 'tool-use'],
          },
        ]),
      },
    );

    expect(routed.ok).toBe(true);
    if (!routed.ok) {
      return;
    }
    const requestBody = (
      calls[0]?.init.body ? JSON.parse(calls[0].init.body) : {}
    ) as { inputs?: Record<string, unknown> };
    expect(requestBody).toMatchObject({
      inputs: {
        routing: {
          available_models: ['claude-sonnet-4-6', 'claude-opus-4-8'],
        },
        task: {
          task_type: 'bugfix',
        },
      },
    });

    const reported = await reportTaskOutcome(
      {
        taskId: 'task-smoke',
        ...claudeCodeSuccessOutcomeFixture,
        // Correlate the report to the routing decision persisted above so the
        // canonical contribution row can be built from its route context.
        correlationId: routed.value.correlationId,
      },
      {
        apiClient: client,
        configPath,
      },
    );

    expect(reported).toMatchObject({
      ok: true,
      value: {
        submitted: true,
        contributionRow: {
          schema_version: 'harness_outcome_row/v1',
          inference_log_id: 'route-1',
        },
      },
    });
    expect(callsForPath(calls, '/api/v1/models/30/predict')).toHaveLength(1);
    expect(callsForPath(calls, '/api/v1/models/30/contributions')).toHaveLength(
      1,
    );
    expect(callsForPath(calls, '/v1/outcomes')).toHaveLength(1);
    expect(runDoctor({ configPath, apiClient: client })).toMatchObject({
      configPresent: true,
      needsSetup: false,
      connectivity: 'configured',
    });
  });
});
