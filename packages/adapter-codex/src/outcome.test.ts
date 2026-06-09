import { describe, expect, it } from 'vitest';
import {
  codexAbandonedOutcomeFixture,
  codexSuccessOutcomeFixture,
  validateOutcomeReport,
} from '@hokusai/core';
import {
  buildCodexOutcomeReport,
  previewCodexOutcomeReport,
} from './outcome.js';

describe('buildCodexOutcomeReport', () => {
  it('builds a valid outcome report and injects the codex harness tag', () => {
    const report = buildCodexOutcomeReport(codexSuccessOutcomeFixture);

    expect(validateOutcomeReport(report)).toEqual([]);
    expect(report.extensions).toEqual({
      version: '1',
      data: {
        harness: 'codex',
        toolCalls: 12,
        editedFiles: 5,
      },
    });
  });

  it('preserves caller-provided extension fields', () => {
    const report = buildCodexOutcomeReport({
      ...codexSuccessOutcomeFixture,
      extensions: {
        version: '7',
        data: {
          harness: 'codex',
          sessionId: 'session-1',
        },
      },
    });

    expect(report.extensions).toEqual({
      version: '7',
      data: {
        harness: 'codex',
        sessionId: 'session-1',
      },
    });
  });

  it('matches the codex abandoned fixture shape', () => {
    const report = buildCodexOutcomeReport(codexAbandonedOutcomeFixture);

    expect(Object.keys(report)).toEqual([
      'correlationId',
      'recommendedModel',
      'actualModel',
      'recommendationAccepted',
      'completionStatus',
      'latencyBucket',
      'costBucket',
      'tokenBucket',
      'test',
      'notes',
      'extensions',
      'schemaVersion',
    ]);
    expect(report.extensions?.data).toEqual({
      harness: 'codex',
    });
  });
});

describe('previewCodexOutcomeReport', () => {
  it('previews the same normalized report shape', () => {
    expect(previewCodexOutcomeReport(codexSuccessOutcomeFixture)).toEqual(
      buildCodexOutcomeReport(codexSuccessOutcomeFixture),
    );
  });
});
