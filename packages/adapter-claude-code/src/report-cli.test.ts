import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('fills the model from --use-latest when --recommended-model is omitted', async () => {
    // Regression: with --use-latest and no explicit model flags, the payload
    // builder fell back to an empty recommendedModel/actualModel and failed
    // validation, even though the stored routing decision carried the model.
    const result = await runReportCli(
      [
        '--preview',
        '--use-latest',
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
        findLatestRoutingDecisionImpl: () =>
          Promise.resolve({
            correlationId: 'route-latest',
            taskId: 'task-latest',
            createdAt: '2026-07-08T00:00:00.000Z',
            recommendedModelId: 'claude-sonnet-4-6',
          }),
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
        findLatestRoutingDecisionImpl: () => Promise.resolve(undefined),
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
            inferenceLogId: '00000000-0000-4000-8000-0000000000d1',
            status: 'recorded' as const,
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
        '--inference-log-id',
        '00000000-0000-4000-8000-0000000000d1',
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
    expect(result.stdout).toContain('Server status: recorded');
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

  it('uses the latest local routing decision when --use-latest is passed', async () => {
    const findLatestRoutingDecisionImpl = vi.fn(() =>
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
        findLatestRoutingDecisionImpl,
        previewReportOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(findLatestRoutingDecisionImpl).toHaveBeenCalledOnce();
    expect(previewReportOutcomeImpl).toHaveBeenCalledOnce();
    expect(result.stdout).toContain('route-latest');
  });

  it('returns a clear error when --use-latest finds no record on disk', async () => {
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
        findLatestRoutingDecisionImpl: () => Promise.resolve(undefined),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
    expect(result.stderr).toContain('--correlation-id');
  });

  it('surfaces a clear error when reading local routing decisions fails', async () => {
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
        findLatestRoutingDecisionImpl: () =>
          Promise.reject(new Error('EACCES: permission denied')),
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR);
    expect(result.stderr).toContain('Could not read local routing correlations');
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

  it('refuses to submit without an inference log id', async () => {
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
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR);
    expect(result.stderr).toContain('inference log id');
  });

  it('fills the inference log id from --use-latest for submission', async () => {
    const latestInferenceLogId = '00000000-0000-4000-8000-0000000000f1';
    let capturedInput: { inferenceLogId?: string } | undefined;
    const reportTaskOutcomeImpl = vi.fn((input: { inferenceLogId?: string }) => {
      capturedInput = input;
      return Promise.resolve({
        ok: true as const,
        value: {
          report: {
            schemaVersion: '1' as const,
            correlationId: 'route-latest',
            inferenceLogId: latestInferenceLogId,
            recommendedModel: 'claude-sonnet-4-6',
            actualModel: 'claude-sonnet-4-6',
            recommendationAccepted: true,
            completionStatus: 'succeeded' as const,
            latencyBucket: 'medium' as const,
            costBucket: 'medium' as const,
            tokenBucket: 'medium' as const,
          },
          response: {
            inferenceLogId: latestInferenceLogId,
            status: 'recorded' as const,
          },
          submitted: true,
        },
      });
    });

    const result = await runReportCli(
      ['--send', '--use-latest', '--accepted', '--status', 'succeeded'],
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
        findLatestRoutingDecisionImpl: () =>
          Promise.resolve({
            correlationId: 'route-latest',
            taskId: 'task-latest',
            createdAt: '2026-07-08T00:00:00.000Z',
            recommendedModelId: 'claude-sonnet-4-6',
            inferenceLogId: latestInferenceLogId,
          }),
        reportTaskOutcomeImpl,
        readStdin: () => Promise.resolve(''),
      },
    );

    expect(result.exitCode).toBe(REPORT_CLI_EXIT_CODES.OK);
    expect(reportTaskOutcomeImpl).toHaveBeenCalledOnce();
    expect(capturedInput?.inferenceLogId).toBe(latestInferenceLogId);
  });
});
