# Release Notes

## Versioning model

- All `@hokusai/*` packages are versioned **together** (`fixed` in `.changeset/config.json`): one tag, one version, across every package and both plugin manifests.
- `pnpm version-packages` runs `changeset version` and then `pnpm sync:versions`, which propagates the version into the plugin manifests, the marketplace entry, and `SDK_VERSION`. Changesets does not touch those, and a stale plugin manifest aborts the release at tag time.
- `@hokusai/core` remains the stable dependency anchor for adapter packages.

## Commands

```sh
pnpm changeset
pnpm changeset status
pnpm version-packages
git tag v0.x.y
git push origin v0.x.y
```

## Releases

### 0.8.0 — 2026-11-05

**Requires:** `technical_task_router_row/v4` rows need a server that accepts
them (HOK-3413). Writers switch to v4 in this release; pin **`@hokusai/core` ≥
0.8.0** to build them. The task-cost contract is unchanged (`1.2.0`).

- **Per-stage execution and token facts (HOK-3412).**
  `technical_task_router_row/v4` adds `stage_executions[]`: one entry per stage
  that ran, with its executed model, model evidence, harness and a required
  `task_cost` summary over that stage's sessions. It also adds an optional
  `comparison_group` and `sdk_version`, and reserves `integration`.
  `actual_cost_usd` is contributor-reported evidence: Hokusai reprices from
  `task_cost`.
