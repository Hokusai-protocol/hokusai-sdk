import { describe, expect, it, vi } from 'vitest';
import {
  REPORT_CLI_EXIT_CODES,
  runReportCli,
} from './report-cli.js';

describe('runReportCli', () => {
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
            apiBaseUrl: 'https://api.hokusai.app',
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
            apiBaseUrl: 'https://api.hokusai.app',
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
            apiBaseUrl: 'https://api.hokusai.app',
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
            apiBaseUrl: 'https://api.hokusai.app',
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
            apiBaseUrl: 'https://api.hokusai.app',
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
            apiBaseUrl: 'https://api.hokusai.app',
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
              apiBaseUrl: 'https://api.hokusai.app',
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
