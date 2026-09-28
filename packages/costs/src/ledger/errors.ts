export type TaskCostLedgerErrorCode =
  | 'INVALID_RECORD'
  | 'READ_LIMIT_EXCEEDED'
  | 'INVALID_QUERY'
  | 'STORAGE_FAILURE'
  | 'LEDGER_CLOSED'
  | 'INVALID_STORAGE_ARGUMENT';

/** Error messages include field names or errno codes, never user supplied values. */
export class TaskCostLedgerError extends Error {
  readonly code: TaskCostLedgerErrorCode;
  readonly field?: string;

  constructor(
    code: TaskCostLedgerErrorCode,
    message: string,
    options: { field?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'TaskCostLedgerError';
    this.code = code;
    if (options.field !== undefined) this.field = options.field;
  }
}
