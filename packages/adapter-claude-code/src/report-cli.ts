import {
  REPORT_CLI_EXIT_CODES,
  createRunReportCli,
  type ReportCliExitCode,
  type ReportCliRunResult,
} from '@hokusai/core';
import { findRoutingDecision, previewReportOutcome, reportTaskOutcome } from './commands.js';
import { claudeCodeHarnessProfile } from './profile.js';
import { measureClaudeCodeStage } from './stage-cost.js';

export { REPORT_CLI_EXIT_CODES };
export type { ReportCliExitCode, ReportCliRunResult };

export const runReportCli = createRunReportCli(claudeCodeHarnessProfile, {
  findRoutingDecision,
  previewReportOutcome,
  reportTaskOutcome,
  measureStage: measureClaudeCodeStage,
});
