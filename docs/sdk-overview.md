# SDK Overview

`@hokusai/core` defines the stable SDK contracts for routing, validation, privacy, consent, schemas, and adapter conformance. Adapter packages add harness-specific command surfaces on top of those core contracts.

## Package Installation

Routing a task from your own application code? Install `@hokusai/router`:

```sh
npm install @hokusai/router
```

Building a harness? Install `@hokusai/core`:

```sh
pnpm add @hokusai/core
npm install @hokusai/core
```

Install one or more adapters only when you are integrating a specific harness:

```sh
pnpm add @hokusai/adapter-claude-code
pnpm add @hokusai/adapter-codex
pnpm add @hokusai/adapter-wavemill
```

```sh
npm install @hokusai/adapter-claude-code
npm install @hokusai/adapter-codex
npm install @hokusai/adapter-wavemill
```

All `@hokusai/*` packages are versioned together and released under one tag, so
`@hokusai/router`, `@hokusai/core`, `@hokusai/adapter-claude-code`,
`@hokusai/adapter-codex`, and `@hokusai/adapter-wavemill` always share a version.
Run `npm view @hokusai/core version` for the current one rather than trusting a
number written here.

For most plugin quickstarts, the final verification step is the Hokusai doctor after auth is configured:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
hokusai-doctor
```

Codex plugin users run the same verification through the bundled skill:

```text
$hokusai-doctor
```

## Package Overview

- `@hokusai/router`: the front-door façade for routing a task from application code. Owns the client, dispatch builder, consent snapshot, and model registry so the common case does not have to. Built entirely on `@hokusai/core`'s public API.
- `@hokusai/core`: shared client, schemas, validation, model mapping, consent, anonymization, storage, fixtures, and conformance helpers.
- `@hokusai/adapter-claude-code`: Claude Code plugin-facing adapter, CLI commands, config loading, and doctor helpers built on `@hokusai/core`.
- `@hokusai/adapter-codex`: Codex plugin, MCP server, task/outcome builders, and OpenAI-only routing helpers built on `@hokusai/core`.
- `@hokusai/adapter-wavemill`: Wavemill reference adapter with replay-aware task/outcome helpers built on `@hokusai/core`.

Dependency direction is one-way: `@hokusai/core` does not import adapters; adapters and `@hokusai/router` depend on core.

## Core SDK API

### API Client

`@hokusai/core` exports the transport and error surface used by every adapter:

- `HokusaiClient`
- `HokusaiDispatchBuilder`
- `createGatedClient()`
- `DEFAULT_HOKUSAI_BASE_URL` (`https://api.hokus.ai`)
- `DEFAULT_ROUTER_MODEL_ID` (`30`)
- `HokusaiApiError`
- `HokusaiAuthError`
- `HokusaiDispatchError`
- `HokusaiNetworkError`
- `HokusaiRateLimitError`
- `HokusaiValidationError`

#### Targeting a different router model or backend path

`HokusaiClient` defaults to Model 30, calling `/api/v1/models/30/predict` for
routes and `/api/v1/models/30/contributions` for contributions. The backend can
promote a newer router model ahead of an SDK release, so these are configurable
without upgrading `@hokusai/core`:

| Option                | Default                            | Use when                                                                                                                                    |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeModelId`        | `30`                               | The backend serves the router under a new model version and you want to opt in early. Path becomes `/api/v1/models/{routeModelId}/predict`. |
| `routePath`           | derived from `routeModelId`        | The backend path shape itself changes (not just the version). Full override; takes precedence over `routeModelId`.                          |
| `contributionModelId` | `30`                               | Contributions should land on a newer model's endpoint. Path becomes `/api/v1/models/{contributionModelId}/contributions`.                   |
| `contributionPath`    | derived from `contributionModelId` | Full override for the contribution path.                                                                                                    |

```ts
// Opt into a newer router model without an SDK upgrade.
const client = new HokusaiClient({ apiKey, routeModelId: '31' });

