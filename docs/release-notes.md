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

### 0.5.0 — unreleased

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

### 0.3.0 — unreleased

- **`@hokusai/router` is published for the first time.** The façade existed in the repo but had never been released, so the documented install (`npm install @hokusai/router`) did not resolve.
- **Outcomes are submitted as Model 30 contribution rows.** `@hokusai/router` and the Codex plugin previously posted to the legacy `/outcomes` endpoint, which 404s and which bypasses training and reward attribution entirely. Pass `maxCostUsd` when routing and `actualCostUsd` when reporting: without both, the server files the row as `partial` — telemetry that trains nothing and earns nothing.
- **The Codex plugin is installable.** The release zip shipped its marketplace manifest at the archive root, where Codex cannot see it; it now ships at `.agents/plugins/marketplace.json`. The install id is `hokusai@hokusai`. Skills carry the frontmatter Codex requires, the MCP server is launched the way Codex launches one, and the plugin no longer ships hooks it never registered.
- **`hokusai-doctor` verifies the API key** instead of only checking that the variable is set. An expired key previously produced a green "ready to use" report while every route failed.
- **`@hokusai/router` reads `HOKUSAI_API_KEY` from the environment**, which its README and JSDoc had always promised and never implemented.

## Publishing expectations

- Publishable artifacts come from `packages/*`.
- The example app is private and never published.
- `v*` tags publish public npm packages through Changesets and attach signed Claude Code/Codex plugin release artifacts.
