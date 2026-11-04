---
'@hokusai/core': minor
'@hokusai/adapter-claude-code': minor
'@hokusai/adapter-codex': minor
'@hokusai/adapter-aider': minor
'@hokusai/adapter-wavemill': minor
'@hokusai/router': minor
---

`technical_task_router_row/v4` carries per-stage execution and token facts (HOK-3412).

- **New row version.** v4 is v3 plus `stage_executions[]`. Each entry is one stage that ran: `planning | coding | review`, or a repair stage `ci-fix | conflict-resolution | ready-remediation`. It names the `executed_model`, the `model_evidence` (`provider_response | session_telemetry | requested_only`), the `harness`, and a required `task_cost`: the `task_cost_summary/v1` over that stage's sessions. The row also gains optional `comparison_group` (`{ id: pair_id, role_varied }`) and `sdk_version`, and reserves `integration` (`{}` only, for HOK-3343). The last entry per base stage must match `selected_models`. Each `task_cost` passes the task-cost contract's stricter forbidden-key list. `actual_cost_usd` is kept as contributor-reported evidence; Hokusai reprices from `task_cost`. v1–v3 router rows and v1/v2 harness rows stay accepted.
- **Builder.** `buildTechnicalTaskRouterRowV4` takes each stage's `@hokusai/costs` report (`measureTask` / `tracker.summary()`) as its `cost`, so a harness never writes token handling. An empty report becomes an explicit `coverage: 'unavailable'` summary (`unavailableTaskCostSummary`). A report spanning several harnesses is rejected; split it into one stage per harness. `actual_cost_usd` defaults to the sum of the stage totals when every stage resolved. Golden rows: `contributionV4Fixtures`, with `contributionV4StageSources` for parity.
- **Every writer emits v4.** That covers the Claude Code and Codex plugins, `@hokusai/adapter-aider`, the integration-kit loop (`HostExecutionResult.cost`), and `@hokusai/router`, whose `reportOutcome` / `reportExternalOutcome` take `cost`. `@hokusai/adapter-wavemill` re-exports the v4 types for the Wavemill producer (HOK-3415). `ContributionRequest.rows` accepts v4 rows.
- **Plugins measure the route's own session.** `createRunReportCli` and `submitOutcomeCommand` take a `MeasureStage`. Claude Code reads the transcript named by `CLAUDE_CODE_SESSION_ID` (now preferred over the global statusline sidecar, whose cost is adopted only for the same session). Codex reads the rollout named in the MCP call's `_meta`, stored locally at route time and never sent; the rollout's dominant model is the executed model, and a difference from the agent's report is recorded as an override with the new source `observed` (the session record shows another model ran; nobody is known to have chosen it). `observed` is valid in every row with an overrides block. Both are measured with `@hokusai/costs`, which de-duplicates streamed transcript lines that the legacy totals counted twice.
- **Schema export.** `pnpm export:schemas` also writes `technical_task_router_row_v4_schema.json` for non-TypeScript writers, and CI checks that it is current.