- **Every writer emits v4,** each stage measured with `@hokusai/costs`: the
  Claude Code and Codex plugins (from the route's own session), aider, the
  integration kit (`HostExecutionResult.cost`) and `@hokusai/router`
  (`reportOutcome({ cost })`).
- **OpenAI price table (Standard tier, 2026-11-04).** Adds the gpt-6.x,
  gpt-5.6, gpt-5.4, gpt-5.3-codex, gpt-5.2 and gpt-5.1 families plus the pro and
  nano rows, each with its own cached-input rate. Requests above 272K input
  tokens use the long-context rates; the engine treats each delta event as one
  request (`aggregate: true` opts out). Codex responses on a non-Standard
  service tier are left unpriced (`unpriced_service_tier`).
  `MODEL_PRICING_AS_OF` moves to `2026-11-04`. `codex-auto-review` is not on
  the page and stays unpriced.
- **Behavior changes:** Claude Code takes its session from
  `CLAUDE_CODE_SESSION_ID` before the statusline sidecar. Plugin token counts no
  longer double-count streamed transcript lines. On Codex, the rollout's model
  is the executed model. `success_under_budget` is `true` only when both the
  budget and the cost are known.

### 0.7.0 — 2026-11-02

**Requires:** queue lifecycle events (`queue_lifecycle_event/v1` records,
`QUEUE_LIFECYCLE_EVENT_V1_JSON_SCHEMA`, `reduceQueueLifecycleLog`,
`queueLifecycleFixtures`) need **`@hokusai/core` ≥ 0.7.0** (task-cost contract
`1.2.0`). Purely additive: existing records and reducers are unchanged. See the
[version-to-contract table](versioning-policy.md#task-cost-contract-versions).

- **Queue, CI and repair lifecycle events (HOK-3338).** Thirteen append-only
  event types keyed on `task_attempt/v1`, each naming its actor, with intended
  and observed models kept separate. Recovery decisions carry a frozen context,
  policy version and propensities. Facts only: no durations, failure classes or
  counts. Ships the JSON schema, validators, reference reducer and eight golden
  fixtures.
- **One routing-outcome link on every contribution row (HOK-3364).**
  `technical_task_router_row/v3` and `harness_outcome_row/v2` share one block:
  `inference_log_id` iff Hokusai routed the task, and `overrides` (chained per
  role, `[]` = followed) iff `inference_log_id` is present. Rows never store a
  recommendation copy. v1 harness rows and v1/v2 router rows stay accepted.
- **Breaking for direct callers:** `findLatestRoutingDecision` is replaced by
  `findRoutingDecision({ correlationId | taskId | sessionId })` with no "newest
  route" fallback; `hokusai-report --use-latest` is removed;
  `locateSessionTranscript` now takes a `sessionId`; `buildHarnessOutcomeRow`
  returns `harness_outcome_row/v2`.

### 0.6.0 — 2026-10-31

**Requires:** attempt identity (`task_attempt/v1` records, the
`TASK_ATTEMPT_*` constants and validators, `reduceTaskAttemptLog`,
`taskAttemptFixtures`) and the optional `run_id` / `stage_attempt_id` fields on
`TaskCostEventV1` need **`@hokusai/core` ≥ 0.6.0** (task-cost contract `1.1.0`).
Readers on 0.5.0 ignore the new event fields, and events without them are
unchanged. See the
[version-to-contract table](versioning-policy.md#task-cost-contract-versions).

- **Attempt identity in the task-cost contract (HOK-3372).** Minted `run_id`,
  `pair_id`, `arm_id` and `stage_attempt_id` with typed `parent_id` /
  `retry_of` edges. Control writes are accepted only for the current, unsettled
  attempt; evidence writes are always accepted against the attempt they name.
  Evidence is versioned, and a derived result that read an older version is
  reported stale. Ships the JSON schema, validators, the reference reducer,
  eight golden fixtures and the Wavemill field mapping.
- **Arbiter contracts in `@hokusai/core`.** The versioned Arbiter report
  payload with scanner-owned suppression and aggregation APIs; the
  corrective-rework contract (`cr-0.1.0`, schema 1.1.0 with a `revert_reason`
  evidence kind) and `deriveCorrectiveLabel()`; the HOK-3269 calibration
  taxonomy; and S2 survival label v1.1.0 with `envelope.integration_mode`
  (`promotion` | `direct`). v1.0.0 label rows stay valid.
- **`hokusai-scan` corpus commands.** `corpus-corrective` (P1–P4 corrective
  detection), `corpus-report` (per repo × horizon corrective rates with Wilson
  CIs and a hashed run manifest), and `corpus-calibration-sample` /
  `-evidence` / `-score`.
- **Survival labeller 1.3.0 → 1.4.0.** `linked_issue_or_pr` counts only
  same-repo, non-bot cross-references. `undone_by` credits the commits that
  changed the PR's files rather than the merge commit, and agent identities
  match whole names. Labelling on large repos is faster, and labels are
  otherwise unchanged.
- `@hokusai/costs` 0.6.0 has no changes of its own; it moves to
  `@hokusai/core` 0.6.0.

### 0.5.0 — 2026-10-15

**Requires:** the task-cost API (`aggregateTaskCost`,
`aggregateTaskCostByModel`, `validateTaskCostEventV1` and the other
validators, `TASK_COST_*` constants) needs **`@hokusai/core` ≥ 0.5.0**. It does
not exist in 0.4.0. Importing it there fails with `does not provide an export
named 'aggregateTaskCost'`. `@hokusai/costs` pins `@hokusai/core` to its own
exact version, so a host that also depends on core directly should depend on
the same version. See the
[version-to-contract table](versioning-policy.md#task-cost-contract-versions).

- **`@hokusai/costs` is published for the first time** — drop-in per-task cost
  measurement: `measureTask(options, fn)` wraps one run and returns a typed
  `TaskCostReport` (total, per-model/per-harness breakdowns, usage, cost
  source/basis, pricing snapshot, coverage, diagnostics, and the raw contract
  summaries); `createTaskCostTracker` gives every other host explicit
  `record`/`recordUsage`/`summary`/`flush`/`reset`. Underneath sit the
  HOK-3069…3072 layers shipped in the same release: the task-cost contract in
  `@hokusai/core`, the pricing engine, the Claude Code/Codex session-file
  adapters, and the local ledger.
- **Entirely offline.** Measurement makes no network call, reads no
  `HOKUSAI_API_KEY`, writes nothing to disk by default, and never submits
  anything. Automatic capture requires supported usage events or session
  files behind an explicit boundary; otherwise call `tracker.recordUsage`.
  Routing (`@hokusai/router`) and contribution remain entirely optional.
- **`@hokusai/core` adds `aggregateTaskCostByModel`** — per-model totals that
  partition the task summary exactly. Additive; no contract, validator,
  fixture, or `aggregateTaskCost` output changes, and `resolveActualCostUsd`,
  `route.reportOutcome`, and all prior public APIs are unchanged.
- **Verified from the consumer's seat.** `pnpm smoke:costs` packs the real
  tarballs, installs them offline into a clean temp project, runs the shipped
  examples (`node_modules/@hokusai/costs/examples/*.mjs`) with every network
  primitive stubbed to throw and `HOKUSAI_*` stripped, and type-checks a
  consumer. It gates CI and runs again in the release workflow before
  `npm publish`; `--registry 0.5.0` re-verifies the published package.
- **Rollback:** the release is additive. If 0.5.0 misbehaves, deprecate
  `@hokusai/costs@0.5.0` (`npm deprecate`) and ship a patch — prior core and
  router APIs keep their current behavior, and any opt-in ledger files remain
  readable (the record schema is versioned).

Also in 0.5.0:

- **Codex cost fix (HOK-3104).** Codex reports cached input as a subset of
  `input_tokens` and reasoning as a subset of `output_tokens`; these are now
  normalized to disjoint buckets, so cache-heavy Codex estimates drop (≈6.9× on
  the motivating rollout). `PROVIDER_CONTRACT_VERSIONS.codex` is now `codex/2`;
  use `provider_contract_version` to tell historical `codex/1` ledger rows apart.
- **`@hokusai/scan` is published for the first time** — the Arbiter survival
  labeller and candidate-feature extractor, with a `hokusai-scan` CLI and
  shadow-mode `shadow-score` / `shadow-backfill` / `shadow-report` commands.
  `@hokusai/core` gains the `candidate_features/v1`,
  `arbiter_survival_label/v1`, and `arbiter_shadow_*/v1` contracts.
- **`@hokusai/adapter-aider` is published for the first time** — a thin Aider
  CLI wrapper that routes through Hokusai and submits one
  `harness_outcome_row/v1` contribution per run.
- **`@hokusai/core`** adds the host integration kit, multi-provider
  `actual_cost_usd` capture (OpenAI and Google pricing, `normalizeModelId`), and
  exports `HARNESS_OUTCOME_ROW_FIELDS`.
- **OpenHands integration example** (`examples/openhands-integration`, a Python
  package, not published to npm): wires OpenHands `RouterLLM` and SDK metrics
  into Hokusai routing and contribution rows.

### 0.3.0 — 2026-07-15

- **`@hokusai/router` is published for the first time.** The façade existed in the repo but had never been released, so the documented install (`npm install @hokusai/router`) did not resolve.
- **Outcomes are submitted as Model 30 contribution rows.** `@hokusai/router` and the Codex plugin previously posted to the legacy `/outcomes` endpoint, which 404s and which bypasses training and reward attribution entirely. Pass `maxCostUsd` when routing and `actualCostUsd` when reporting: without both, the server files the row as `partial` — telemetry that trains nothing and earns nothing.
- **The Codex plugin is installable.** The release zip shipped its marketplace manifest at the archive root, where Codex cannot see it; it now ships at `.agents/plugins/marketplace.json`. The install id is `hokusai@hokusai`. Skills carry the frontmatter Codex requires, the MCP server is launched the way Codex launches one, and the plugin no longer ships hooks it never registered.
- **`hokusai-doctor` verifies the API key** instead of only checking that the variable is set. An expired key previously produced a green "ready to use" report while every route failed.
- **`@hokusai/router` reads `HOKUSAI_API_KEY` from the environment**, which its README and JSDoc had always promised and never implemented.

## Publishing expectations

- Publishable artifacts come from `packages/*`.
- The example app is private and never published.
- `v*` tags publish public npm packages through Changesets and attach signed Claude Code/Codex plugin release artifacts.
