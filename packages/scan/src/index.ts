/**
 * @hokusai/scan — the Arbiter scanner core (HOK-2816).
 *
 * The survival labeller and candidate-feature extractor, callable three
 * equivalent ways: as a library (this surface), as the `hokusai-scan` CLI,
 * and as the packaged GitHub Action. All three share one code path and
 * produce byte-identical output for the same inputs.
 *
 * Wire-format contracts live in `@hokusai/core` and are re-exported here for
 * convenience; execution stays on this side of the boundary (Arbiter R1).
 */

export { SCAN_CONTRACT, scanContractVersion, type ScanContract } from './contract.js';

export {
  extractCandidateFeatures,
  validateCandidateFeatures,
  CANDIDATE_FEATURES_SCHEMA_VERSION,
  type CandidateDescriptionLengthBucket,
  type CandidateDomain,
  type CandidateFeatureContract,
  type CandidateFeatureKey,
  type CandidateFeatureValidationIssue,
  type CandidateFeaturesOptions,
  type CandidateFeaturesV1,
  type CandidateFilesTouchedBucket,
  type CandidateLanguage,
  type CandidateRepoSizeBucket,
  type CandidateRiskLevel,
  type CandidateTaskType,
} from './candidate-features.js';

export {
  GIT_OUTPUT_MAX_BUFFER,
  SURVIVAL_LABELLER_VERSION,
  SURVIVAL_NORMALIZATION_VERSION,
  classifyCommitActor,
  enumerateMergedPrs,
  isSkippedPr,
  labelMergedPr,
  parseZeroContextDiff,
  resolveMergedPr,
  summarizeLabels,
  type CrossReference,
  type GitCommandResult,
  type GitRunner,
  type HorizonBaseRate,
  type LabelMergedPrOptions,
  type MergedPrRef,
  type PrMetadata,
  type SkippedPr,
  type SurvivalGitHubClient,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
  type SurvivalSummary,
} from './survival-labeller.js';

export {
  ScanUpstreamError,
  classifyUpstreamFailure,
  createDefaultDeps,
  createOfflineGitHubClient,
  type CreateDefaultDepsOptions,
} from './default-deps.js';

export {
  COMPLEXITY_METRIC_ID,
  DEFAULT_TIMEOUTS_MS,
  LEGACY_SCAN_CONFIG_FILENAME,
  SCAN_CONFIG_FILENAME,
  collectCiBuildEvidence,
  collectStaticFeatures,
  countTscErrors,
  fileComplexity,
  readCommittedStaticAnalysisConfig,
  sumEslintErrors,
  type StaticBuildEvidence,
  type StaticFeaturesOptions,
  type StaticFeaturesResult,
  type StaticFeaturesTimeouts,
} from './static-features.js';

export {
  extractPrNumber,
  parseNameStatusOutput,
  parseRevertAcknowledgements,
  type NameStatusEntry,
} from './diff-parsing.js';

export {
  escapeShellArg,
  execArgvCommand,
  execShellCommand,
  type ExecArgvCommandOptions,
  type ExecArgvCommandResult,
} from './shell-utils.js';

export {
  ScanInputError,
  validateAsOf,
  validateGithubRepo,
  validateHorizons,
  validateIntegrationBranch,
  validateMaxPrs,
  validatePrNumber,
  validatePrUrl,
  validateRepoDir,
  validateTokenEnvName,
  type GithubRepoRef,
  type ScanCommonInputs,
  type ScanExtractInputs,
  type ScanInputs,
  type ScanLabelInputs,
} from './inputs.js';

export {
  serializeCandidateFeatures,
  serializeSurvivalLabels,
  sortMergedPrsForEmission,
} from './serialize.js';

export {
  DEFAULT_REPORT_HORIZON,
  PLACEHOLDER_RULE_PHRASE,
  PRECISION_SUPPRESSION_FLOOR,
  SHADOW_REPO_REPORT_SCHEMA_VERSION,
  SHADOW_RULE_DESCRIPTION,
  SHADOW_RULE_ID,
  aggregateShadowScans,
  evaluateShadowRule,
  parsePrUrl,
  prNumberFromSource,
  renderShadowReportMarkdown,
  serializeShadowReport,
  type ShadowAggregateOptions,
  type ShadowAggregateResult,
  type ShadowFlagVerdict,
  type ShadowRepoReportV1,
  type ShadowRepoSummaryV1,
  type ShadowScanInput,
} from './shadow-aggregate.js';

// Contract-type re-exports from @hokusai/core, so scan consumers do not need
// a direct core import for the common wire types.
export {
  ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
  HORIZONS,
  MISSING_REASON_CODES,
  REASON_CODES,
  SUBSTANTIAL_REWRITE_THRESHOLD,
  buildArbiterSurvivalLabel,
  canonicalHash,
  canonicalSerialize,
  deriveReportOutcome,
  validateCandidateFeaturesV1,
  type ArbiterSurvivalLabelV1,
  type HorizonDays,
  type LabelProvenance,
  type LineRange,
  type LineRangeAnchor,
  type MissingReasonCode,
  type ReasonCode,
  type ReportOutcome,
  type ReproducibilityEnvelope,
  type SurvivalOutcome,
  type UndoneBy,
} from '@hokusai/core';
