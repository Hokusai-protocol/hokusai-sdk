# @hokusai/core

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
