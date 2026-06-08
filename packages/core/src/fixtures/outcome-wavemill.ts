import type { OutcomeReportInput } from '../outcome.js';

export const wavemillSuccessOutcomeFixture: OutcomeReportInput = {
  correlationId: 'route-wavemill-001',
  recommendedModel: 'gpt-5-codex',
  actualModel: 'gpt-5-codex',
  recommendationAccepted: true,
  completionStatus: 'succeeded',
  userRating: 5,
  latencyBucket: 'medium',
  costBucket: 'high',
  tokenBucket: 'high',
  build: {
    status: 'passed',
  },
  test: {
    status: 'passed',
    failures: 0,
  },
  extensions: {
    version: '2026-06',
    data: {
      harness: 'wavemill',
      spendUsdBucket: '0.50-1.00',
      wallClockMinutes: 18,
    },
  },
};

export const wavemillOverriddenOutcomeFixture: OutcomeReportInput = {
  correlationId: 'route-wavemill-002',
  recommendedModel: 'claude-3-7-sonnet',
  actualModel: 'gpt-5-codex',
  recommendationAccepted: false,
  completionStatus: 'overridden',
  latencyBucket: 'high',
  costBucket: 'medium',
  tokenBucket: 'high',
  build: {
    status: 'passed',
  },
  test: {
    status: 'failed',
    failures: 3,
  },
  notes: 'Overrode the route after checking repo-local diagnostics.',
};
