# Reference Pattern for Hokusai-Enabled Coding Harnesses

This document is the harness-agnostic reference for the Hokusai integration loop. It extracts the reusable route/report pattern from the Claude Code adapter, which remains the first concrete implementation in [`packages/adapter-claude-code`](../packages/adapter-claude-code/README.md).

## The route/report loop

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

The runnable version of this step lives in [`examples/reference-harness/src/index.ts`](../examples/reference-harness/src/index.ts).

### 2. Anonymize

Before any routing call, the harness prepares an anonymized dispatch payload with `HokusaiDispatchBuilder.prepareDispatch()` from [`packages/core/src/client.ts`](../packages/core/src/client.ts). Redaction rules come from the shared engine in [`packages/core/src/anonymization.ts`](../packages/core/src/anonymization.ts). Claude Code performs this step in the `hokusai-route` flow implemented in [`packages/adapter-claude-code/src/cli.ts`](../packages/adapter-claude-code/src/cli.ts).

```ts
const dispatchPayload = await dispatchBuilder.prepareDispatch(
  ctx.task,
  REFERENCE_MODEL.id,
);
const preview = requireOk(
  await adapter.payloads.previewPayload({ payload: dispatchPayload }),
);
```

This is where raw prompt text is redacted and previewed before transport.

### 3. Call the Hokusai router

The transport boundary is `HokusaiClient.route()` from [`packages/core/src/client.ts`](../packages/core/src/client.ts). Request validation is enforced by `validateRouteRequest()` in [`packages/core/src/schemas.ts`](../packages/core/src/schemas.ts) before network I/O. In Claude Code, the user-facing entry point is [`plugin/commands/route.md`](../packages/adapter-claude-code/plugin/commands/route.md).

```ts
const routeResponse = await mockClient.route(dispatchPayload);
```

The reference harness uses a mock client in [`examples/reference-harness/src/mock-client.ts`](../examples/reference-harness/src/mock-client.ts), but the shape matches the real client call.

### 4. Execute in the host harness

Execution is adapter-owned. `mapRecommendation()` from [`packages/core/src/model-registry.ts`](../packages/core/src/model-registry.ts) resolves the recommended model id into a concrete model definition, and then the host harness runs the task with its own UX and execution controls. Claude Code renders a manual handoff with `buildHandoffInstructions()` from [`packages/core/src/handoff.ts`](../packages/core/src/handoff.ts) and presents it through [`packages/adapter-claude-code/src/commands.ts`](../packages/adapter-claude-code/src/commands.ts).

```ts
const mappedModel = mapRecommendation(
  { model: REFERENCE_MODEL.id },
  { registry },
);
const outcome = requireOk(
  await adapter.outcomes.collectOutcome({
    task: ctx.task,
    model: {
      id: mappedModel.id,
      provider: mappedModel.provider,
      capabilities: [...mappedModel.capabilities],
    },
  }),
);
```

Claude Code's visible entry points for this stage are the routed recommendation output and the copyable `/model ...` handoff generated after `/hokusai:route`.

### 5. Submit an anonymized outcome report

When execution finishes, the harness creates a shared `OutcomeReport` with `buildOutcomeReport()` and previews the redacted payload with `previewOutcomePayload()` from [`packages/core/src/outcome.ts`](../packages/core/src/outcome.ts). Submission happens through `HokusaiClient.reportOutcome()` in [`packages/core/src/client.ts`](../packages/core/src/client.ts). Claude Code exposes this as [`plugin/commands/report.md`](../packages/adapter-claude-code/plugin/commands/report.md) backed by [`packages/adapter-claude-code/src/report-cli.ts`](../packages/adapter-claude-code/src/report-cli.ts).

```ts
const reportInput = {
  correlationId: stored.correlationId,
  recommendedModel: mappedModel.id,
  actualModel: mappedModel.id,
  recommendationAccepted: true,
  completionStatus: 'succeeded' as const,
  latencyBucket: 'low' as const,
  costBucket: 'low' as const,
  tokenBucket: 'medium' as const,
  notes: outcome.summary,
  redactionSalt: REDACTION_SALT,
};
const report = buildOutcomeReport(reportInput);
const reportPreview = previewOutcomePayload(reportInput);
await mockClient.reportOutcome(report);
```

The important boundary is the same in every harness: collect local execution outcome, redact it, preview it, then submit it against the correlation id from routing.

## What is harness-agnostic vs Claude Code-specific

