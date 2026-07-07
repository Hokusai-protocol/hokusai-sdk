import { describe, expect, it } from 'vitest';
import {
  buildOutcomeContributionPrompt,
  detectOutcomeCompletionSignal,
} from './outcome-prompt.js';

describe('detectOutcomeCompletionSignal', () => {
  it('detects likely successful completion events', () => {
    expect(
      detectOutcomeCompletionSignal({
        status: 'success',
        transcript: 'All tests passed.',
      }),
    ).toEqual({
      shouldPrompt: true,
      signals: ['task_completed', 'tests_passed'],
    });

    expect(
      detectOutcomeCompletionSignal({
        pullRequest: { merged: true },
        issue: { status: 'closed' },
      }),
    ).toEqual({
      shouldPrompt: true,
      signals: ['pr_merged', 'issue_closed'],
    });
  });

  it('does not prompt on incomplete or failed events', () => {
    expect(
      detectOutcomeCompletionSignal({
        status: 'failed',
        transcript: 'Tests failed.',
      }),
    ).toEqual({
      shouldPrompt: false,
      signals: [],
    });
  });
});

describe('buildOutcomeContributionPrompt', () => {
  const latestRoute = {
    correlationId: 'task-1:2026-07-07T12:00:00.000Z',
    taskId: 'task-1',
    createdAt: '2026-07-07T12:00:00.000Z',
    recommendedModelId: 'gpt-5-codex',
  };

  it('builds a one-click report command from the latest route', () => {
    const prompt = buildOutcomeContributionPrompt({
      event: { status: 'success', transcript: 'All tests passed.' },
      latestRoute,
      outcomeOptIn: true,
      reportCommand: '$hokusai-report',
    });

    expect(prompt).toMatchObject({
      shouldPrompt: true,
      status: 'ready',
      reportCommand:
        '$hokusai-report --use-latest --recommended-model gpt-5-codex --actual-model gpt-5-codex --accepted --status succeeded --latency-bucket medium --cost-bucket medium --token-bucket medium --test-status passed',
    });
  });

  it('does not build a send prompt without outcome opt-in', () => {
    const prompt = buildOutcomeContributionPrompt({
      event: { status: 'success' },
      latestRoute,
      outcomeOptIn: false,
      reportCommand: '$hokusai-report',
    });

    expect(prompt).toMatchObject({
      shouldPrompt: true,
      status: 'needs_outcome_opt_in',
      remediation: expect.stringContaining('HOKUSAI_OUTCOME_OPT_IN=true'),
    });
    expect(prompt).not.toHaveProperty('reportCommand');
  });

  it('does not prompt without a successful completion signal', () => {
    const prompt = buildOutcomeContributionPrompt({
      event: { status: 'running' },
      latestRoute,
      outcomeOptIn: true,
      reportCommand: '$hokusai-report',
    });

    expect(prompt).toMatchObject({
      shouldPrompt: false,
      status: 'no_completion_signal',
    });
  });
});
