import {
  REPORT_CLI_EXIT_CODES,
  createRunReportCli,
  type ReportCliExitCode,
  type ReportCliRunResult,
} from '@hokusai/core';
import { findLatestRoutingDecision, previewReportOutcome, reportTaskOutcome } from './commands.js';
import { claudeCodeHarnessProfile } from './profile.js';

export { REPORT_CLI_EXIT_CODES };
export type { ReportCliExitCode, ReportCliRunResult };

export const runReportCli = createRunReportCli(claudeCodeHarnessProfile, {
  findLatestRoutingDecision,
  previewReportOutcome,
  reportTaskOutcome,
});
