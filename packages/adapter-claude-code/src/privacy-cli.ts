import {
  PRIVACY_CLI_EXIT_CODES,
  createRunPrivacyCli,
  type PrivacyCliExitCode,
  type PrivacyCliRunResult,
} from '@hokusai/core';
import {
  clearPrivacyState,
  getReportingStatus,
  listRoutingDecisions,
  listSubmissionAudit,
  previewStoredDecision,
  setReportingEnabled,
} from './commands.js';
import { claudeCodeHarnessProfile } from './profile.js';

export { PRIVACY_CLI_EXIT_CODES };
export type { PrivacyCliExitCode, PrivacyCliRunResult };

export const runPrivacyCli = createRunPrivacyCli(claudeCodeHarnessProfile, {
  listRoutingDecisions,
  previewStoredDecision,
  listSubmissionAudit,
  clearPrivacyState,
  getReportingStatus,
  setReportingEnabled,
});
