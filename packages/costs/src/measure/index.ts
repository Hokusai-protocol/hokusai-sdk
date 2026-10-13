/**
 * Public surface of the drop-in measurement layer: `measureTask`,
 * `createTaskCostTracker`, and the camelCase `TaskCostReport` presentation
 * types. Everything here works offline — no network, no Hokusai credentials.
 *
 * @module measure
 */

export { measureTask } from './measure-task.js';
export {
  MEASURE_PROVIDER_CONTRACT_VERSION,
  createTaskCostTracker,
} from './tracker.js';
export { buildTaskCostReport, type BuildReportMeta } from './report.js';
export {
  MEASURE_DIAGNOSTIC_CODES,
  MeasureError,
  TOKEN_USAGE_FIELDS,
  emptyUsage,
  type CostAttributionEntry,
  type CostCoverage,
  type CostDiagnostic,
  type MeasureDiagnosticCode,
  type MeasureErrorCode,
  type MeasureTaskOptions,
  type MeasureTaskResult,
  type RecordUsageInput,
  type TaskCostReport,
  type TaskCostTracker,
  type TaskCostTrackerOptions,
  type TokenUsage,
  type TrackerRecordInput,
} from './types.js';
