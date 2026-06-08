import {
  buildOutcomeReport,
  previewOutcomePayload,
  type OutcomeReport,
  type OutcomeReportInput,
} from '@hokusai/core';

export function buildCodexOutcomeReport(
  input: OutcomeReportInput,
): OutcomeReport {
  return buildOutcomeReport(enrichOutcomeInput(input));
}

export function previewCodexOutcomeReport(
  input: OutcomeReportInput,
): OutcomeReport {
  return previewOutcomePayload(enrichOutcomeInput(input));
}

function enrichOutcomeInput(input: OutcomeReportInput): OutcomeReportInput {
  return {
    ...input,
    extensions: {
      version: input.extensions?.version ?? '1',
      data: {
        harness: 'codex',
        ...(input.extensions?.data ?? {}),
      },
    },
  };
}
