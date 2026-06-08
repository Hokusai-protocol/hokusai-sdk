import { describe, expect, it } from 'vitest';
import {
  OUTCOME_REPORT_SCHEMA_VERSION,
  OutcomeReportBuildError,
  buildOutcomeReport,
  previewOutcomePayload,
  validateOutcomeReport,
  type CompletionStatus,
  type OutcomeReportInput,
} from './outcome.js';
import {
  claudeCodeFailureOutcomeFixture,
  claudeCodeSuccessOutcomeFixture,
  codexAbandonedOutcomeFixture,
  codexSuccessOutcomeFixture,
  wavemillOverriddenOutcomeFixture,
  wavemillSuccessOutcomeFixture,
} from './fixtures/index.js';

function createOutcomeInput(
  overrides: Partial<OutcomeReportInput> = {},
): OutcomeReportInput {
  return {
    correlationId: 'corr-route-123',
    recommendedModel: 'claude-3-7-sonnet',
    actualModel: 'claude-3-7-sonnet',
    recommendationAccepted: true,
    completionStatus: 'succeeded',
    userRating: 4,
    latencyBucket: 'medium',
    costBucket: 'low',
    tokenBucket: 'medium',
    build: {
      status: 'passed',
    },
    test: {
      status: 'passed',
      failures: 0,
    },
    notes: 'User emailed alice@example.com about /tmp/hokusai/build.log',
    ...overrides,
  };
}

describe('validateOutcomeReport', () => {
  it('accepts a valid outcome report', () => {
    const report = buildOutcomeReport(createOutcomeInput());

    expect(validateOutcomeReport(report)).toEqual([]);
    expect(report).toMatchObject({
      schemaVersion: OUTCOME_REPORT_SCHEMA_VERSION,
      correlationId: 'corr-route-123',
      completionStatus: 'succeeded',
    });
  });

  it.each([
    'succeeded',
    'failed',
    'abandoned',
    'overridden',
    'partial',
  ] as const satisfies readonly CompletionStatus[])(
    'accepts completionStatus=%s without a rating',
    (completionStatus) => {
      const input = createOutcomeInput({
        completionStatus,
      });
      delete input.userRating;
      const report = buildOutcomeReport(
        input,
      );

      expect(report.completionStatus).toBe(completionStatus);
      expect(report).not.toHaveProperty('userRating');
    },
  );
});

describe('buildOutcomeReport', () => {
  it('rejects raw-content keys and other unknown top-level keys', () => {
    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        prompt: 'secret prompt',
        code: 'const token = "sk-secret";',
        logs: 'ERROR stack trace',
      } as OutcomeReportInput & Record<string, unknown>),
    ).toThrow(OutcomeReportBuildError);
  });

  it('rejects nested unknown keys', () => {
    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        build: {
          status: 'failed',
          failures: 1,
          rawLog: 'internal build log',
        } as OutcomeReportInput['build'] & Record<string, unknown>,
      }),
    ).toThrow(OutcomeReportBuildError);
  });

  it('redacts notes before returning the report', () => {
    const report = buildOutcomeReport(
      createOutcomeInput({
        notes: 'Contact alice@example.com and inspect /Users/tester/project',
      }),
    );

    expect(report.notes).not.toContain('alice@example.com');
    expect(report.notes).not.toContain('/Users/tester/project');
  });

  it('omits notes when undefined', () => {
    const input = createOutcomeInput();
    delete input.notes;
    const report = buildOutcomeReport(input);

    expect(report).not.toHaveProperty('notes');
  });

  it('requires extensions.version and extensions.data', () => {
    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        extensions: {
          version: '',
          data: {},
        },
      }),
    ).toThrow(OutcomeReportBuildError);

    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        extensions: {
          version: '1',
          data: null as unknown as Record<string, unknown>,
        },
      }),
    ).toThrow(OutcomeReportBuildError);

    expect(
      buildOutcomeReport({
        ...createOutcomeInput(),
        extensions: {
          version: '1',
          data: {
            harness: 'codex',
          },
        },
      }).extensions,
    ).toEqual({
      version: '1',
      data: {
        harness: 'codex',
      },
    });
  });

  it('validates userRating bounds', () => {
    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        userRating: 0,
      }),
    ).toThrow(OutcomeReportBuildError);

    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        userRating: 6,
      }),
    ).toThrow(OutcomeReportBuildError);

    expect(
      buildOutcomeReport({
        ...createOutcomeInput(),
        userRating: 1,
      }).userRating,
    ).toBe(1);
    expect(
      buildOutcomeReport({
        ...createOutcomeInput(),
        userRating: 5,
      }).userRating,
    ).toBe(5);
  });

  it('rejects invalid enum values', () => {
    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        completionStatus: 'done' as CompletionStatus,
      }),
    ).toThrow(OutcomeReportBuildError);

    expect(() =>
      buildOutcomeReport({
        ...createOutcomeInput(),
        latencyBucket: 'fast' as OutcomeReportInput['latencyBucket'],
      }),
    ).toThrow(OutcomeReportBuildError);
  });
});

describe('previewOutcomePayload', () => {
  it('matches buildOutcomeReport output deterministically', () => {
    const input = createOutcomeInput({
      notes: 'Email bob@example.com about https://example.test/private',
    });

    expect(previewOutcomePayload(input)).toEqual(buildOutcomeReport(input));
  });
});

describe('outcome fixtures', () => {
  it.each([
    claudeCodeSuccessOutcomeFixture,
    claudeCodeFailureOutcomeFixture,
    codexSuccessOutcomeFixture,
    codexAbandonedOutcomeFixture,
    wavemillSuccessOutcomeFixture,
    wavemillOverriddenOutcomeFixture,
  ])('builds fixture %# into a valid report', (fixture) => {
    const report = buildOutcomeReport(fixture);

    expect(validateOutcomeReport(report)).toEqual([]);
    expect(report.schemaVersion).toBe(OUTCOME_REPORT_SCHEMA_VERSION);
  });
});
