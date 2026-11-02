# @hokusai/core

## 0.7.0

Released 2026-11-02.

### Minor Changes

- aa05c98: Add queue, CI and repair lifecycle events to the task-cost contract (HOK-3338 / MQ-1.2, contract `1.2.0`, `queue_lifecycle_event/v1`). Thirteen append-only event types (enqueued, candidate_prepared, check_run_completed, ejected, rerun_requested, rebase_performed, repair_commit_pushed, recovery_decision, merged, dequeued, abandoned, review_round_started, review_round_completed). Each is keyed on a `task_attempt/v1` ref (or one ref per run for a merge candidate) and has a minted `event_id`. Control events follow HOK-3372's current-and-unsettled rule and evidence events are always kept. Intended and observed models stay separate, and every event names its actor. Recovery decisions carry a frozen context, policy version and exact/deterministic/none propensities. Facts only: no durations, failure classes or counts. Ships the JSON schema (`queue-lifecycle-event.v1.schema.json`, `QUEUE_LIFECYCLE_EVENT_V1_JSON_SCHEMA`), validators, the `reduceQueueLifecycleLog` reference reducer, eight golden fixtures (`queueLifecycleFixtures`), and the per-fact owning-writer mapping and Model Match review in `queue-lifecycle.md`. Purely additive.
- 219ffc5: One routing-outcome link on every contribution row (HOK-3364).
  - **New row versions.** `technical_task_router_row/v3` and `harness_outcome_row/v2` share one routing-outcome block. `inference_log_id` is present iff Hokusai routed the task. `overrides` (`{ role, source: escalation | launchability | challenge | operator, from, to, reason }`, chained per role and ending at the executed model; `[]` = followed) is present iff `inference_log_id` is. `selected_models` holds the executed models. Rows never store a recommendation copy, and validation rejects one. "Accepted" is derived with `routeRecommendationFollowed`. New writers emit v2/v3: `buildHarnessOutcomeRow` now returns `harness_outcome_row/v2`, and there is a new `buildTechnicalTaskRouterContributionRowV3`. A routed row needs explicit `routeOverrides`, so a builder never assumes the recommendation was followed. v1 harness rows and v1/v2 router rows stay accepted. Golden rows: `routingOutcomeFixtures`.
  - **Correlation is exact or absent.** `findLatestRoutingDecision` is replaced by `findRoutingDecision({ correlationId | taskId | sessionId })`, which has no "newest route" fallback. `hokusai-report --use-latest` is removed: pass `--task-id` or `--correlation-id`, and a task id or inference id that contradicts the stored route is an error. The Claude Code outcome hook offers only a route recorded in the hook event's own session. The Codex outcome tools take `taskId` and add `routeForTaskCommand`. Outcome prompts no longer fill the executed model from the recommendation.
  - **Cost comes from the task's own session.** `locateSessionTranscript` now takes a `sessionId` and returns only that session's transcript, never the newest file in the project directory. Cost tier 4 is skipped without the route's session id.

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
