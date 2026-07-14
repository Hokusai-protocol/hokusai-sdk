export {
  // Harness-agnostic contribution plumbing. Any harness that routes must persist
  // the route context and its inference log id, or it cannot later build an
  // attributable contribution row — which is exactly why Codex could not.
  buildReportContributionRow,
  buildRouteContextProjection,
  parseRouteContext,
  createClearLocalState,
  createClearPrivacyState,
  createDeclineRecommendation,
  createGetReportingStatus,
  createListRoutingDecisions,
  createListSubmissionAudit,
  createPreviewReportOutcome,
  createPreviewStoredDecision,
  createPreviewTaskPayload,
  createReportTaskOutcome,
  createRouteTask,
  createRunDoctor,
  displayTaskRecommendation,
  findLatestRoutingDecision,
  pruneStoreForPrivacy,
  resolveRetentionPolicy,
  createSetReportingEnabled,
} from './commands.js';
export {
  buildDefaultRecommendation,
  buildPayloadPreview,
  toModelSelection,
  type BuildTaskPacketResult,
  type HarnessProfile,
} from './harness-profile.js';
export {
  CLI_EXIT_CODES,
  createRunCli,
  type CliExitCode,
  type CliRunResult,
} from './cli.js';
export {
  REPORT_CLI_EXIT_CODES,
  createRunReportCli,
  type ReportCliExitCode,
  type ReportCliRunResult,
} from './report-cli.js';
export {
  buildOutcomeContributionPrompt,
  detectOutcomeCompletionSignal,
  type BuildOutcomeContributionPromptInput,
  type OutcomeCompletionSignal,
  type OutcomeContributionPrompt,
  type OutcomePromptDetection,
} from './outcome-prompt.js';
export {
  PRIVACY_CLI_EXIT_CODES,
  createRunPrivacyCli,
  type PrivacyCliExitCode,
  type PrivacyCliRunResult,
} from './privacy-cli.js';
export {
  createRunBootstrapDoctor,
  renderPluginDoctorReport,
} from './doctor.js';
export type {
  AnyCliExitCode,
  BootstrapDoctorOptions,
  ClearResult,
  DecisionPreview,
  DeclineRecommendationInput,
  DeclineRecommendationResult,
  DoctorResult,
  LatestRoutingDecision,
  ModelCatalog,
  OutcomeReportPreview,
  PayloadPreviewResult,
  PluginCliExitCodes,
  PreviewReportOutcomeResult,
  PrivacyCliExitCodes,
  PrivacyResultWarnings,
  RecommendationDisplay,
  ReportCliExitCodes,
  ReportOutcomeInputWithTaskId,
  ReportOutcomeResult,
  ReportingStatusResult,
  ResolvedConfigPath,
  RouteInputBase,
  RouteResult,
  RouteSuccess,
  RoutingDecisionSummary,
  SharedCommandOptions,
} from './types.js';
export type { RouteContextProjection } from './types.js';
