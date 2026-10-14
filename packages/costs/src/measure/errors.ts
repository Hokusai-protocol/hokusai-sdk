/**
 * Programmer-error type for the drop-in API. Bad *data* never throws (it is
 * rejected with diagnostics); only misuse of the API itself does — a
 * non-object argument, a non-function `fn`, an invalid task id or harness, a
 * malformed `sessionFiles` option, or invalid price overrides.
 *
 * @module measure/errors
 */

/** Stable machine-readable code; matches `TaskCostLedgerError`'s convention. */
export type TaskCostMeasureErrorCode = 'INVALID_ARGUMENT';

export class TaskCostMeasureError extends TypeError {
  code: TaskCostMeasureErrorCode;

  constructor(
    message: string,
    code: TaskCostMeasureErrorCode = 'INVALID_ARGUMENT',
  ) {
    super(message);
    this.name = 'TaskCostMeasureError';
    this.code = code;
  }
}