// Confirm the target path without a network call.
const { path } = await client.route(payload, { dryRun: true });
// path === '/api/v1/models/31/predict'
```

Leave every option unset to keep the current Model 30 behavior. Dry-run results
carry a `path` field so you can verify a configured target before sending.

### Schemas and Validation

Use core helpers to build and validate the public wire payloads:

- `validateRouteRequest()`
- `validateRouteResponse()`
- `validateOutcomeResponse()`
- `validateOutcomeReport()`
- `validateTaskPacket()`
- `buildTaskPacket()`
- `buildOutcomeReport()`
- `previewOutcomePayload()`
- `TASK_PACKET_SCHEMA_VERSION`
- `OUTCOME_REPORT_SCHEMA_VERSION`

### Model Registry

Use the registry exports to map harness model labels onto Hokusai model ids:

- `ANTHROPIC_MODELS`
- `InMemoryModelRegistry`
- `ModelMappingError`
- `mapRecommendation()`
- `validateRecommendedModel()`

### Consent and Config

Core owns consent checks and plugin config loading:

- `loadPluginConfig()`
- `defaultPluginConfigPath`
- `ConfigValidationError`
- `resolveConsent()`
- `assertCanRoute()`
- `assertCanSubmitOutcome()`
- `canRoute()`
- `canRouteWithAuth()`
- `canReportOutcome()`
- `canSubmitOutcomeWithAuth()`
- `ConsentRequiredError`

### Anonymization

Core provides redaction and hashing primitives for payload preparation:

- `anonymizeText()`
- `redact()`
- `hashPayload()`
- `preview()`
- `makePlaceholder()`
- `DEFAULT_REDACTION_CONFIG`

### Storage

Core ships in-memory and filesystem-backed storage primitives:

- `FsLocalStore`
- `InMemoryLocalStore`
- `InMemoryCorrelationStorage`
- `CorrelationStorage`
- `InvalidStoreIdError`
- `RawPayloadRejectedError`
- `StoreCorruptError`

### Conformance

Use the conformance utilities to verify adapter behavior against the shared contract:

- `runAdapterConformance()`
- `conformanceChecks`
- `conformanceFixtures`
- `ConformanceSubject`

### Adapter Interface

Third-party harness authors build against these core adapter contracts:

- `HarnessAdapter`
- `HarnessTaskContextProvider`
- `HarnessModelProvider`
- `HarnessRecommendationRenderer`
- `HarnessOutcomeCollector`
- `HarnessPayloadPreviewer`
- `HarnessConsentPrompter`
- `HarnessLocalStorage`
- `HarnessModelHandoff`

## Adapter APIs

Adapters extend `@hokusai/core`. Core never depends on adapter packages.

### `@hokusai/adapter-claude-code`

Public Claude Code adapter exports include:

- `createClaudeCodeAdapter()`
- `createClaudeCodeModelProvider()`
- `createClaudeCodeDoctor()`
- `createClaudeCodeHarnessAdapter()`
- `loadClaudeCodePluginConfig()`
- `defaultPluginConfigPath`
- `runCli()`
- `runReportCli()`
- `runPrivacyCli()`
- `runDoctor()`
- `runBootstrapDoctor()`
- `buildClaudeCodeTaskPacket()`
- `previewClaudeCodeTaskPacket()`

This package also ships Claude Code plugin binaries:

- `hokusai-route`
- `hokusai-report`
- `hokusai-privacy`
- `hokusai-doctor`
- `hokusai-outcome-hook` (wired to the plugin's Stop and PostToolUse hooks; not invoked directly)

Its adapter layer owns Claude Code config-path resolution, doctor output, plugin command behavior, and Claude-specific model allowlist handling.

### `@hokusai/adapter-codex`

Public Codex adapter exports include:

- `createCodexAdapter()`
- `createCodexModelProvider()`
- `createCodexHarnessAdapter()`
- `buildCodexTaskPacket()`
- `previewCodexTaskPacket()`
- `buildCodexOutcomeReport()`
- `previewCodexOutcomeReport()`
- `requestRecommendation()`
- `previewRoutePayload()`
- `submitOutcome()`
- `CODEX_COMMAND_MANIFEST`

Its adapter layer owns Codex command descriptors, Codex-specific task context collection, and Codex outcome shaping on top of the shared core outcome schema.

Current documented Codex command names are:

- `hokusai:run`
- `hokusai:recommend`
- `hokusai:preview`
- `hokusai:outcome`

The Codex adapter ships both a library surface (documented above) and an installable plugin bundle (`packages/adapter-codex/plugin/`). The plugin includes MCP server definitions, skills (hokusai-route, hokusai-report, hokusai-doctor, hokusai-privacy), marketplace metadata, and a binary entrypoint — see the plugin README for install instructions.

Use [privacy-model.md](privacy-model.md) for the shared adapter privacy posture, including env-only API key handling, local write-time denylists, retention defaults, and preview-before-send behavior.

### `@hokusai/adapter-wavemill`

Public Wavemill adapter exports include:

- `createWavemillAdapter()`
- `createWavemillHarnessAdapter()`
- `createWavemillModelProvider()`
- `buildWavemillTaskPacket()`
- `previewWavemillTaskPacket()`
- `buildWavemillOutcomeReport()`
- `previewWavemillOutcome()`
- `routeWithWavemill()`
- `reportWavemillOutcome()`
- `wavemillConformanceFixtures`

Its adapter layer owns replay-aware task shaping, Wavemill extension fields, and correlation-format conventions without exposing private Wavemill internals.

## Core vs Adapter Boundary

Core owns:

- schemas and validation
- anonymization and payload hashing
- routing and API client behavior
- consent and config contracts
- generic storage and correlation tracking
- model registry and conformance utilities

Adapters own:

- harness command surfaces and manifests
- harness config paths and CLI UX
- harness model labels and discovery
- harness-specific outcome extensions
- local execution telemetry and storage bridges

If a behavior is shared across harnesses, it belongs in `@hokusai/core`. If it depends on one harness runtime, it belongs in an adapter package.

## Task Packet Schema

`TaskPacket` is the canonical normalized routing context sent by harness adapters. The current schema version is `TASK_PACKET_SCHEMA_VERSION`, which is `1.1.0`.

Required fields:

- `schemaVersion`: exact string literal `1.1.0`
- `userIntent`: non-empty summary of the requested outcome
- `taskFamily`: one of `bugfix`, `feature`, `migration`, `refactor`, `test`, `docs`, `infra`, `mixed`, `chore`, `investigation`
- `reasoningDepth`: one of `shallow`, `standard`, `deep`

Optional fields:

- `repositoryScale`: one of `small`, `medium`, `large`, `xlarge`
- `languageSignals`: array of non-empty strings
- `frameworkSignals`: array of non-empty strings
- `availableTools`: array of non-empty strings
- `constraints`: array of non-empty strings
- `modelConstraints`: array of non-empty strings
- `providerConstraints`: array of non-empty strings

The validator is strict. Unknown top-level fields are rejected.

Example:

```json
{
  "schemaVersion": "1.1.0",
  "userIntent": "Fix a flaky integration test in the checkout flow.",
  "taskFamily": "bugfix",
  "reasoningDepth": "standard",
  "repositoryScale": "medium",
  "languageSignals": ["TypeScript"],
  "frameworkSignals": ["Node.js"],
  "availableTools": ["filesystem", "terminal", "test runner"],
  "constraints": ["Do not include raw code in the packet"]
}
```

## Outcome Schema

`OutcomeReport` is the canonical outcome payload sent after execution. The current schema version is `OUTCOME_REPORT_SCHEMA_VERSION`, which is `1`.

Required fields:

- `schemaVersion`: exact string literal `1`
- `correlationId`: non-empty route or correlation identifier
- `recommendedModel`: non-empty recommended model id
- `actualModel`: non-empty actual model id
- `recommendationAccepted`: boolean
- `completionStatus`: one of `succeeded`, `failed`, `abandoned`, `overridden`, `partial`
- `latencyBucket`: one of `low`, `medium`, `high`
- `costBucket`: one of `low`, `medium`, `high`
- `tokenBucket`: one of `low`, `medium`, `high`

Optional fields:

- `userRating`: integer from `1` to `5`
- `build`: object with required `status` (`passed`, `failed`, `skipped`) and optional non-negative `failures`
- `test`: object with required `status` (`passed`, `failed`, `skipped`) and optional non-negative `failures`
- `notes`: redacted free-form summary string
- `extensions`: object with required `version` and required `data` object for harness-specific metadata

The validator is strict here as well. Unknown top-level fields and unversioned harness blobs are rejected.

Example:

```json
{
  "schemaVersion": "1",
  "correlationId": "route_example_0001",
  "recommendedModel": "claude-sonnet-4-6",
  "actualModel": "claude-sonnet-4-6",
  "recommendationAccepted": true,
  "completionStatus": "succeeded",
  "userRating": 4,
  "latencyBucket": "medium",
  "costBucket": "low",
  "tokenBucket": "medium",
  "build": {
    "status": "passed"
  },
  "test": {
    "status": "passed",
    "failures": 0
  },
  "notes": "Fix landed after one retry."
}
```

## Model Mapping

`@hokusai/core` publishes the Anthropic allowlist as `ANTHROPIC_MODELS` and exposes two mapping helpers:

- `mapRecommendation()` maps a recommended Hokusai model id onto a concrete model definition from a registry.
- `validateRecommendedModel()` verifies that a harness-selected model is allowed and returns suggestions when it is not.

Use these helpers together with `InMemoryModelRegistry` to keep harness model labels separate from the shared routed model ids.

## Adapter Lifecycle

At a high level, adapters follow the same five-stage flow:

1. Initialize the adapter, model registry, config, consent policy, and local storage.
2. Route a task by collecting context, building a `TaskPacket`, redacting sensitive text, and calling the API client.
3. Execute in the harness using the selected model and harness-native UX.
4. Report the result by building an `OutcomeReport` and submitting it to the API.
5. Apply privacy and retention rules for local state, previews, and stored correlations.

See [Reference Pattern](reference-pattern.md) for the end-to-end route/report loop.

## Privacy and Consent

Payloads are intentionally constrained to summaries, coarse telemetry, and versioned extension data. `@hokusai/core` provides redaction, hashing, and consent gates so adapters can avoid submitting raw code, logs, secrets, or unreviewed task content.

Consent is resolved before route and outcome submission. Adapters can provide their own consent UX, but the policy and enforcement helpers live in core. See [Privacy Model](privacy-model.md) for the full consent, redaction, and retention model.
