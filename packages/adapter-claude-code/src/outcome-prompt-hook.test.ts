import { describe, expect, it } from 'vitest';
import { runOutcomePromptHookCli } from './outcome-prompt-hook.js';

describe('runOutcomePromptHookCli', () => {
  const latestRoute = {
    correlationId: 'task-1:2026-07-07T12:00:00.000Z',
    taskId: 'task-1',
    createdAt: '2026-07-07T12:00:00.000Z',
    recommendedModelId: 'claude-sonnet-4-6',
  };

  it('prints a report prompt for successful post-run events', async () => {
    const result = await runOutcomePromptHookCli(
      [],
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
        findLatestRoutingDecisionImpl: () => Promise.resolve(latestRoute),
        readStdin: () =>
          Promise.resolve(
            JSON.stringify({
              status: 'success',
              transcript: 'All tests passed.',
            }),
          ),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'Looks like this task succeeded - contribute this outcome to improve routing?',
    );
    expect(result.stdout).toContain(
      '/hokusai:report --use-latest --recommended-model claude-sonnet-4-6 --actual-model claude-sonnet-4-6',
    );
    expect(result.stdout).toContain('--test-status passed');
  });

  it('prints opt-in remediation instead of a report command without outcome consent', async () => {
    const result = await runOutcomePromptHookCli(
      [],
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
        findLatestRoutingDecisionImpl: () => Promise.resolve(latestRoute),
        readStdin: () => Promise.resolve(JSON.stringify({ status: 'success' })),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('HOKUSAI_OUTCOME_OPT_IN=true');
    expect(result.stdout).not.toContain('/hokusai:report');
  });

  it('stays quiet when no success signal is present', async () => {
    const result = await runOutcomePromptHookCli(
      [],
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
        findLatestRoutingDecisionImpl: () => Promise.resolve(latestRoute),
        readStdin: () => Promise.resolve(JSON.stringify({ status: 'failed' })),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  });
});
