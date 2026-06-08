import {
  OutcomeReportBuildError,
  buildOutcomeReport,
  previewOutcomePayload,
  type OutcomeReport,
  type OutcomeReportInput,
} from '@hokusai/core';

export interface WavemillOutcomeInput
  extends Omit<OutcomeReportInput, 'extensions'> {
  spendUsdBucket: string;
  wallClockMinutes: number;
  extensionsVersion?: string;
  additionalExtensions?: Record<string, unknown>;
}

export interface WavemillOutcomeBuildResult {
  report: OutcomeReport;
}

export class WavemillOutcomeBuildError extends Error {
  override readonly cause: Error | undefined;

  constructor(message: string, options: { cause?: Error } = {}) {
    super(message);
    this.name = 'WavemillOutcomeBuildError';
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DEFAULT_EXTENSIONS_VERSION = '2026-06';

export function buildWavemillOutcomeReport(
  input: WavemillOutcomeInput,
): WavemillOutcomeBuildResult {
  return {
    report: buildCanonicalOutcome(input),
  };
}

export function previewWavemillOutcome(
  input: WavemillOutcomeInput,
): OutcomeReport {
  const candidate = createOutcomeCandidate(input);

  try {
    return previewOutcomePayload(candidate);
  } catch (error) {
    if (error instanceof OutcomeReportBuildError) {
      throw error;
    }

    const cause = error instanceof Error ? error : undefined;
    throw new WavemillOutcomeBuildError(
      'Unable to preview the Wavemill outcome report.',
      cause ? { cause } : {},
    );
  }
}

function buildCanonicalOutcome(input: WavemillOutcomeInput): OutcomeReport {
  const candidate = createOutcomeCandidate(input);

  try {
    return buildOutcomeReport(candidate);
  } catch (error) {
    if (error instanceof OutcomeReportBuildError) {
      throw error;
    }

    const cause = error instanceof Error ? error : undefined;
    throw new WavemillOutcomeBuildError(
      'Unable to build the Wavemill outcome report.',
      cause ? { cause } : {},
    );
  }
}

function createOutcomeCandidate(
  input: WavemillOutcomeInput,
): OutcomeReportInput {
  if (input.additionalExtensions?.harness !== undefined) {
    throw new WavemillOutcomeBuildError(
      '"additionalExtensions.harness" is reserved for the Wavemill adapter.',
    );
  }

  const {
    spendUsdBucket,
    wallClockMinutes,
    extensionsVersion,
    additionalExtensions,
    ...reportInput
  } = input;

  return {
    ...reportInput,
    extensions: {
      version: extensionsVersion ?? DEFAULT_EXTENSIONS_VERSION,
      data: {
        harness: 'wavemill',
        spendUsdBucket,
        wallClockMinutes,
        ...(additionalExtensions ?? {}),
      },
    },
  };
}
