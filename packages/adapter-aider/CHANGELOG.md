# @hokusai/adapter-aider

## 0.6.0

### Minor Changes

- 219ffc5: One routing-outcome link on every contribution row (HOK-3364).
  - **New row versions.** `technical_task_router_row/v3` and `harness_outcome_row/v2` share one routing-outcome block. `inference_log_id` is present iff Hokusai routed the task. `overrides` (`{ role, source: escalation | launchability | challenge | operator, from, to, reason }`, chained per role and ending at the executed model; `[]` = followed) is present iff `inference_log_id` is. `selected_models` holds the executed models. Rows never store a recommendation copy, and validation rejects one. "Accepted" is derived with `routeRecommendationFollowed`. New writers emit v2/v3: `buildHarnessOutcomeRow` now returns `harness_outcome_row/v2`, and there is a new `buildTechnicalTaskRouterContributionRowV3`. A routed row needs explicit `routeOverrides`, so a builder never assumes the recommendation was followed. v1 harness rows and v1/v2 router rows stay accepted. Golden rows: `routingOutcomeFixtures`.
  - **Correlation is exact or absent.** `findLatestRoutingDecision` is replaced by `findRoutingDecision({ correlationId | taskId | sessionId })`, which has no "newest route" fallback. `hokusai-report --use-latest` is removed: pass `--task-id` or `--correlation-id`, and a task id or inference id that contradicts the stored route is an error. The Claude Code outcome hook offers only a route recorded in the hook event's own session. The Codex outcome tools take `taskId` and add `routeForTaskCommand`. Outcome prompts no longer fill the executed model from the recommendation.
  - **Cost comes from the task's own session.** `locateSessionTranscript` now takes a `sessionId` and returns only that session's transcript, never the newest file in the project directory. Cost tier 4 is skipped without the route's session id.

### Patch Changes

- Updated dependencies [aa05c98]
- Updated dependencies [219ffc5]
  - @hokusai/core@0.7.0

## 0.5.1

### Patch Changes

- Updated dependencies [a04a1a9]
- Updated dependencies [b654ba6]
- Updated dependencies [4469876]
- Updated dependencies [fd95e1f]
- Updated dependencies [7196ec7]
- Updated dependencies [ffc4199]
  - @hokusai/core@0.6.0
