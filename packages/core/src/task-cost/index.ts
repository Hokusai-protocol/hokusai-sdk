/**
 * The `@hokusai/core` public re-export surface for the task-cost contract.
 *
 * Only this file's names are part of the SDK's public API. Internal helpers
 * (`addNullable`, `emptyTokenUsage`, `reconcileCumulative`, `resolveReplays`,
 * `promoteCostSource`, `promoteCoverage`, `promoteAvailability`,
 * `deriveUsageAvailability`, `makeGuard`, `assertNoForbiddenKeys`, …) remain
 * importable inside `@hokusai/core` from their source modules for the tests
 * that exercise them, but they are intentionally NOT re-exported here.
 *
 * @module task-cost
 */

export {
  PROVIDER_CONTRACT_VERSIONS,
  TASK_COST_ADAPTER_CONTRACT_VERSION,
  TASK_COST_CONTRACT_VERSION,
  TASK_COST_EVENT_SCHEMA_VERSION,
  TASK_COST_LEDGER_SCHEMA_VERSION,
  TASK_COST_SUMMARY_SCHEMA_VERSION,
  TASK_ATTEMPT_SCHEMA_VERSION,
} from './schema-version.js';

export {
  TASK_COST_BASES,
  TASK_COST_COVERAGES,
  TASK_COST_DIAGNOSTIC_CODES,
  TASK_COST_EVENT_SOURCES,
  TASK_COST_FIELD_AVAILABILITIES,
  TASK_COST_HARNESSES,
  TASK_COST_JOIN_CONFIDENCES,
  TASK_COST_PRICE_TABLES,
  TASK_COST_PRICING_SOURCES,
  TASK_COST_REPLAY_DECISIONS,
  TASK_COST_SOURCES,
  TASK_COST_USAGE_KINDS,
  type TaskCostBasis,
  type TaskCostCoverage,
  type TaskCostDiagnosticCode,
  type TaskCostEventSource,
  type TaskCostFieldAvailability,
  type TaskCostHarness,
  type TaskCostJoinConfidence,
  type TaskCostPriceTable,
  type TaskCostPricingSource,
  type TaskCostReplayDecision,
  type TaskCostSource,
  type TaskCostUsageKind,
} from './enums.js';

export {
  TASK_COST_TOKEN_FIELDS,
  type TaskCostTokenField,
  type TaskCostTokenUsage,
} from './token-usage.js';

export { type TaskCostEventV1 } from './event.js';

export {
  type TaskCostModelSegment,
  type TaskCostSummaryFieldAvailability,
  type TaskCostSummaryV1,
} from './summary.js';

export { type TaskCostLedgerV1 } from './ledger.js';

export {
  type TaskCostAdapterCapabilities,
  type TaskCostAdapterV1,
  type TaskCostPollInput,
  type TaskCostSummarizeInput,
} from './adapter.js';

export {
  TASK_COST_FORBIDDEN_KEYS,
  TaskCostValidationError,
  isTaskCostEventV1,
  isTaskCostLedgerV1,
  isTaskCostSummaryV1,
  validateTaskCostEventV1,
  validateTaskCostLedgerV1,
  validateTaskCostSummaryV1,
  type TaskCostValidationCode,
} from './validators.js';

export {
  aggregateTaskCost,
  aggregateTaskCostByModel,
  type AggregateTaskCostOptions,
  type TaskCostModelTotal,
} from './aggregate.js';

export {
  TASK_ATTEMPT_ARM_ROLES,
  TASK_ATTEMPT_CONTROL_ACTIONS,
  TASK_ATTEMPT_EVIDENCE_KINDS,
  TASK_ATTEMPT_KINDS,
  TASK_ATTEMPT_OUTCOMES,
  TASK_ATTEMPT_RECORD_TYPES,
  type TaskAttemptArmRole,
  type TaskAttemptCodeIdentity,
  type TaskAttemptControlAction,
  type TaskAttemptControlWriteV1,
  type TaskAttemptDerivedInput,
  type TaskAttemptDerivedResultV1,
  type TaskAttemptEvidenceKind,
  type TaskAttemptEvidenceWriteV1,
  type TaskAttemptKind,
  type TaskAttemptLogEntryV1,
  type TaskAttemptOutcome,
  type TaskAttemptRecordType,
  type TaskAttemptRecordV1,
  type TaskAttemptRef,
  type TaskAttemptSessionRef,
} from './attempt.js';

export {
  isTaskAttemptLogEntryV1,
  validateTaskAttemptLogEntryV1,
  validateTaskAttemptRef,
} from './attempt-validators.js';

export { MINTED_ID_PATTERN } from './validators.js';

export {
  TASK_ATTEMPT_DECISIONS,
  TASK_ATTEMPT_DECISION_REASONS,
  reduceTaskAttemptLog,
  type TaskAttemptDecision,
  type TaskAttemptDecisionKind,
  type TaskAttemptDecisionReason,
  type TaskAttemptDerivedState,
  type TaskAttemptDerivedStatus,
  type TaskAttemptEvidenceState,
  type TaskAttemptLogResult,
  type TaskAttemptState,
} from './attempt-reducer.js';

export { TASK_ATTEMPT_V1_JSON_SCHEMA } from './attempt-schema.js';
