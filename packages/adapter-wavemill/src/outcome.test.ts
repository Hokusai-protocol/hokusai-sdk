import { describe, expect, it } from 'vitest';
import { OutcomeReportBuildError } from '@hokusai/core';
import {
  buildWavemillOutcomeReport,
  previewWavemillOutcome,
} from './outcome.js';

function createOutcomeInput(overrides = {}) {
  return {
    correlationId: 'route-wavemill-001',
    recommendedModel: 'gpt-5-codex',
    actualModel: 'gpt-5-codex',
    recommendationAccepted: true,
    completionStatus: 'succeeded' as const,
    userRating: 5,
    latencyBucket: 'medium' as const,
    costBucket: 'high' as const,
    tokenBucket: 'high' as const,
    build: {
      status: 'passed' as const,
    },
    test: {
      status: 'passed' as const,
      failures: 0,
    },
    spendUsdBucket: '0.50-1.00',
    wallClockMinutes: 18,
    ...overrides,
  };
}

describe('buildWavemillOutcomeReport', () => {
  it('builds a success outcome with the Wavemill extension envelope', () => {
    const result = buildWavemillOutcomeReport(createOutcomeInput());

    expect(result.report).toMatchObject({
      correlationId: 'route-wavemill-001',
      completionStatus: 'succeeded',
      extensions: {
        version: '2026-06',
        data: {
          harness: 'wavemill',
          spendUsdBucket: '0.50-1.00',
          wallClockMinutes: 18,
        },
      },
    });
  });

  it('builds an overridden outcome profile', () => {
    const result = buildWavemillOutcomeReport(
      createOutcomeInput({
        correlationId: 'route-wavemill-002',
        recommendedModel: 'claude-3-7-sonnet',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: false,
        completionStatus: 'overridden',
        userRating: undefined,
        latencyBucket: 'high',
        costBucket: 'medium',
        notes: 'Overrode the route after checking repo-local diagnostics.',
        test: {
          status: 'failed',
          failures: 3,
        },
      }),
    );

    expect(result.report).toMatchObject({
      correlationId: 'route-wavemill-002',
      completionStatus: 'overridden',
      recommendationAccepted: false,
      test: {
        status: 'failed',
        failures: 3,
      },
    });
  });

  it('merges additional extensions without allowing harness override', () => {
    const result = buildWavemillOutcomeReport(
      createOutcomeInput({
        additionalExtensions: {
          replayed: true,
        },
      }),
    );

    expect(result.report.extensions?.data).toMatchObject({
      harness: 'wavemill',
      spendUsdBucket: '0.50-1.00',
      wallClockMinutes: 18,
      replayed: true,
    });

    expect(() =>
      buildWavemillOutcomeReport(
        createOutcomeInput({
          additionalExtensions: {
            harness: 'other',
          },
        }),
      ),
    ).toThrow('reserved for the Wavemill adapter');
  });

  it('passes notes redaction through the shared core outcome builder', () => {
    const result = buildWavemillOutcomeReport(
      createOutcomeInput({
        notes: 'Email alice@example.com about tok-WM12345678',
      }),
    );

    expect(result.report.notes).not.toContain('alice@example.com');
    expect(result.report.notes).not.toContain('tok-WM12345678');
  });
});

describe('previewWavemillOutcome', () => {
  it('returns the same canonical report', () => {
    const input = createOutcomeInput({
      notes: 'Email bob@example.com about https://example.test/private',
    });

    expect(previewWavemillOutcome(input)).toEqual(
      buildWavemillOutcomeReport(input).report,
    );
  });

  it('surfaces core outcome validation errors unchanged', () => {
    expect(() =>
      previewWavemillOutcome(
        createOutcomeInput({
          completionStatus: 'done',
        }),
      ),
    ).toThrow(OutcomeReportBuildError);
  });
});
