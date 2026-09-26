/**
 * Public entry point for the Claude Code cost source adapter.
 *
 * @module sources/claude-code
 */

export {
  CLAUDE_CODE_PROVIDER_CONTRACT_VERSION,
  runClaudeCodeAdapter,
  type ClaudeCodeAdapterInput,
  type ClaudeCodeAdapterResult,
} from './adapter.js';

export {
  parseClaudeCodeRow,
  type ClaudeCodeAssistantRecord,
  type ClaudeCodeParseOutcome,
} from './parser.js';

export {
  SOURCE_DIAGNOSTIC_CODES,
  type SourceDiagnostic,
  type SourceDiagnosticCode,
  type TaskBoundary,
  type TaskCostSourceResult,
} from '../types.js';
