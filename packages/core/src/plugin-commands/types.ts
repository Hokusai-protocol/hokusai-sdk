import type {
  AdapterResult,
  ConsentConfig,
  ConsentSettings,
  HarnessPayloadPreview,
  HarnessRecommendation,
  HandoffInstructions,
  HokusaiClient,
  ModelRegistry,
  OutcomeReport,
  OutcomeReportInput,
  OutcomeResponse,
  PayloadHashRecord,
  RetentionPolicy,
  RouteResponse,
  SubmissionAuditEntry,
  TaskPacket,
  FetchTransport,
  PluginDoctorReport,
  HokusaiDispatchPayload,
} from '../index.js';

export interface SharedCommandOptions {
  apiClient?: HokusaiClient;
  configPath?: string;
  consent?: ConsentConfig;
  env?: NodeJS.ProcessEnv;
  registry?: ModelRegistry;
  settings?: Partial<ConsentSettings>;
  clock?: () => Date;
  dryRun?: boolean;
}

export interface RouteInputBase {
  taskText: string;
  taskId?: string;
  modelId?: string;
  metadata?: Record<string, string>;
}

export interface RouteSuccess {
  recommendation: HarnessRecommendation;
  payload: HokusaiDispatchPayload;
  preview: HarnessPayloadPreview;
  correlationId: string;
  routingDecisionId: string;
  handoff: HandoffInstructions;
  route?: RouteResponse;
}

export type RouteResult = AdapterResult<RouteSuccess>;

export interface DeclineRecommendationInput {
  correlationId: string;
  reason?: string;
}

export interface DeclineRecommendationResult {
  correlationId: string;
  status: 'declined';
}

export interface DoctorResult {
  configDir: string;
  configPresent: boolean;
  needsSetup: boolean;
  consent: {
    routingEnabled: boolean;
    outcomeReportingEnabled: boolean;
    grantedScopes: ConsentConfig['grantedScopes'];
  };
  connectivity: 'unchecked' | 'configured';
}

export interface PayloadPreviewResult<TPreview> {
  packet: TaskPacket;
  preview: TPreview;
  harnessPreview: HarnessPayloadPreview;
}

export interface ReportOutcomeInputWithTaskId extends OutcomeReportInput {
  taskId: string;
}

export interface LatestRoutingDecision {
  correlationId: string;
  taskId: string;
  createdAt: string;
  recommendedModelId?: string;
  /** Server-issued inference log id (routeId), used to submit outcomes. */
  inferenceLogId?: string;
}

export interface ReportOutcomeResult {
  report: OutcomeReport;
  response?: OutcomeResponse;
  submitted: boolean;
}

export interface OutcomeReportPreview {
  lines: string[];
  payload: OutcomeReport;
}

export interface PreviewReportOutcomeResult {
  report: OutcomeReport;
  preview: OutcomeReportPreview;
}

export interface RoutingDecisionSummary {
  correlationId: string;
  taskId: string;
  createdAt: string;
  recommendedModelId?: string;
  alternatives: string[];
  reasonPreview?: string;
  status?: string;
  reasonHash?: string;
  payloadHash?: PayloadHashRecord;
}

export interface DecisionPreview extends RoutingDecisionSummary {
  decisionAt?: string;
  declinedAt?: string;
  debugRedactedPayloadPreview?: string;
}

export interface ClearResult {
  scope: 'all' | 'records' | 'audit';
  correlationsCleared: number;
  payloadHashesCleared: number;
  auditEntriesCleared: number;
  configCleared: boolean;
}

export interface ReportingStatusResult {
  enabled: boolean;
  source: 'env' | 'stored' | 'default';
}

export interface PrivacyResultWarnings {
  warnings?: string[];
}

export interface RecommendationDisplay {
  lines: string[];
  model: string;
  provider: string;
}

export interface ModelCatalog {
  registry: ModelRegistry;
  allowedProviders?: string[];
  allowedModels?: string[];
  requireAvailable?: boolean;
  providerConstraintLabels?: string[];
  modelConstraintLabels?: string[];
}

export interface ResolvedConfigPath {
  dir: string;
  exists: boolean;
}

export interface BootstrapDoctorOptions {
  configPath?: string;
  pluginConfigPath?: string;
  env?: NodeJS.ProcessEnv;
  transport?: FetchTransport;
}

export interface PluginCliExitCodes {
  OK: 0;
  UNKNOWN_ERROR: 1;
  AUTH_REQUIRED: 2;
  CONSENT_REQUIRED: 3;
  NETWORK_ERROR: 4;
  UNSUPPORTED_MODEL: 5;
  EMPTY_TASK: 6;
}

export interface ReportCliExitCodes extends PluginCliExitCodes {
  OUTCOME_VALIDATION_ERROR: 7;
}

export interface PrivacyCliExitCodes extends ReportCliExitCodes {
  PRIVACY_USAGE_ERROR: 8;
}

export type AnyCliExitCode =
  | PluginCliExitCodes[keyof PluginCliExitCodes]
  | ReportCliExitCodes[keyof ReportCliExitCodes]
  | PrivacyCliExitCodes[keyof PrivacyCliExitCodes];

export type RenderDoctorReport = (report: PluginDoctorReport) => string;

export type ResolveRetentionPolicy = (
  env?: NodeJS.ProcessEnv,
) => RetentionPolicy;

export type ListSubmissionAuditResult = AdapterResult<
  {
    entries: SubmissionAuditEntry[];
  } & PrivacyResultWarnings
>;
