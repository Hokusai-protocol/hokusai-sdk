# Reference Pattern for Hokusai-Enabled Coding Harnesses

This document is the harness-agnostic reference for the Hokusai integration loop. It now applies to both the Claude Code plugin and the Codex MCP plugin, with the reusable command path extracted into `@hokusai/core`.

## The route/contribute loop

### 1. Build a normalized task packet

Every harness starts by converting local task context into the shared `TaskPacket` shape with `buildTaskPacket()` from [`packages/core/src/task-packet.ts`](../packages/core/src/task-packet.ts). Claude Code wraps that generic builder in `buildClaudeCodeTaskPacket()` from [`packages/adapter-claude-code/src/task-packet.ts`](../packages/adapter-claude-code/src/task-packet.ts).

```ts
const packet = buildTaskPacket({
  userIntent: ctx.task.prompt,
  taskFamily: 'feature',
  reasoningDepth: 'standard',
  languageSignals: ['TypeScript'],
  frameworkSignals: ['Node.js'],
});
```

The task packet is the routing-side view of a task. The runnable loop lives in [`examples/reference-harness/src/hokusai/loop.ts`](../examples/reference-harness/src/hokusai/loop.ts).

### 2. Derive the task descriptor

The contribution row carries a `task_descriptor` — the categorical summary the router actually learns from. `deriveTaskDescriptor()` from [`packages/core/src/task-descriptor.ts`](../packages/core/src/task-descriptor.ts) produces it from the raw task text plus counts-only repository signals.

```ts
const derived = deriveTaskDescriptor({
  taskText: ctx.task.prompt,
  repositorySignals: { fileCount: 420, extensionCounts: { ts: 180 } },
});
const taskDescriptor =
  Object.keys(derived).length > 0 ? derived : { task_type: 'unknown' };
```

Only opaque labels and buckets come out: `task_type`, `complexity`, `repo_size_bucket`, `language`. The raw text is read and discarded — never stored, never transmitted. Fields with no derivable signal are omitted rather than guessed, and `buildHarnessOutcomeRow()` rejects an empty descriptor, so fall back to `{ task_type: 'unknown' }` rather than fabricating labels.

Harness-supplied metadata should take precedence over derived labels where both exist; see `buildRouteContextProjection()` in [`packages/core/src/plugin-commands/commands.ts`](../packages/core/src/plugin-commands/commands.ts).

### 3. Anonymize

Before any routing call, the harness prepares an anonymized dispatch payload with `HokusaiDispatchBuilder.prepareDispatch()` from [`packages/core/src/client.ts`](../packages/core/src/client.ts). Redaction rules come from the shared engine in [`packages/core/src/anonymization.ts`](../packages/core/src/anonymization.ts). Claude Code performs this step in the `hokusai-route` flow implemented in [`packages/adapter-claude-code/src/cli.ts`](../packages/adapter-claude-code/src/cli.ts).

```ts
const dispatchPayload = await dispatchBuilder.prepareDispatch(
  ctx.task,
  allowedModels[0],
);
const preview = adapter.previewPayload(dispatchPayload);
```

This is where raw prompt text is redacted and previewed before transport.

### 4. Call the Hokusai router

The transport boundary is `HokusaiClient.route()` from [`packages/core/src/client.ts`](../packages/core/src/client.ts). Request validation is enforced by `validateRouteRequest()` in [`packages/core/src/schemas.ts`](../packages/core/src/schemas.ts) before network I/O. In Claude Code, the user-facing entry point is [`plugin/commands/route.md`](../packages/adapter-claude-code/plugin/commands/route.md).

```ts
const route = await client.route(dispatchPayload);
const inferenceLogId = route.routeId; // the API's persisted inference_log_id
```

`RouteResponse.routeId` carries the API's `inference_log_id`. Hold onto it — step 7 depends on it.

The reference harness uses a mock client in [`examples/reference-harness/src/mock-client.ts`](../examples/reference-harness/src/mock-client.ts), but the shape matches the real client call.

### 5. Execute in the host harness

Execution is adapter-owned. `mapRecommendation()` from [`packages/core/src/model-registry.ts`](../packages/core/src/model-registry.ts) resolves the recommended model id into a concrete model definition, and then the host harness runs the task with its own UX and execution controls. Claude Code renders a manual handoff with `buildHandoffInstructions()` from [`packages/core/src/handoff.ts`](../packages/core/src/handoff.ts) and presents it through [`packages/adapter-claude-code/src/commands.ts`](../packages/adapter-claude-code/src/commands.ts).

```ts
const mapped = mapRecommendation(
  { model: route.recommendation?.model ?? allowedModels[0] },
  { registry },
);
const execution = await adapter.executeTask({
  task: ctx.task,
  model: { id: mapped.id, provider: mapped.provider },
});
```

When the router names a model the harness cannot run, `mapRecommendation()` throws `ModelMappingError` with code `UNKNOWN_MODEL`, `PROVIDER_NOT_ALLOWED`, or `MODEL_UNAVAILABLE`. Catch it, inspect `error.code`, and either remap to a runnable model or record a decline. Never substitute a model silently, because `selected_models` must describe what actually ran.

