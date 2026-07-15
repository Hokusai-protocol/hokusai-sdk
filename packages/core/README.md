# @hokusai/core

The harness-agnostic contracts behind the Hokusai router: the API client, the
routing payload and dispatch builder, redaction and consent, the model registry,
and the contribution rows the router learns from.

**Most integrations should not start here.** If you are routing tasks from
application code, use [`@hokusai/router`](../router) — a thin façade over this
package that owns the wiring the common case should not have to think about:

```sh
npm install @hokusai/router
```

Reach for `@hokusai/core` when you are building a harness: when you need custom
consent scopes, your own redaction config, control over correlation storage, or
the raw request and response shapes.

## Install

```sh
npm install @hokusai/core
```

## The loop

Every integration is the same three steps. Route a task, run it yourself, then
contribute the outcome — the contribution is what trains the router.

```ts
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
  ANTHROPIC_MODELS,
  buildHarnessOutcomeRow,
  deriveTaskDescriptor,
} from '@hokusai/core';

const client = new HokusaiClient({ apiKey: process.env.HOKUSAI_API_KEY });
const registry = new InMemoryModelRegistry(ANTHROPIC_MODELS);

const builder = new HokusaiDispatchBuilder({
  consent: { subjectId: 'my-harness', grantedScopes: ['task-execution', 'telemetry'] },
  modelRegistry: registry,
});

// 1. Route. The prompt is redacted before it leaves the process.
const payload = await builder.prepareDispatch(task, registry.getDefault()!.id, 'task-execution', {
  availableModels: ['claude-sonnet-4-6', 'claude-opus-4-8'],
  objective: 'highest_reliability',
  maxCostUsd: 1,
});
const decision = await client.route(payload);

// 2. Run the model yourself. Hokusai never calls a model.

// 3. Contribute the outcome, attributed to the decision it came from.
const row = buildHarnessOutcomeRow({
  inferenceLogId: decision.routeId, // without this the row is unattributable
  taskDescriptor: deriveTaskDescriptor({ taskText: task.prompt }),
  allowedModels: ['claude-sonnet-4-6', 'claude-opus-4-8'],
  selectedModels: { coder: decision.recommendation.model, reviewer: decision.recommendation.model },
  completionResult: 'success',
  budgetUsd: 1,
  actualCostUsd: 0.42,
});

const response = await client.submitContribution({ rows: [row] });
response.rowFidelityTiers; // ['training_eligible']
```

## Contribute, don't report

`client.reportOutcome()` and `POST /api/v1/outcomes` still exist as a
telemetry/compatibility surface. They patch an inference log and **bypass
training and reward attribution entirely. Do not build a new integration on
them.** Use `submitContribution()`.

The server classifies every accepted row and returns a **fidelity tier**. Only
`training_eligible` trains the router or earns rewards. Reaching it requires a
non-empty task descriptor, a non-empty `allowedModels`, `selectedModels` naming a
coder or reviewer, an `inferenceLogId`, and **both** `budgetUsd` and
`actualCostUsd` — the server scores the cost against the budget, and cannot score
a row missing either. A `partial` row is still `accepted: true`, so the tier is
the only signal that a contribution counted. It is server-authoritative: read it,
never compute it.

## External observations

Externally chosen runs should still use `submitContribution()`, but they should
not fabricate an `inferenceLogId`. Build a `harness_outcome_row/v1` with the
observed task descriptor, candidate pool, selected model, budget, and cost, then
read the server-assigned fidelity tier:

```ts
const row = buildHarnessOutcomeRow({
  taskDescriptor: { task_type: 'feature', language: 'typescript' },
  allowedModels: ['qwen-3-coder', 'glm-5.2', 'gemini-2.5-pro'],
  selectedModels: { coder: 'qwen-3-coder', reviewer: 'qwen-3-coder' },
  completionResult: 'success',
  budgetUsd: 0.5,
  actualCostUsd: 0.12,
  harness: 'custom-harness',
});

const response = await client.submitContribution({
  rows: [row],
  metadata: { idempotency_key: 'external-run-123' },
});
```

Use `@hokusai/router`'s `route.reportExternalOutcome()` helper when you want
this report-only path without manually building rows.

## What leaves your process

Nothing you did not ask to send. Prompts are redacted before dispatch, task text
is reduced to categorical labels by `deriveTaskDescriptor`, and the API key is
structurally un-persistable — the config stores throw if you try to write it.
Outcome submission is off until explicitly enabled. See
[Privacy Model](../../docs/privacy-model.md).

## Documentation

- [SDK Overview](../../docs/sdk-overview.md) — the full public API surface
- [Integration Guide](../../docs/integration-guide.md) — building a new harness adapter
- [Reference Pattern](../../docs/reference-pattern.md) — the route → execute → contribute loop
- [Payload Schemas](../../docs/payload-schemas.md) — the wire contracts
- [`examples/reference-harness`](../../examples/reference-harness) — the smallest complete integration
