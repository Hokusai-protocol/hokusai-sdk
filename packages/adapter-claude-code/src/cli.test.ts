import { describe, expect, it } from 'vitest';
import {
  CLI_EXIT_CODES,
  runCli,
} from './cli.js';

describe('runCli', () => {
  it('returns empty-task guidance', async () => {
    const result = await runCli([], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiKey: 'hk_live_test',
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
      readStdin: () => Promise.resolve('   '),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.EMPTY_TASK);
    expect(result.stderr).toContain('Provide a task description');
  });

  it('requires an API key before routing', async () => {
    const result = await runCli(['--task', 'refactor auth'], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.AUTH_REQUIRED);
    expect(result.stderr).toContain('HOKUSAI_API_KEY');
  });

  it('requires explicit routing consent before routing', async () => {
    const result = await runCli(['--task', 'refactor auth'], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiKey: 'hk_live_test',
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: false,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.CONSENT_REQUIRED);
    expect(result.stderr).toContain('HOKUSAI_ROUTING_CONSENT=true');
  });

  it('prints a JSON recommendation payload on success', async () => {
    const result = await runCli(['--json', '--task', 'refactor auth'], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiKey: 'hk_live_test',
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
      routeTaskImpl: () =>
        Promise.resolve({
          ok: true,
          value: {
            recommendation: {
              model: {
                id: 'claude-sonnet-4-6',
                provider: 'anthropic',
                capabilities: ['reasoning'],
              },
              reason: 'Balanced for this task.',
              confidence: 0.88,
              alternatives: [
                {
                  model: {
                    id: 'claude-opus-4-8',
                    provider: 'anthropic',
                    capabilities: ['reasoning'],
                  },
                  reason: 'More depth if needed.',
                  confidence: 0.61,
                },
              ],
            },
            payload: {} as never,
            preview: {} as never,
            correlationId: 'corr-1',
            routingDecisionId: 'corr-1',
            handoff: {
              mechanism: 'manual',
              slashCommand: '/model claude-sonnet-4-6',
              copyableCommand: '/model claude-sonnet-4-6',
              instructions: [],
            },
            route: {
              routeId: 'route-1',
              taskId: 'task-1',
              status: 'accepted',
              requestId: 'req-1',
            },
          },
        }),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.OK);
    expect(JSON.parse(result.stdout)).toEqual({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      reason: 'Balanced for this task.',
      confidence: 0.88,
      alternatives: [
        {
          model: 'claude-opus-4-8',
          provider: 'anthropic',
          reason: 'More depth if needed.',
          confidence: 0.61,
        },
      ],
      correlationId: 'corr-1',
      routingDecisionId: 'corr-1',
      handoff: {
        mechanism: 'manual',
        slashCommand: '/model claude-sonnet-4-6',
        copyableCommand: '/model claude-sonnet-4-6',
        instructions: [],
      },
      requestId: 'req-1',
      routeId: 'route-1',
    });
  });

  it('prints correlation and handoff guidance in plaintext output', async () => {
    const result = await runCli(['--task', 'refactor auth'], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiKey: 'hk_live_test',
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
      routeTaskImpl: () =>
        Promise.resolve({
          ok: true,
          value: {
            recommendation: {
              model: {
                id: 'claude-opus-4-8',
                provider: 'anthropic',
                capabilities: ['reasoning'],
              },
              reason: 'Deeper reasoning needed.',
            },
            payload: {} as never,
            preview: {} as never,
            correlationId: 'corr-2',
            routingDecisionId: 'corr-2',
            handoff: {
              mechanism: 'manual',
              slashCommand: '/model claude-opus-4-8',
              copyableCommand: '/model claude-opus-4-8',
              instructions: [
                'Run /model claude-opus-4-8 in Claude Code to switch to the recommended model.',
              ],
            },
          },
        }),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.OK);
    expect(result.stdout).toContain('Correlation ID: corr-2');
    expect(result.stdout).toContain('Switch in Claude Code: /model claude-opus-4-8');
  });

  it('records a declined recommendation', async () => {
    const result = await runCli(
      ['--decline', '--correlation-id', 'corr-3', '--reason', 'prefer sonnet'],
      {},
      {
        loadConfig: () =>
          Promise.resolve({
            apiBaseUrl: 'https://api.hokusai.app',
            routingConsentEnabled: true,
            outcomeSubmissionEnabled: false,
            modelAllowlist: ['claude-sonnet-4-6'],
          }),
        declineRecommendationImpl: () =>
          Promise.resolve({
            ok: true,
            value: {
              correlationId: 'corr-3',
              status: 'declined',
            },
          }),
      },
    );

    expect(result.exitCode).toBe(CLI_EXIT_CODES.OK);
    expect(result.stdout).toContain('corr-3');
  });

  it('maps network failures to a retryable error', async () => {
    const result = await runCli(['--task', 'refactor auth'], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiKey: 'hk_live_test',
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
      routeTaskImpl: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'NETWORK_ERROR',
            message: 'boom',
          },
        }),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.NETWORK_ERROR);
    expect(result.stderr).toContain('Could not reach Hokusai');
  });

  it('maps unsupported model recommendations to fallback guidance', async () => {
    const result = await runCli(['--task', 'refactor auth'], {}, {
      loadConfig: () =>
        Promise.resolve({
          apiKey: 'hk_live_test',
          apiBaseUrl: 'https://api.hokusai.app',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        }),
      routeTaskImpl: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'PROVIDER_NOT_ALLOWED',
            message: 'Model gpt-5-codex uses provider openai, which is not supported by this harness.',
            details: {
              suggestions: ['claude-sonnet-4-6'],
            },
          },
        }),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.UNSUPPORTED_MODEL);
    expect(result.stderr).toContain('gpt-5-codex');
    expect(result.stderr).toContain('claude-sonnet-4-6');
  });
});
