import {
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
  resolveRetentionPolicy,
  createSetReportingEnabled,
  type HandoffInstructions,
  type ClearResult,
  type DecisionPreview,
  type DeclineRecommendationInput,
  type DeclineRecommendationResult,
  type DoctorResult,
  type LatestRoutingDecision,
  type OutcomeReportPreview,
  type PayloadPreviewResult as CorePayloadPreviewResult,
  type PreviewReportOutcomeResult,
  type PrivacyResultWarnings,
  type RecommendationDisplay,
  type ReportOutcomeInputWithTaskId,
  type ReportOutcomeResult,
  type ReportingStatusResult,
  type RouteResult,
  type RouteSuccess,
  type RoutingDecisionSummary,
} from '@hokusai/core';
import {
  claudeCodeHarnessProfile,
  type ClaudeCodeCommandOptions,
  type RouteInput,
} from './profile.js';
import type { ClaudeCodeTaskPacketPreview } from './task-packet.js';

export type {
  ClearResult,
  DecisionPreview,
  DeclineRecommendationInput,
  DeclineRecommendationResult,
  DoctorResult,
  LatestRoutingDecision,
  OutcomeReportPreview,
  PreviewReportOutcomeResult,
  PrivacyResultWarnings,
  RecommendationDisplay,
  ReportOutcomeResult,
  ReportingStatusResult,
  RouteResult,
  RouteSuccess,
  RoutingDecisionSummary,
};

export type ReportOutcomeInput = ReportOutcomeInputWithTaskId;
export type PayloadPreviewResult =
  CorePayloadPreviewResult<ClaudeCodeTaskPacketPreview>;

export const routeTask = createRouteTask(claudeCodeHarnessProfile);
export const declineRecommendation =
  createDeclineRecommendation(claudeCodeHarnessProfile);
export const runDoctor = createRunDoctor(claudeCodeHarnessProfile);
export const previewTaskPayload =
  createPreviewTaskPayload(claudeCodeHarnessProfile);
export const previewReportOutcome =
  createPreviewReportOutcome(claudeCodeHarnessProfile);
export const reportTaskOutcome =
  createReportTaskOutcome(claudeCodeHarnessProfile);
export const clearClaudeCodeLocalState =
  createClearLocalState(claudeCodeHarnessProfile);
export const listRoutingDecisions =
  createListRoutingDecisions(claudeCodeHarnessProfile);
export const previewStoredDecision =
  createPreviewStoredDecision(claudeCodeHarnessProfile);
export const listSubmissionAudit =
  createListSubmissionAudit(claudeCodeHarnessProfile);
export const clearPrivacyState =
  createClearPrivacyState(claudeCodeHarnessProfile);
export const setReportingEnabled =
  createSetReportingEnabled(claudeCodeHarnessProfile);
export const getReportingStatus =
  createGetReportingStatus(claudeCodeHarnessProfile);

export function displayHandoff(
  handoff: HandoffInstructions,
): string[] {
  return claudeCodeHarnessProfile.renderHandoff(handoff);
}

export {
  displayTaskRecommendation,
  findLatestRoutingDecision,
  resolveRetentionPolicy,
};
export type { ClaudeCodeCommandOptions, RouteInput };
