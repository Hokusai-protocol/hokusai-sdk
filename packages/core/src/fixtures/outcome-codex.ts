import type { OutcomeReportInput } from '../outcome.js';

export const codexSuccessOutcomeFixture: OutcomeReportInput = {
  correlationId: 'route-codex-001',
  recommendedModel: 'gpt-5-codex',
  actualModel: 'gpt-5-codex',
  recommendationAccepted: true,
  completionStatus: 'succeeded',
  userRating: 5,
  latencyBucket: 'medium',
  costBucket: 'low',
  tokenBucket: 'high',
  build: {
    status: 'passed',
  },
  test: {
    status: 'passed',
  },
  extensions: {
    version: '1',
    data: {
      harness: 'codex',
      toolCalls: 12,
      editedFiles: 5,
    },
  },
};

export const codexAbandonedOutcomeFixture: OutcomeReportInput = {
  correlationId: 'route-codex-002',
  recommendedModel: 'gpt-5-codex',
  actualModel: 'claude-3-7-sonnet',
  recommendationAccepted: false,
  completionStatus: 'abandoned',
  latencyBucket: 'low',
  costBucket: 'low',
  tokenBucket: 'medium',
  test: {
    status: 'skipped',
  },
  notes: 'User halted execution after reviewing a local stack trace.',
};
