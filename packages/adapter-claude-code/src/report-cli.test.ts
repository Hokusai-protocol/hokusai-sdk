import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPORT_CLI_EXIT_CODES,
  runReportCli,
} from './report-cli.js';

describe('runReportCli', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('honors stored consent from hokusai-privacy reporting on (no env opt-in, no --config-path)', async () => {
    // Regression: report-cli previously loaded config without a store unless
    // --config-path was passed, so `hokusai-privacy reporting on` (which writes
    // outcomeSubmissionEnabled to the default plugin config file) was ignored
    // and only HOKUSAI_OUTCOME_OPT_IN was honored.
    const configDir = await mkdtemp(join(tmpdir(), 'hokusai-report-cli-'));
    cleanups.push(() => rm(configDir, { recursive: true, force: true }));
    await writeFile(
      join(configDir, 'hokusai-plugin-config.json'),
      JSON.stringify({ outcomeSubmissionEnabled: true }),
      'utf8',
    );
    vi.stubEnv('HOKUSAI_CONFIG_DIR', configDir);

    const result = await runReportCli(
      [
        '--preview',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      // No HOKUSAI_OUTCOME_OPT_IN in env — consent must come from the file.
      { HOKUSAI_CONFIG_DIR: configDir },
      { readStdin: () => Promise.resolve('') },
    );

    expect(result.exitCode).not.toBe(REPORT_CLI_EXIT_CODES.CONSENT_REQUIRED);
    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
  });

  it('fills the model from the route stored for --task-id when --recommended-model is omitted', async () => {
    const result = await runReportCli(
      [
        '--preview',
        '--task-id',
        'task-latest',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        findRoutingDecisionImpl: ({ taskId }) =>
          Promise.resolve(
            taskId === 'task-latest'
              ? {
                  correlationId: 'route-latest',
                  taskId: 'task-latest',
                  createdAt: '2026-07-08T00:00:00.000Z',
                  recommendedModelId: 'claude-sonnet-4-6',
                }
              : undefined,
          ),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(result.stdout).toContain('claude-sonnet-4-6');
  });

  it('requires an API key before submission', async () => {
    const result = await runReportCli(
      [
        '--send',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.AUTH_REQUIRED);
    expect(result.stderr).toContain('HOKUSAI_API_KEY');
  });

  it('requires outcome consent even for preview', async () => {
    const result = await runReportCli(
      [
        '--preview',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: false,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.CONSENT_REQUIRED);
    expect(result.stderr).toContain('HOKUSAI_OUTCOME_OPT_IN=true');
  });

  it('fails clearly when no correlation id is available', async () => {
    const result = await runReportCli(
      [
        '--preview',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        findRoutingDecisionImpl: () => Promise.resolve(undefined),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
    expect(result.stderr).toContain('Provide --correlation-id');
  });

  it('prints a redacted JSON preview without calling the network', async () => {
    const previewReportOutcomeImpl = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          report: {
            schemaVersion: '1' as const,
            correlationId: 'route-1',
            recommendedModel: 'claude-sonnet-4-6',
            actualModel: 'claude-opus-4-8',
            recommendationAccepted: false,
            completionStatus: 'failed' as const,
            latencyBucket: 'medium' as const,
            costBucket: 'medium' as const,
            tokenBucket: 'medium' as const,
            notes: 'Email <redacted:email> for follow-up.',
          },
          preview: {
            lines: ['Outcome report preview:', 'Notes: Email <redacted:email> for follow-up.'],
            payload: {
              schemaVersion: '1' as const,
              correlationId: 'route-1',
              recommendedModel: 'claude-sonnet-4-6',
              actualModel: 'claude-opus-4-8',
              recommendationAccepted: false,
              completionStatus: 'failed' as const,
              latencyBucket: 'medium' as const,
              costBucket: 'medium' as const,
              tokenBucket: 'medium' as const,
              notes: 'Email <redacted:email> for follow-up.',
            },
          },
        },
      }),
    );

    const result = await runReportCli(
      [
        '--preview',
        '--json',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-opus-4-8',
        '--rejected',
        '--status',
        'failed',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        previewReportOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(previewReportOutcomeImpl).toHaveBeenCalledOnce();
    const payload = JSON.parse(result.stdout);
    expect(payload.mode).toBe('preview');
    expect(payload.preview.payload.notes).toContain('<redacted:email>');
  });

  it('submits an outcome once when --send is used', async () => {
    const reportTaskOutcomeImpl = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          report: {
            schemaVersion: '1' as const,
            correlationId: 'route-1',
            recommendedModel: 'claude-sonnet-4-6',
            actualModel: 'claude-sonnet-4-6',
            recommendationAccepted: true,
            completionStatus: 'succeeded' as const,
            latencyBucket: 'medium' as const,
            costBucket: 'medium' as const,
            tokenBucket: 'medium' as const,
          },
          response: {
            taskId: 'task-1',
            status: 'accepted' as const,
          },
          submitted: true,
        },
      }),
    );

    const result = await runReportCli(
      [
        '--send',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        reportTaskOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(reportTaskOutcomeImpl).toHaveBeenCalledOnce();
    expect(result.stdout).toContain('Outcome report submitted.');
    expect(result.stdout).toContain('Server status: accepted');
  });

  it('derives actual cost from token counts and the resolved model', async () => {
    const previewReportOutcomeImpl = vi.fn(
      (input: { actualCostUsd?: number; actualModel: string }) =>
        Promise.resolve({
          ok: true as const,
          value: {
            report: {
              schemaVersion: '1' as const,
              correlationId: 'route-1',
              recommendedModel: 'claude-opus-4-8',
              actualModel: input.actualModel,
              recommendationAccepted: true,
              completionStatus: 'succeeded' as const,
              latencyBucket: 'medium' as const,
              costBucket: 'medium' as const,
              tokenBucket: 'medium' as const,
            },
            preview: { lines: [], payload: {} as never },
          },
        }),
    );

    const result = await runReportCli(
      [
        '--preview',
        '--json',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-opus-4-8',
        '--actual-model',
        'claude-opus-4-8',
        '--accepted',
        '--status',
        'succeeded',
        '--input-tokens',
        '1000000',
        '--output-tokens',
        '1000000',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-opus-4-8'],
          }),
        previewReportOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    // 1M input @ $5/1M + 1M output @ $25/1M = 30
    expect(previewReportOutcomeImpl).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostUsd: 30 }),
      expect.anything(),
    );
  });

  it('maps invalid status values to outcome validation errors', async () => {
    const result = await runReportCli(
      [
        '--preview',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'nonsense',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
    expect(result.stderr).toContain('completionStatus');
  });

  it('treats --dry-run as preview even when --send is also passed', async () => {
    const reportTaskOutcomeImpl = vi.fn(() => Promise.reject(new Error('should not be called')));
    const previewReportOutcomeImpl = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          report: {
            schemaVersion: '1' as const,
            correlationId: 'route-1',
            recommendedModel: 'claude-sonnet-4-6',
            actualModel: 'claude-sonnet-4-6',
            recommendationAccepted: true,
            completionStatus: 'succeeded' as const,
            latencyBucket: 'medium' as const,
            costBucket: 'medium' as const,
            tokenBucket: 'medium' as const,
          },
          preview: {
            lines: ['Outcome report preview.'],
            payload: {
              schemaVersion: '1' as const,
              correlationId: 'route-1',
              recommendedModel: 'claude-sonnet-4-6',
              actualModel: 'claude-sonnet-4-6',
              recommendationAccepted: true,
              completionStatus: 'succeeded' as const,
              latencyBucket: 'medium' as const,
              costBucket: 'medium' as const,
              tokenBucket: 'medium' as const,
            },
          },
        },
      }),
    );

    const result = await runReportCli(
      [
        '--dry-run',
        '--send',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        previewReportOutcomeImpl,
        reportTaskOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(reportTaskOutcomeImpl).not.toHaveBeenCalled();
    expect(previewReportOutcomeImpl).toHaveBeenCalledOnce();
  });

  it('prints field errors only once in non-JSON mode', async () => {
    const previewReportOutcomeImpl = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: 'OUTCOME_VALIDATION_FAILED' as const,
          message: 'Outcome report validation failed.',
          details: {
            fieldErrors: ['someUniqueField: must be present'],
          },
        },
      }),
    );

    const result = await runReportCli(
      [
        '--preview',
        '--correlation-id',
        'route-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        previewReportOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
    const occurrences = result.stderr.split('someUniqueField').length - 1;
    expect(occurrences).toBe(1);
  });

  it('resolves the routing decision stored for --task-id', async () => {
    const findRoutingDecisionImpl = vi.fn(() =>
      Promise.resolve({
        correlationId: 'route-latest',
        taskId: 'task-latest',
        createdAt: '2026-06-08T00:00:00.000Z',
      }),
    );
    const previewReportOutcomeImpl = vi.fn((input: { correlationId: string; taskId: string }) =>
      Promise.resolve({
        ok: true as const,
        value: {
          report: {
            schemaVersion: '1' as const,
            correlationId: input.correlationId,
            recommendedModel: 'claude-sonnet-4-6',
            actualModel: 'claude-sonnet-4-6',
            recommendationAccepted: true,
            completionStatus: 'succeeded' as const,
            latencyBucket: 'medium' as const,
            costBucket: 'medium' as const,
            tokenBucket: 'medium' as const,
          },
          preview: {
            lines: [`Outcome report preview for ${input.correlationId}.`],
            payload: {
              schemaVersion: '1' as const,
              correlationId: input.correlationId,
              recommendedModel: 'claude-sonnet-4-6',
              actualModel: 'claude-sonnet-4-6',
              recommendationAccepted: true,
              completionStatus: 'succeeded' as const,
              latencyBucket: 'medium' as const,
              costBucket: 'medium' as const,
              tokenBucket: 'medium' as const,
            },
          },
        },
      }),
    );

    const result = await runReportCli(
      [
        '--preview',
        '--task-id',
        'task-latest',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        findRoutingDecisionImpl,
        previewReportOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(findRoutingDecisionImpl).toHaveBeenCalledOnce();
    expect(findRoutingDecisionImpl).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-latest' }),
    );
    expect(previewReportOutcomeImpl).toHaveBeenCalledOnce();
    expect(result.stdout).toContain('route-latest');
  });

  it('rejects the removed --use-latest flag with a pointer to --task-id', async () => {
    const result = await runReportCli(
      [
        '--preview',
        '--use-latest',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
    expect(result.stderr).toContain('--use-latest was removed');
    expect(result.stderr).toContain('--task-id');
  });

  it('surfaces a clear error when reading local routing decisions fails', async () => {
    const result = await runReportCli(
      [
        '--preview',
        '--task-id',
        'task-1',
        '--recommended-model',
        'claude-sonnet-4-6',
        '--actual-model',
        'claude-sonnet-4-6',
        '--accepted',
        '--status',
        'succeeded',
      ],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiKey: 'hk_live_test',
            apiBaseUrl: 'https://api.hokus.ai',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: true,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        findRoutingDecisionImpl: () =>
          Promise.reject(new Error('EACCES: permission denied')),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR);
    expect(result.stderr).toContain('Could not read local routing correlations');
  });

  describe('2026-10-30 incident (HOK-3364)', () => {
    // An old route for another task (July), whose route context points cost
    // resolution at a transcript directory, plus the current session's
    // transcript there, far more expensive than the task. The old CLI attached
    // both to an unrelated task's outcome.
    async function seedIncident(): Promise<{ configDir: string; claudeDir: string }> {
      const configDir = await mkdtemp(join(tmpdir(), 'hokusai-incident-config-'));
      const claudeDir = await mkdtemp(join(tmpdir(), 'hokusai-incident-claude-'));
      cleanups.push(() => rm(configDir, { recursive: true, force: true }));
      cleanups.push(() => rm(claudeDir, { recursive: true, force: true }));
      await writeFile(
        join(configDir, 'hokusai-plugin-config.json'),
        JSON.stringify({ outcomeSubmissionEnabled: true }),
        'utf8',
      );
      await mkdir(join(configDir, 'correlations'), { recursive: true });
      await writeFile(
        join(configDir, 'correlations', 'route-july.json'),
        JSON.stringify({
          correlationId: 'route-july',
          packetHash: 'HOK-1001',
          createdAt: Date.parse('2026-07-13T10:00:00.000Z'),
          metadata: {
            taskId: 'HOK-1001',
            originalCorrelationId: 'route-july',
            inferenceLogId: 'inference-july',
            recommendedModelId: 'claude-sonnet-4-6',
            routeContext: JSON.stringify({
              taskDescriptor: { task_type: 'feature' },
              allowedModels: ['claude-sonnet-4-6', 'claude-opus-4-8'],
              budgetUsd: 5,
              baselineAt: '2026-07-13T10:00:00.000Z',
              projectDirKey: '-repo',
            }),
          },
        }),
        'utf8',
      );
      await mkdir(join(claudeDir, 'projects', '-repo'), { recursive: true });
      await writeFile(
        join(claudeDir, 'projects', '-repo', 'current-session.jsonl'),
        JSON.stringify({
          timestamp: '2026-10-30T12:00:00.000Z',
          message: { usage: { input_tokens: 2_000_000, output_tokens: 2_000_000 } },
        }),
        'utf8',
      );
      return { configDir, claudeDir };
    }

    it('attaches neither the July route nor the current-session cost to an unrouted task', async () => {
      const { configDir, claudeDir } = await seedIncident();
      vi.stubEnv('HOKUSAI_CONFIG_DIR', configDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir);

      const result = await runReportCli(
        ['--preview', '--json', '--task-id', 'HOK-3315', '--actual-model', 'claude-opus-4-8', '--status', 'succeeded'],
        {},
        { readStdin: () => Promise.resolve('') },
      );

      expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
      expect(result.stderr).toContain('No stored route for task HOK-3315');
      const output = result.stdout + result.stderr;
      expect(output).not.toContain('route-july');
      expect(output).not.toContain('inference-july');
    });

    it('reports plain telemetry with no join key or cost when a correlation id is given explicitly', async () => {
      const { configDir, claudeDir } = await seedIncident();
      vi.stubEnv('HOKUSAI_CONFIG_DIR', configDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir);

      const result = await runReportCli(
        [
          '--preview',
          '--json',
          '--correlation-id',
          'HOK-3315-outcome',
          '--task-id',
          'HOK-3315',
          '--recommended-model',
          'claude-opus-4-8',
          '--actual-model',
          'claude-opus-4-8',
          '--accepted',
          '--status',
          'succeeded',
        ],
        {},
        { readStdin: () => Promise.resolve('') },
      );

      expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
      expect(result.stdout).not.toContain('inference-july');
      expect(result.stdout).not.toContain('route-july');
      expect(result.stdout).not.toContain('inference_log_id');
      expect(result.stdout).not.toContain('actual_cost_usd');
    });

    it("rejects a correlation id that belongs to another task's route", async () => {
      const { configDir, claudeDir } = await seedIncident();
      vi.stubEnv('HOKUSAI_CONFIG_DIR', configDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir);

      const result = await runReportCli(
        ['--preview', '--correlation-id', 'route-july', '--task-id', 'HOK-3315', '--actual-model', 'claude-opus-4-8', '--status', 'succeeded'],
        {},
        { readStdin: () => Promise.resolve('') },
      );

      expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
      expect(result.stderr).toContain('belongs to task HOK-1001, not HOK-3315');
    });
  });

  it.each(['failed', 'abandoned', 'overridden'])(
    'builds a valid preview for %s outcomes',
    async (status) => {
      const result = await runReportCli(
        [
          '--preview',
          '--correlation-id',
          'route-1',
          '--recommended-model',
          'claude-sonnet-4-6',
          '--actual-model',
          'claude-opus-4-8',
          '--rejected',
          '--status',
          status,
        ],
        {},
        {
          loadConfig: () =>
            Promise.resolve({
              apiKey: 'hk_live_test',
              apiBaseUrl: 'https://api.hokus.ai',
              routingConsentEnabled: true,
              outcomeSubmissionEnabled: true,
              modelAllowlist: ['claude-sonnet-4-6'],
            }),
          readStdin: () => Promise.resolve(''),
        },
      );

      expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
      expect(result.stdout).toContain(`Completion status: ${status}`);
    },
  );
});
