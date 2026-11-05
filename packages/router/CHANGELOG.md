# @hokusai/router

## 0.8.0

### Minor Changes

- feac07a: `technical_task_router_row/v4` carries per-stage execution and token facts (HOK-3412).
  - **New row version.** v4 is v3 plus `stage_executions[]`. Each entry is one stage that ran: `planning | coding | review`, or a repair stage `ci-fix | conflict-resolution | ready-remediation`. It names the `executed_model`, the `model_evidence` (`provider_response | session_telemetry | requested_only`), the `harness`, and a required `task_cost`: the `task_cost_summary/v1` over that stage's sessions. The row also gains optional `comparison_group` (`{ id: pair_id, role_varied }`) and `sdk_version`, and reserves `integration` (`{}` only, for HOK-3343). The last entry per base stage must match `selected_models`. Each `task_cost` passes the task-cost contract's stricter forbidden-key list. `actual_cost_usd` is kept as contributor-reported evidence; Hokusai reprices from `task_cost`. v1–v3 router rows and v1/v2 harness rows stay accepted.
  - **Builder.** `buildTechnicalTaskRouterRowV4` takes each stage's `@hokusai/costs` report (`measureTask` / `tracker.summary()`) as its `cost`, so a harness never writes token handling. An empty report becomes an explicit `coverage: 'unavailable'` summary (`unavailableTaskCostSummary`). A report spanning several harnesses is rejected; split it into one stage per harness. `actual_cost_usd` defaults to the sum of the stage totals when every stage resolved. Golden rows: `contributionV4Fixtures`, with `contributionV4StageSources` for parity.
  - **Every writer emits v4.** That covers the Claude Code and Codex plugins, `@hokusai/adapter-aider`, the integration-kit loop (`HostExecutionResult.cost`), and `@hokusai/router`, whose `reportOutcome` / `reportExternalOutcome` take `cost`. `@hokusai/adapter-wavemill` re-exports the v4 types for the Wavemill producer (HOK-3415). `ContributionRequest.rows` accepts v4 rows.
  - **Plugins measure the route's own session.** `createRunReportCli` and `submitOutcomeCommand` take a `MeasureStage`. Claude Code reads the transcript named by `CLAUDE_CODE_SESSION_ID` (now preferred over the global statusline sidecar, whose cost is adopted only for the same session). Codex reads the rollout named in the MCP call's `_meta`, stored locally at route time and never sent; the rollout's dominant model is the executed model, and a difference from the agent's report is recorded as an override with the new source `observed` (the session record shows another model ran; nobody is known to have chosen it). `observed` is valid in every row with an overrides block. Both are measured with `@hokusai/costs`, which de-duplicates streamed transcript lines that the legacy totals counted twice.
  - **OpenAI price table (pricing page, Standard tier, 2026-11-04).** New gpt-6.x / gpt-5.6 / gpt-5.4 / gpt-5.3-codex / gpt-5.2 / gpt-5.1 / pro / nano rows. `ModelPrice` gains per-model `cachedInputPerMTokUsd` / `cacheWritePerMTokUsd` (`null` = no rate, so the usage stays unpriced) and a `longContext` tier for requests above 272K input tokens. `computeActualCostUsd` applies that tier only with `requestScoped: true`, which the `@hokusai/costs` engine sets for delta events. A record or ingest input that sums several requests sets the new `aggregate: true`. Codex responses on a non-Standard `service_tier` are left unpriced with the new `unpriced_service_tier` diagnostic. `MODEL_PRICING_AS_OF` is now `2026-11-04`. The golden task-cost fixtures keep their pinned `2026-07-15` revision, and their estimates are unchanged.
  - **Schema export.** `pnpm export:schemas` also writes `technical_task_router_row_v4_schema.json` for non-TypeScript writers, and CI checks that it is current.

### Patch Changes

- Updated dependencies [feac07a]
  - @hokusai/core@0.8.0

## 0.7.0

Released 2026-11-02.

### Minor Changes

- 219ffc5: One routing-outcome link on every contribution row (HOK-3364).
  - **New row versions.** `technical_task_router_row/v3` and `harness_outcome_row/v2` share one routing-outcome block. `inference_log_id` is present iff Hokusai routed the task. `overrides` (`{ role, source: escalation | launchability | challenge | operator, from, to, reason }`, chained per role and ending at the executed model; `[]` = followed) is present iff `inference_log_id` is. `selected_models` holds the executed models. Rows never store a recommendation copy, and validation rejects one. "Accepted" is derived with `routeRecommendationFollowed`. New writers emit v2/v3: `buildHarnessOutcomeRow` now returns `harness_outcome_row/v2`, and there is a new `buildTechnicalTaskRouterContributionRowV3`. A routed row needs explicit `routeOverrides`, so a builder never assumes the recommendation was followed. v1 harness rows and v1/v2 router rows stay accepted. Golden rows: `routingOutcomeFixtures`.
  - **Correlation is exact or absent.** `findLatestRoutingDecision` is replaced by `findRoutingDecision({ correlationId | taskId | sessionId })`, which has no "newest route" fallback. `hokusai-report --use-latest` is removed: pass `--task-id` or `--correlation-id`, and a task id or inference id that contradicts the stored route is an error. The Claude Code outcome hook offers only a route recorded in the hook event's own session. The Codex outcome tools take `taskId` and add `routeForTaskCommand`. Outcome prompts no longer fill the executed model from the recommendation.
  - **Cost comes from the task's own session.** `locateSessionTranscript` now takes a `sessionId` and returns only that session's transcript, never the newest file in the project directory. Cost tier 4 is skipped without the route's session id.

### Patch Changes

- Updated dependencies [aa05c98]
- Updated dependencies [219ffc5]
  - @hokusai/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [a04a1a9]
- Updated dependencies [b654ba6]
- Updated dependencies [4469876]
- Updated dependencies [fd95e1f]
- Updated dependencies [7196ec7]
- Updated dependencies [ffc4199]
  - @hokusai/core@0.6.0
