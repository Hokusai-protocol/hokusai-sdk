# @hokusai/core

## 0.6.0

Released 2026-10-31.

### Minor Changes

- a04a1a9: Add the versioned Arbiter report payload, scanner-owned suppression, and report aggregation and orchestration APIs.
- b654ba6: Add the HOK-3269 calibration taxonomy to `@hokusai/core` (verdicts, cause codes, human exclusion codes) and three `hokusai-scan` commands: `corpus-calibration-sample` draws a stratified, seeded sample from the persisted corpus outputs with the evaluation slice excluded; `corpus-calibration-evidence` gathers each item's diffs, candidate fixes and related later PRs plus a blank human-audit sheet; `corpus-calibration-score` reports precision, recall, Cohen's kappa and cause distribution for two model labellers and a human audit, and decides whether the model labels stand in.
- 4469876: Corrective-rework schema 1.1.0 adds a `revert_reason` evidence kind (`REVERT_REASON_CLASSES`). `corpus-corrective` adds P3 (SZZ blame of bug fixes) and P4 (closed regression issues), and fetches the labels and types of closed issues.
- fd95e1f: Add the Arbiter corrective-rework contract (HOK-3267, definition `cr-0.1.0`): candidate, repair-pair and corrective records in one versioned schema (`arbiter-corrective-rework.schema.json`, `ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA`). Rejected candidates keep a typed exclusion code; each accepted candidate has a repair pair with file sets, line survival, test delta and review metadata; `deriveCorrectiveLabel()` derives the per-horizon corrective boolean from accepted repair pairs and links it to its S2 label by `base_label_hash`. Records carry no raw content.
- 7196ec7: S2 survival label v1.1.0: add `envelope.integration_mode` (`promotion` | `direct`) and admit `integration_branch: main` only in `direct` mode, so repos that merge PRs straight into `main` can be labelled. v1.0.0 rows stay valid, and shadow outcome logs holding them remain readable. The scanner gains `--integration-mode` and labeller version 1.1.0.
- ffc4199: Add attempt identity to the task-cost contract (HOK-3372, contract `1.1.0`, `task_attempt/v1`): minted `run_id`, `pair_id`, `arm_id` and `stage_attempt_id` with typed `parent_id` / `retry_of` edges; control writes accepted only for the current, unsettled attempt and evidence writes always accepted against their own attempt; versioned evidence with stale-detection for derived results. Ships the JSON schema (`task-attempt.v1.schema.json`, `TASK_ATTEMPT_V1_JSON_SCHEMA`), validators, the `reduceTaskAttemptLog` reference reducer, eight golden fixtures (`taskAttemptFixtures`) and the Wavemill field mapping. `TaskCostEventV1` gains optional `run_id` and `stage_attempt_id`.

## 0.5.0

Released 2026-10-15.

### Minor Changes

- **Task-cost contract v1** (`task_cost_*/v1`, `TASK_COST_CONTRACT_VERSION`
  `1.0.0`). Adds the event, summary, ledger, and adapter types; the
  `validateTaskCost*V1` / `isTaskCost*V1` validators; the reference reducer
  `aggregateTaskCost`; the `TASK_COST_*` constants; and `taskCostFixtures`.
  **Requires `@hokusai/core` ≥ 0.5.0.** None of these exports exists in 0.4.0.
- Adds `aggregateTaskCostByModel`, which returns per-model totals that
  partition the task summary exactly.
- Codex cost normalization (HOK-3104): cached input and reasoning tokens are
  now split into disjoint buckets. `PROVIDER_CONTRACT_VERSIONS.codex` is
  `codex/2`.
- Adds the `candidate_features/v1`, `arbiter_survival_label/v1`, and
  `arbiter_shadow_*/v1` contracts.
- Adds the host integration kit and multi-provider `actual_cost_usd` capture
  (OpenAI and Google pricing, `normalizeModelId`), and exports
  `HARNESS_OUTCOME_ROW_FIELDS`.

See the [0.5.0 release notes](https://github.com/Hokusai-protocol/hokusai-sdk/blob/main/docs/release-notes.md#050--2026-10-15).