| Harness-agnostic pattern                                                                                                                                                                                                                                     | Claude Code-specific implementation                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildTaskPacket()` normalizes local task context into the shared `TaskPacket` schema in [`packages/core/src/task-packet.ts`](../packages/core/src/task-packet.ts).                                                                                          | `buildClaudeCodeTaskPacket()` derives Claude-oriented task signals and previews from Claude command input in [`packages/adapter-claude-code/src/task-packet.ts`](../packages/adapter-claude-code/src/task-packet.ts).                                                                   |
| `HokusaiDispatchBuilder`, shared redaction, and payload hashing live in [`packages/core/src/client.ts`](../packages/core/src/client.ts) and [`packages/core/src/anonymization.ts`](../packages/core/src/anonymization.ts).                                   | The route command UX, CLI parsing, and consent/error messaging live in [`packages/adapter-claude-code/src/cli.ts`](../packages/adapter-claude-code/src/cli.ts) and [`packages/adapter-claude-code/plugin/commands/route.md`](../packages/adapter-claude-code/plugin/commands/route.md). |
| `HokusaiClient.route()` and `HokusaiClient.reportOutcome()` own request validation and transport in [`packages/core/src/client.ts`](../packages/core/src/client.ts).                                                                                         | Claude's report preview/send flow is wired in [`packages/adapter-claude-code/src/report-cli.ts`](../packages/adapter-claude-code/src/report-cli.ts) and [`packages/adapter-claude-code/plugin/commands/report.md`](../packages/adapter-claude-code/plugin/commands/report.md).          |
| `mapRecommendation()`, `validateRecommendedModel()`, and `ANTHROPIC_MODELS` define shared model resolution rules in [`packages/core/src/model-registry.ts`](../packages/core/src/model-registry.ts).                                                         | Claude Code chooses Anthropic-only surfaced models and doctor UX in [`packages/adapter-claude-code/src/index.ts`](../packages/adapter-claude-code/src/index.ts) and [`packages/adapter-claude-code/src/doctor-command.ts`](../packages/adapter-claude-code/src/doctor-command.ts).      |
| `buildOutcomeReport()`, `previewOutcomePayload()`, and the conformance suite are reusable core contracts in [`packages/core/src/outcome.ts`](../packages/core/src/outcome.ts) and [`packages/core/src/conformance.ts`](../packages/core/src/conformance.ts). | Claude Code-specific slash commands and install surface live under [`packages/adapter-claude-code/plugin/`](../packages/adapter-claude-code/plugin/).                                                                                                                                   |

## Example payloads

Safe example payloads live in [`examples/reference-harness/examples/`](../examples/reference-harness/examples/README.md):

- [`task-packet.example.json`](../examples/reference-harness/examples/task-packet.example.json)
- [`outcome-report.example.json`](../examples/reference-harness/examples/outcome-report.example.json)

The example suite validates these files with `validateTaskPacket()` and `validateOutcomeReport()` in [`examples/reference-harness/src/payloads.test.ts`](../examples/reference-harness/src/payloads.test.ts), so schema drift fails CI instead of silently aging the docs.

## Privacy, consent & model-provider constraints

- Consent is off by default. `resolveConsent()` returns `routingEnabled: false` and `outcomeReportingEnabled: false` in [`packages/core/src/consent.ts`](../packages/core/src/consent.ts).
- Claude Code reads `HOKUSAI_API_KEY`, `HOKUSAI_API_BASE_URL`, `HOKUSAI_ROUTING_CONSENT`, `HOKUSAI_OUTCOME_OPT_IN`, and `HOKUSAI_MODEL_ALLOWLIST` through `loadPluginConfig()` in [`packages/core/src/config.ts`](../packages/core/src/config.ts), and the adapter README documents the same user-facing contract in [`packages/adapter-claude-code/README.md`](../packages/adapter-claude-code/README.md).
- Routing requires an API key plus explicit routing consent, and outcome submission requires routing consent plus a separate outcome opt-in. The enforcement points are `assertCanRoute()` and `assertCanSubmitOutcome()` in [`packages/core/src/consent.ts`](../packages/core/src/consent.ts), plus the Claude-specific command checks in [`packages/adapter-claude-code/src/cli.ts`](../packages/adapter-claude-code/src/cli.ts) and [`packages/adapter-claude-code/src/report-cli.ts`](../packages/adapter-claude-code/src/report-cli.ts).
- The default redaction posture is conservative: the shared engine redacts secrets, tokens, credentials, URLs, hostnames, org names, raw code, and log blocks by default through `DEFAULT_REDACTION_CONFIG` in [`packages/core/src/anonymization.ts`](../packages/core/src/anonymization.ts). The privacy model is summarized in [`docs/privacy-model.md`](./privacy-model.md).
- Claude Code recommendations are constrained to Anthropic models. Canonical definitions live in `ANTHROPIC_MODELS`, and allowlist enforcement happens through `validateRecommendedModel()` in [`packages/core/src/model-registry.ts`](../packages/core/src/model-registry.ts) and Claude's model provider wiring in [`packages/adapter-claude-code/src/index.ts`](../packages/adapter-claude-code/src/index.ts).
- Plugin config storage never persists `apiKey`. That restriction is implemented by `LocalStorePluginConfigStore.write()` and `FilePluginConfigStore.write()` in [`packages/core/src/config.ts`](../packages/core/src/config.ts).

## Verifying a new adapter

Use `runAdapterConformance()` from [`packages/core/src/conformance.ts`](../packages/core/src/conformance.ts) as the executable contract for a new harness adapter. The existing per-adapter tests such as [`packages/adapter-claude-code/src/conformance.test.ts`](../packages/adapter-claude-code/src/conformance.test.ts), [`packages/adapter-codex/src/conformance.test.ts`](../packages/adapter-codex/src/conformance.test.ts), and [`packages/adapter-wavemill/src/conformance.test.ts`](../packages/adapter-wavemill/src/conformance.test.ts) show the expected usage.

## Where Wavemill fits

Wavemill is one internal adapter in [`packages/adapter-wavemill`](../packages/adapter-wavemill/README.md) built on the same `@hokusai/core` primitives. Hokusai, not Wavemill, is the product surface; the Wavemill adapter is included only as an additional implementation reference.
