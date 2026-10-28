# Versioning Policy

This repository uses semantic versioning for package releases and explicit schema versions for public payloads. SDK consumers should treat both package versions and schema constants as compatibility signals.

## Semantic Versioning Rules

- PATCH: bug fixes, documentation updates, internal refactors, and other non-breaking changes with no public API or schema change.
- MINOR: backward-compatible public additions such as new exports, new optional schema fields, new adapter methods, or new enum values.
- MAJOR: breaking contract changes such as removed exports, renamed required schema fields, removed enum values, changed method signatures, or removed adapter interface methods.

## Package Versioning

All published `@hokusai/*` packages are versioned together through Changesets
(`fixed` in `.changeset/config.json`): every release moves every package to the
same version.

- `@hokusai/core` is the stable dependency anchor.
- Packages depend on `@hokusai/core` as `workspace:*` in the monorepo. pnpm
  rewrites that to the **exact** version at publish time, so `@hokusai/costs@X`
  (and every adapter) requires `@hokusai/core@X`.
- A host that depends on `@hokusai/core` directly *and* on `@hokusai/costs` or
  an adapter should depend on the same `@hokusai/core` version those packages
  pin. If the ranges don't overlap, the host gets two copies of core, or keeps
  running an older one.

## Schema Version and Package Version Relationship

The canonical schema versions are exported from `@hokusai/core`:

- `TASK_PACKET_SCHEMA_VERSION = "1.1.0"`
- `OUTCOME_REPORT_SCHEMA_VERSION = "1"`
- `CANDIDATE_FEATURES_SCHEMA_VERSION = "candidate_features/v1"`
- `ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION = "1.0.0"` (the `arbiter_survival_label/v1` wire contract)
- `ARBITER_REPORT_SCHEMA_VERSION = "arbiter_report/v1"`

Rules:

- A task-packet or outcome-schema additive change that preserves backward compatibility requires a `@hokusai/core` MINOR bump and an appropriate schema version bump.
- A task-packet or outcome-schema breaking change requires a `@hokusai/core` MAJOR bump and a schema MAJOR bump.
- PATCH package releases must not change either schema constant.
- Runtime validators accept only the exact exported schema version. Callers should use `TASK_PACKET_SCHEMA_VERSION` and `OUTCOME_REPORT_SCHEMA_VERSION` instead of hard-coding literals.
- Candidate-feature consumers pin the complete `candidate_features/vN`
  contract. Adding, removing, renaming, retyping, or changing the derivation or
  null meaning of any feature requires a new `candidate_features/vN` version;
  v1 is never changed in place after publication.
- A package release that adds a new candidate schema version is MINOR when the
  previous version remains exported. Removing a supported candidate schema
  version is MAJOR.
- The survival-label contract is frozen the same way: ANY field or semantics
  change to `ArbiterSurvivalLabelV1` or
  `packages/core/schemas/arbiter-survival-label.schema.json` — however small —
  requires bumping `ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION`, coordinated with
  the `Hokusai/hokusai-data-pipeline` consumer. The TS schema mirror and the
  JSON file must change together (a core test enforces deep equality).
- The report payload is frozen as `arbiter_report/vN`. Any field or semantic
  change requires a new major wire version. Consumers must accept that version
  before the scanner emits it; unknown versions are rejected.

## Task-cost Contract Versions

The task-cost contract is exported from `@hokusai/core` and documented in
[`packages/core/src/task-cost/README.md`](../packages/core/src/task-cost/README.md):

- `TASK_COST_CONTRACT_VERSION = "1.0.0"` (SemVer for the contract as a whole:
  schemas and reducer semantics)
- `TASK_COST_EVENT_SCHEMA_VERSION = "task_cost_event/v1"`
- `TASK_COST_SUMMARY_SCHEMA_VERSION = "task_cost_summary/v1"`
- `TASK_COST_LEDGER_SCHEMA_VERSION = "task_cost_ledger/v1"`
- `TASK_COST_ADAPTER_CONTRACT_VERSION = "task_cost_adapter/v1"`

| Contract | First `@hokusai/core` | Notes |
| --- | --- | --- |
| task-cost `1.0.0` (`task_cost_*/v1`) | **0.5.0** (2026-10-15) | First release of the contract, validators, `aggregateTaskCost`, and `aggregateTaskCostByModel`. None of it exists in 0.4.0. |

