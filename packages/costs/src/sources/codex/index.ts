/**
 * Public entry point for the Codex cost source adapter.
 *
 * @module sources/codex
 */

export {
  CODEX_PROVIDER_CONTRACT_VERSION,
  runCodexAdapter,
  type CodexAdapterInput,
  type CodexAdapterResult,
} from './adapter.js';

export {
  parseCodexRow,
  type CodexRecord,
  type CodexSessionMetaRecord,
  type CodexTurnContextRecord,
  type CodexTokenCountRecord,
  type CodexParseOutcome,
} from './parser.js';

export {
  SOURCE_DIAGNOSTIC_CODES,
  type SourceDiagnostic,
  type SourceDiagnosticCode,
  type TaskBoundary,
  type TaskCostSourceResult,
} from '../types.js';
