/**
 * Opt-in Claude Code task-cost source adapter
 * (`@hokusai/costs/sources/claude-code`).
 *
 * @module sources/claude-code
 */

export {
  extractClaudeCodeUsage,
  type ExtractClaudeCodeUsageOptions,
} from './adapter.js';
export {
  CLAUDE_CODE_PROVIDER_CONTRACT_VERSION,
  parseClaudeCodeTranscript,
  type ClaudeCodeUsageRow,
} from './parser.js';
export type { ParseJsonlOptions } from '../jsonl.js';
export {
  TASK_COST_SOURCE_DIAGNOSTIC_CODES,
  type TaskCostBoundaryV1,
  type TaskCostSourceDiagnosticCode,
  type TaskCostSourceDiagnostics,
  type TaskCostSourceResult,
} from '../types.js';
