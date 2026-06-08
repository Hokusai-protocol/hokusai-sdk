import type { OutcomeReportInput } from '../outcome.js';

export const claudeCodeSuccessOutcomeFixture: OutcomeReportInput = {
  correlationId: 'route-claude-001',
  recommendedModel: 'claude-3-7-sonnet',
  actualModel: 'claude-3-7-sonnet',
  recommendationAccepted: true,
  completionStatus: 'succeeded',
  userRating: 4,
  latencyBucket: 'medium',
  costBucket: 'medium',
  tokenBucket: 'medium',
  build: {
    status: 'passed',
  },
  test: {
    status: 'passed',
    failures: 0,
  },
  notes: 'Verified completion with alice@example.com copied on the summary.',
};

export const claudeCodeFailureOutcomeFixture: OutcomeReportInput = {
  correlationId: 'route-claude-002',
  recommendedModel: 'claude-3-7-sonnet',
  actualModel: 'gpt-5-codex',
  recommendationAccepted: false,
  completionStatus: 'failed',
  latencyBucket: 'high',
  costBucket: 'medium',
  tokenBucket: 'high',
  build: {
    status: 'failed',
    failures: 1,
  },
  test: {
    status: 'skipped',
  },
  notes: 'Failure captured from https://claude.example.internal/build/123',
};