Rules:

- The task-cost API requires `@hokusai/core` ≥ 0.5.0. Each later release
  supports every contract version listed above unless a row says otherwise.
- Additive changes within `.../v1` (new optional fields, new diagnostic codes)
  ship in a `@hokusai/core` MINOR release and bump
  `TASK_COST_CONTRACT_VERSION` minor. A `.../v2` schema is a breaking change
  and requires a `@hokusai/core` MAJOR release.
- Add a row to this table in the release that changes any of these constants.
- Hosts that load task-cost lazily can feature-detect it instead of trusting a
  version range:

  ```ts
  const core = await import('@hokusai/core');
  if (!('aggregateTaskCost' in core)) {
    throw new Error('task-cost requires @hokusai/core >= 0.5.0');
  }
  ```

## The Scan Contract

`@hokusai/scan` exports `SCAN_CONTRACT`, the frozen tuple a consumer uses to
pin exactly what produced a scan artifact:

- `candidateFeatures` / `labels`: the wire-schema versions, derived from the
  `@hokusai/core` constants above — never copied literals.
- `labellerVersion` / `normalizationVersion`: the scanner implementation
  semvers stamped into every label's reproducibility envelope. Bump
  `labellerVersion` for any behaviour change in the labeller; bump
  `normalizationVersion` when the substrate normalization rules or the
  substantial-rewrite threshold change.

Changing any `SCAN_CONTRACT` value invalidates the golden parity fixtures
under `fixtures/arbiter/scan/`; re-capturing them
(`scripts/capture-scan-golden.mjs`) is legitimate only in the PR that makes
that deliberate change.

## Breaking Change Taxonomy

### Adapter Contracts

The following are MAJOR changes:

- removing or renaming any method on `HarnessAdapter` or its sub-interfaces
- changing the required shape of adapter request or result types
- removing a public adapter factory such as `createClaudeCodeHarnessAdapter()` or `createCodexHarnessAdapter()`

Adding a new optional adapter capability or helper is a MINOR change.

### Schema Changes

The following are MAJOR changes:

- removing or renaming a schema field
- changing an optional field to required
- changing field meaning incompatibly
- removing an allowed enum value

The following are MINOR changes:

- adding a new optional field
- adding a new allowed enum value
- adding new harness extension keys under a versioned `extensions.data` object

### API Client Behavior

The following are MAJOR changes:

- changing the name or compatibility meaning of `HokusaiApiError`
- changing the name or compatibility meaning of `HokusaiAuthError`
- changing the name or compatibility meaning of `HokusaiValidationError`
- changing the name or compatibility meaning of `HokusaiDispatchError`

Adding a new typed error class, helper export, or optional request behavior is a MINOR change if existing callers continue to work unchanged.

## Deprecation Lifecycle

Deprecations follow a three-step lifecycle:

1. Announce: mark the field, method, or export as deprecated in JSDoc and document the replacement in the same MINOR release.
2. Support: keep the deprecated item available for at least one full MAJOR version after deprecation.
3. Remove: remove the deprecated item only in a MAJOR release and include migration notes in the changeset.

Deprecated schema fields should remain accepted for the supported window whenever that can be done without violating the strict top-level validation model. If compatibility cannot be preserved, the removal is treated as a breaking schema change and requires a MAJOR release.

## Release Channels

### Stable

Stable releases are the default release channel:

- package versions are published via `pnpm release`
- version numbers are computed from Changesets
- GitHub `v*` tags trigger the release workflow that publishes npm packages and the Claude Code/Codex plugin zip assets with checksums and detached signatures

### Pre-release

No pre-release channel is configured today. If a pre-release channel is needed later, use Changesets pre mode with `pnpm changeset pre enter <tag>` and publish under that tag until the release is promoted.

## Consumer Guidance

- Pin package majors when you need long-lived harness integrations.
- Import schema version constants from `@hokusai/core` instead of copying literals.
- Treat adapter majors as contract changes to the harness-specific layer even when the core package major is unchanged.
- Review changesets and release notes before adopting a new MAJOR or schema version.
- Pin `CANDIDATE_FEATURES_SCHEMA_VERSION`, validate without coercion, and use
  the provenance-stamped fixture in `fixtures/arbiter` for cross-repository
  behavior tests.