Claude Code's visible entry points for this stage are the routed recommendation output and the copyable `/model ...` handoff generated after `/hokusai:route`.

### 6. Derive the actual cost

A contribution row is only training-eligible when the reward scorer can decide whether the run came in under budget, which needs a numeric `budget_usd` **and** a numeric `actual_cost_usd`. Most harnesses have token counts rather than dollars, so `computeActualCostUsd()` from [`packages/core/src/pricing.ts`](../packages/core/src/pricing.ts) converts one into the other.

```ts
const actualCostUsd = computeActualCostUsd({
  model: mapped.id,
  inputTokens: execution.inputTokens,
  outputTokens: execution.outputTokens,
  cacheCreationTokens: execution.cacheCreationTokens,
  cacheReadTokens: execution.cacheReadTokens,
});
```

Prompt-cache tokens are billed at 1.25x (writes) and 0.1x (reads) the input rate; folding them into `inputTokens` overstates cost on cache-heavy runs. For an unknown model the function returns `undefined` rather than a fabricated figure, and the row degrades to telemetry.

Claude Code additionally derives cost automatically from its statusline sidecar or session transcript via [`packages/core/src/session-usage.ts`](../packages/core/src/session-usage.ts). OpenHands should pass its LLM or conversation token metrics into `computeActualCostUsd()`. Harnesses without those surfaces — Pi and most custom loops — should pass token counts explicitly.

### 7. Submit a contribution row

This is the canonical submission path. `buildHarnessOutcomeRow()` from [`packages/core/src/contribution/builder.ts`](../packages/core/src/contribution/builder.ts) produces a `harness_outcome_row/v1`, and `HokusaiClient.submitContribution()` posts a one-row batch to `POST /api/v1/models/30/contributions` with an `Idempotency-Key`.

```ts
const row = buildHarnessOutcomeRow({
  inferenceLogId, // <- from route. Do not drop this.
  taskDescriptor,
  allowedModels,
  selectedModels: { coder: mapped.id, reviewer: mapped.id },
  completionResult: execution.completionResult,
  budgetUsd,
  actualCostUsd,
  wallClockSeconds: execution.wallClockSeconds,
});

const response = await client.submitContribution({
  rows: [row],
  metadata: { idempotency_key: idempotencyKey },
});
```

**Thread the `inference_log_id`.** Route returns it as `RouteResponse.routeId`. Without it a row cannot be attributed back to the routing decision and earns nothing, however complete the rest of it is. The Claude Code plugin shipped this bug: it received the id and dropped it.

`validateContributionRow()` enforces the privacy boundary with a forbidden-key guard, rejecting any row carrying `prompt`, `messages`, `task_text`, `description`, and similar. Run it locally — the reference harness's mock client does — so a leak fails in tests rather than in production.

### 8. Read the fidelity tier

The server classifies every accepted row and reports the result:

```ts
const tier = response.rowFidelityTiers?.[0];
// 'training_eligible' -> trains the router, earns stake
// 'partial'           -> accepted, stored as telemetry, excluded from training
```

The classification is **server-authoritative**. Read it; never compute it client-side. A `partial` row still returns `accepted: true` and `rowsAccepted: 1`, so the tier is the only thing that distinguishes a contribution that counts from one that does not.

`reportOutcome()` and `POST /api/v1/outcomes` still exist as a telemetry/compatibility surface. They patch an inference log and bypass training and reward attribution entirely. **Do not build a new integration on them.**

## What is harness-agnostic vs Claude Code-specific

