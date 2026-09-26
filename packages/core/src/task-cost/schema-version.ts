/**
 * Version constants for the public task-cost contract.
 *
 * Compatibility rules (full text in `README.md`):
 *
 * - `TASK_COST_CONTRACT_VERSION` is SemVer for the contract as a whole.
 * - Every wire record carries its own `schema_version`. Consumers MUST check it
 *   first and MUST NOT infer a version from field shape.
 * - Within a MAJOR: new optional fields and new diagnostic codes are additive;
 *   removing/renaming fields, making an optional field required, or changing
 *   the meaning of an existing value requires a new major (`.../v2`).
 * - `provider_contract_version` versions a harness's parsing contract and is
 *   orthogonal to the schema versions here.
 *
 * @module task-cost/schema-version
 */

/** SemVer of the task-cost contract (schemas + reducer semantics). */
export const TASK_COST_CONTRACT_VERSION = '1.0.0';

export const TASK_COST_EVENT_SCHEMA_VERSION = 'task_cost_event/v1';
export const TASK_COST_SUMMARY_SCHEMA_VERSION = 'task_cost_summary/v1';
export const TASK_COST_LEDGER_SCHEMA_VERSION = 'task_cost_ledger/v1';
export const TASK_COST_ADAPTER_CONTRACT_VERSION = 'task_cost_adapter/v1';

/**
 * Provider parsing-contract versions per harness. `claude-code` and `codex`
 * mirror Wavemill's `PROVIDER_CONTRACT_VERSIONS` (HOK-2958) so migrated records
 * keep their provenance; `native` and `pi` are new in this contract.
 */
export const PROVIDER_CONTRACT_VERSIONS = Object.freeze({
  'claude-code': 'claude-code/1',
  codex: 'codex/1',
  native: 'native/1',
  pi: 'pi/1',
} as const);