| Harness-agnostic pattern                                                                                                                                                                                                                                                                                                                                                            | Claude Code-specific implementation                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildTaskPacket()` normalizes local task context into the shared `TaskPacket` schema in [`packages/core/src/task-packet.ts`](../packages/core/src/task-packet.ts).                                                                                                                                                                                                                 | `buildClaudeCodeTaskPacket()` derives Claude-oriented task signals and previews from Claude command input in [`packages/adapter-claude-code/src/task-packet.ts`](../packages/adapter-claude-code/src/task-packet.ts).                                                                   |
| `HokusaiDispatchBuilder`, shared redaction, and payload hashing live in [`packages/core/src/client.ts`](../packages/core/src/client.ts) and [`packages/core/src/anonymization.ts`](../packages/core/src/anonymization.ts).                                                                                                                                                          | The route command UX, CLI parsing, and consent/error messaging live in [`packages/adapter-claude-code/src/cli.ts`](../packages/adapter-claude-code/src/cli.ts) and [`packages/adapter-claude-code/plugin/commands/route.md`](../packages/adapter-claude-code/plugin/commands/route.md). |
| `HokusaiClient.route()` and `HokusaiClient.submitContribution()` own request validation and transport in [`packages/core/src/client.ts`](../packages/core/src/client.ts).                                                                                                                                                                                                           | Claude's report preview/send flow is wired in [`packages/adapter-claude-code/src/report-cli.ts`](../packages/adapter-claude-code/src/report-cli.ts) and [`packages/adapter-claude-code/plugin/commands/report.md`](../packages/adapter-claude-code/plugin/commands/report.md).          |
| `mapRecommendation()`, `validateRecommendedModel()`, and `ANTHROPIC_MODELS` define shared model resolution rules in [`packages/core/src/model-registry.ts`](../packages/core/src/model-registry.ts).                                                                                                                                                                                | Claude Code chooses Anthropic-only surfaced models and doctor UX in [`packages/adapter-claude-code/src/index.ts`](../packages/adapter-claude-code/src/index.ts) and [`packages/adapter-claude-code/src/doctor-command.ts`](../packages/adapter-claude-code/src/doctor-command.ts).      |
| `deriveTaskDescriptor()`, `buildHarnessOutcomeRow()`, `computeActualCostUsd()`, and the conformance suite are reusable core contracts in [`packages/core/src/task-descriptor.ts`](../packages/core/src/task-descriptor.ts), [`packages/core/src/contribution/`](../packages/core/src/contribution/), and [`packages/core/src/conformance.ts`](../packages/core/src/conformance.ts). | Claude Code-specific slash commands and install surface live under [`packages/adapter-claude-code/plugin/`](../packages/adapter-claude-code/plugin/).                                                                                                                                   |

## Example payloads

Safe example payloads live in [`examples/reference-harness/examples/`](../examples/reference-harness/examples/README.md):

- [`task-packet.example.json`](../examples/reference-harness/examples/task-packet.example.json)
- [`contribution-row.example.json`](../examples/reference-harness/examples/contribution-row.example.json)

The example suite validates these files with `validateTaskPacket()` and `validateContributionRow()` in [`examples/reference-harness/src/payloads.test.ts`](../examples/reference-harness/src/payloads.test.ts), so schema drift fails CI instead of silently aging the docs.

## Privacy, consent & model-provider constraints

- `resolveConsent()` returns `routingEnabled: true` and `outcomeReportingEnabled: false` by default in [`packages/core/src/consent.ts`](../packages/core/src/consent.ts).
- Claude Code reads `HOKUSAI_API_KEY`, `HOKUSAI_OUTCOME_OPT_IN`, and `HOKUSAI_MODEL_ALLOWLIST` through `loadClaudeCodePluginConfig()` in [`packages/adapter-claude-code/src/index.ts`](../packages/adapter-claude-code/src/index.ts). Outcome submission remains separately opt-in.
- Codex reads `HOKUSAI_API_KEY`, `HOKUSAI_OUTCOME_OPT_IN`, `HOKUSAI_API_BASE_URL`, `HOKUSAI_CONFIG_DIR`, and `HOKUSAI_RETENTION_DAYS` directly from the environment and only emits OpenAI recommendations.
- Routing requires an API key, and outcome submission requires a separate outcome opt-in. The enforcement points are `assertCanRoute()` and `assertCanSubmitOutcome()` in [`packages/core/src/consent.ts`](../packages/core/src/consent.ts), plus the Claude-specific command checks in [`packages/adapter-claude-code/src/cli.ts`](../packages/adapter-claude-code/src/cli.ts) and [`packages/adapter-claude-code/src/report-cli.ts`](../packages/adapter-claude-code/src/report-cli.ts).
- The default redaction posture is conservative: the shared engine redacts secrets, tokens, credentials, URLs, hostnames, org names, raw code, and log blocks by default through `DEFAULT_REDACTION_CONFIG` in [`packages/core/src/anonymization.ts`](../packages/core/src/anonymization.ts). The privacy model is summarized in [`docs/privacy-model.md`](./privacy-model.md).
- Claude Code recommendations are constrained to Anthropic models. Canonical definitions live in `ANTHROPIC_MODELS`, and allowlist enforcement happens through `validateRecommendedModel()` in [`packages/core/src/model-registry.ts`](../packages/core/src/model-registry.ts) and Claude's model provider wiring in [`packages/adapter-claude-code/src/index.ts`](../packages/adapter-claude-code/src/index.ts).
- Plugin config storage never persists `apiKey`. That restriction is implemented by `LocalStorePluginConfigStore.write()` and `FilePluginConfigStore.write()` in [`packages/core/src/config.ts`](../packages/core/src/config.ts).

## Verifying a new adapter

Use `runAdapterConformance()` from [`packages/core/src/conformance.ts`](../packages/core/src/conformance.ts) as the executable contract for a new harness adapter. The existing per-adapter tests such as [`packages/adapter-claude-code/src/conformance.test.ts`](../packages/adapter-claude-code/src/conformance.test.ts), [`packages/adapter-codex/src/conformance.test.ts`](../packages/adapter-codex/src/conformance.test.ts), and [`packages/adapter-wavemill/src/conformance.test.ts`](../packages/adapter-wavemill/src/conformance.test.ts) show the expected usage.

## Where Wavemill fits

Wavemill is one internal adapter in [`packages/adapter-wavemill`](../packages/adapter-wavemill/README.md) built on the same `@hokusai/core` primitives. Hokusai, not Wavemill, is the product surface; the Wavemill adapter is included only as an additional implementation reference.
