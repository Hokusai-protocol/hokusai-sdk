# Hokusai SDK

Hokusai is a task routing and outcome-learning SDK for coding harnesses. It provides shared routing, payload, privacy, consent, model-mapping, and outcome-reporting contracts, plus adapters that show how those contracts fit into real harnesses.

This repository currently includes:

- `@hokusai/router` for routing a task from application code — the front door, and where most integrations should start
- `@hokusai/core` for the harness-agnostic SDK contracts and API client
- `@hokusai/adapter-claude-code` for the installable Claude Code plugin and Claude-specific adapter
- `@hokusai/adapter-codex` for the installable Codex plugin, MCP server, task context, model mapping, and outcome builders
- `@hokusai/adapter-wavemill` for a richer replay-aware reference adapter used by Wavemill-style harnesses
- `examples/reference-harness` for the smallest complete generic integration flow

## Install Packages

If you are routing tasks from your own application code, start with
`@hokusai/router` — a thin façade over `@hokusai/core` that owns the client,
dispatch builder, consent snapshot, and model registry for you:

```sh
pnpm add @hokusai/router
npm install @hokusai/router
```

```ts
import { route } from '@hokusai/router';

const { model } = await route({ task, availableModels, maxCostUsd: 1 });
const result = await models[model].run(task);
await route.reportOutcome({ status: 'succeeded', actualCostUsd: result.costUsd });
```

See [packages/router/README.md](packages/router/README.md). Pass `maxCostUsd`
when routing and `actualCostUsd` when reporting: the server scores one against
the other, and a contribution missing either is stored as telemetry that trains
nothing and earns nothing.

If a model choice was made outside Hokusai, use the explicit report-only path
instead of fabricating a route. This opens coverage for Qwen, GLM, Gemini, Grok,
DeepSeek, Kimi, Llama, Mistral, and other externally routed runs:

```ts
await route.reportExternalOutcome({
  task: 'Refactor the auth middleware to use the new policy engine.',
  allowedModels: ['qwen-3-coder', 'glm-5.2', 'gemini-2.5-pro'],
  model: 'qwen-3-coder',
  status: 'succeeded',
  budgetUsd: 0.5,
  actualCostUsd: 0.12,
  harness: 'custom-harness',
});
```

The server still assigns the authoritative fidelity tier. Route-less
observations improve model coverage, but they are not attributed to a Hokusai
routing decision unless the backend explicitly classifies them that way.

If you are building a harness rather than calling one, start with
`@hokusai/core`:

```sh
pnpm add @hokusai/core
npm install @hokusai/core
```

Add an adapter package when you are targeting a specific harness:

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

## What The SDK Provides

`@hokusai/core` owns the shared route/report protocol:

- `HokusaiClient` for route and outcome API calls
- `HokusaiDispatchBuilder` for consent-gated, redacted dispatch payloads
- task packet and outcome report schemas
- validation helpers for route requests, route responses, and outcome reports
- anonymization and redaction utilities
- model registry and recommendation mapping
- local correlation storage primitives
- adapter conformance helpers and fixtures

Adapters own harness-specific behavior:

- collecting task context from the host environment
- describing commands or plugin surfaces
- discovering and mapping runnable models
- previewing payloads in the host UI or CLI
- rendering recommendations and handoffs
- collecting completion outcomes
- bridging local storage and consent UX

## Example: Generic Harness

Use the core SDK directly when building a new harness integration:

```ts
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
} from '@hokusai/core';

const client = new HokusaiClient({ apiKey: process.env.HOKUSAI_API_KEY });
const dispatchBuilder = new HokusaiDispatchBuilder({
  consent: {
    subjectId: 'developer-123',
    grantedScopes: ['task-execution'],
  },
  modelRegistry: new InMemoryModelRegistry([
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt',
      capabilities: ['reasoning', 'tool-use'],
      default: true,
    },
  ]),
});

const payload = await dispatchBuilder.prepareDispatch(
  {
    id: 'task-1',
    prompt: 'Refactor the auth middleware to use the new policy engine.',
  },
  'gpt-5-codex',
);

const route = await client.route(payload);
```

The shared model catalog includes the launch-priority OpenRouter-facing models
from Wavemill: Claude, GPT, DeepSeek, Qwen, Kimi, GLM, Gemini, Llama, Mistral,
and Grok families. Unknown strings are still accepted by `@hokusai/router` as
opaque external models when callers provide their own candidate pool.

For a complete offline version of this pattern, run the reference harness:

```sh
pnpm --filter @hokusai/reference-harness start
```

It prints the full nine-step route/report flow using fake data and a mock client.

## Example: Claude Code

Claude Code is the most complete end-user plugin surface in this repository. Install Hokusai from the repository marketplace:

```sh
/plugin marketplace add Hokusai-protocol/hokusai-sdk
/plugin install hokusai@hokusai
/reload-plugins
```

Set your API key. The plugin will not enable outcome contribution unless you opt in separately:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
hokusai-doctor
```

The intended eventual public path is the Claude Code community marketplace. Until that listing is accepted, use the repository marketplace as the default self-hosted install path.

If you host a standalone marketplace catalog, the same install flow works with a direct `marketplace.json` URL:

```sh
/plugin marketplace add https://.../marketplace.json
/plugin install hokusai@hokusai
/reload-plugins
```

### Manual install / release smoke test

Use the release zip flow when you want to verify the published artifact directly:

```sh
curl -L -o hokusai-claude-code-plugin-latest.zip https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip && \
curl -L -o hokusai-claude-code-plugin-latest.zip.sha256 https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip.sha256 && \
sha256sum -c hokusai-claude-code-plugin-latest.zip.sha256 && \
unzip hokusai-claude-code-plugin-latest.zip && \
claude --plugin-dir ./hokusai-claude-code-plugin/plugin
```

Route a task in Claude Code:

```text
/hokusai:route refactor the auth middleware to use the new policy engine
```

Optionally opt in to anonymized outcome reporting after your first route:

```text
/hokusai:privacy reporting on
```

```text
/hokusai:report --use-latest --recommended-model claude-sonnet-4-6 --actual-model claude-sonnet-4-6 --accepted --status succeeded --rating 4
```

The report command previews the anonymized payload first and sends only after
approval. Use `/hokusai:privacy list`, `/hokusai:privacy preview <correlation-id>`,
and `/hokusai:privacy audit` to inspect local routing records and submission
history from Claude Code.

See [packages/adapter-claude-code/README.md](packages/adapter-claude-code/README.md) for Claude Code-specific install, privacy, doctor, and command details.

## Example: Codex

The Codex adapter now ships an installable plugin that bundles skills plus an MCP stdio server:

```sh
curl -L -o hokusai-codex-plugin-latest.zip https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-codex-plugin-latest.zip && \
curl -L -o hokusai-codex-plugin-latest.zip.sha256 https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-codex-plugin-latest.zip.sha256 && \
sha256sum -c hokusai-codex-plugin-latest.zip.sha256 && \
unzip hokusai-codex-plugin-latest.zip && \
codex plugin marketplace add ./hokusai-codex-plugin && \
codex plugin add hokusai@hokusai
```

The install id is `<plugin>@<marketplace>`; a bare `codex plugin add hokusai`
is rejected. Confirm the plugin registered:

```sh
codex plugin list
```

Configure Hokusai and verify the install from Codex:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
```

```text
$hokusai-doctor
```

Codex-facing library consumers can still use the typed adapter surface directly:

```ts
import { createCodexAdapter } from '@hokusai/adapter-codex';
import { HokusaiClient } from '@hokusai/core';

const apiClient = new HokusaiClient({ apiKey: process.env.HOKUSAI_API_KEY });

const codex = createCodexAdapter({
  defaultModel: 'gpt-5-codex',
  pluginId: 'hokusai.codex',
  apiClient,
});

console.log(codex.commands.map((command) => command.name));
```

Use `routeTaskWithCodex()`, `previewRoutePayloadWithCodex()`, `submitOutcomeWithCodex()`, and `runMcpServer()` when embedding or testing the Codex plugin surface directly.

See [packages/adapter-codex/README.md](packages/adapter-codex/README.md) for the package surface and [docs/privacy-model.md](docs/privacy-model.md) for the shared privacy and consent model.

## Example: Wavemill

The Wavemill adapter is the richer reference implementation for harnesses that need replay-aware routing and typed outcome extensions:

```ts
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
} from '@hokusai/core';
import {
  reportWavemillOutcome,
  routeWithWavemill,
} from '@hokusai/adapter-wavemill';

const client = new HokusaiClient({ apiKey: process.env.HOKUSAI_API_KEY });
const dispatchBuilder = new HokusaiDispatchBuilder({
  consent: {
    subjectId: 'developer-123',
    grantedScopes: ['task-execution'],
  },
  modelRegistry: new InMemoryModelRegistry([
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt',
      capabilities: ['reasoning', 'tool-use'],
      default: true,
    },
  ]),
});

await routeWithWavemill({
  client,
  dispatchBuilder,
  task: {
    id: 'task-1',
    prompt: 'Implement the planned adapter change.',
  },
  modelId: 'gpt-5-codex',
});

await reportWavemillOutcome({
  client,
  input: {
    correlationId: 'route_123',
    recommendedModel: 'gpt-5-codex',
    actualModel: 'gpt-5-codex',
    recommendationAccepted: true,
    completionStatus: 'succeeded',
    latencyBucket: 'medium',
    costBucket: 'medium',
    tokenBucket: 'medium',
    spendUsdBucket: '0.50-1.00',
    wallClockMinutes: 18,
  },
});
```

See [packages/adapter-wavemill/README.md](packages/adapter-wavemill/README.md) for the Wavemill-specific reference details.

## Privacy And Consent

Routing requires an API key. Outcome reporting is separately consent-gated.

- Outcome reporting requires separate telemetry consent.
- Shared adapters use `HOKUSAI_OUTCOME_OPT_IN` for outcome submission opt-in.
- Raw task text, raw code, raw prompts, terminal logs, and customer data should not be stored in local correlation records.
- Adapter previews expose redacted payloads before submission.
- The Claude Code plugin includes post-run outcome prompt hooks. The hooks detect likely success, then prompt for a report tied to the latest Hokusai route; they never submit without `HOKUSAI_OUTCOME_OPT_IN=true` and explicit user approval in the report flow. The Codex plugin ships no hooks: Codex discovers `hooks/hooks.json` by convention and trust-gates it at install, so the MVP does not ask you to trust one. Report from Codex with `$hokusai-report`.

See [docs/privacy-model.md](docs/privacy-model.md) for the full shared policy, including local storage denylist and retention behavior.

Claude Code exposes these controls through environment variables and the `hokusai-privacy` CLI:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here

hokusai-privacy reporting on
hokusai-privacy list
hokusai-privacy preview <correlation-id>
hokusai-privacy audit
hokusai-privacy reporting status
```

See [docs/privacy-model.md](docs/privacy-model.md) for the full privacy and local-state model.

## What Gets Sent

Route requests are converted into the Technical Task Router prediction payload before transport:

```json
{
  "inputs": {
    "task_type": "refactor",
    "language": "TypeScript",
    "domain": "sdk",
    "coder_model": "gpt-5-codex",
    "route_source": "hokusai-sdk"
  }
}
```

The SDK fills all documented router input fields, using empty strings when a harness has no signal for an optional field. Harnesses can pass richer router fields through task metadata. Task packet builders still track:

- `schemaVersion`
- `userIntent`
- `taskFamily`
- `reasoningDepth`
- optional repository, language, framework, tool, constraint, model, and provider signals

Outcome reports are opt-in and anonymized. They include:

- `schemaVersion`
- `correlationId`
- `recommendedModel`
- `actualModel`
- `recommendationAccepted`
- `completionStatus`
- latency, cost, and token buckets
- optional build/test metadata, redacted notes, and versioned extensions

See [docs/payload-schemas.md](docs/payload-schemas.md) for the complete wire schema.

## Package Map

- `packages/core`: shared contracts, schemas, consent/config helpers, redaction, client, model registry, storage, fixtures, and conformance utilities
- `packages/adapter-claude-code`: Claude Code plugin, CLI commands, doctor/privacy/report tooling, and Claude-specific adapter
- `packages/adapter-codex`: Codex command descriptors, task context builders, outcome builders, model provider, and harness adapter
- `packages/adapter-wavemill`: Wavemill reference adapter with replay-aware task/outcome helpers and conformance fixtures
- `examples/reference-harness`: minimal offline composition template for generic harness authors

## Development

Contributor setup is separate from plugin installation:

```sh
pnpm install
pnpm lint
pnpm -r typecheck
pnpm check:boundaries
pnpm -r build
pnpm -r test
```

## Documentation

- [SDK Overview](docs/sdk-overview.md) - package installation, public interfaces, core vs adapter APIs, schemas, model mapping, and adapter lifecycle
- [Integration Guide](docs/integration-guide.md) - recommended integration flow and adapter reuse
- [Reference Pattern](docs/reference-pattern.md) - the route/report loop with code examples
- [Payload Schemas](docs/payload-schemas.md) - wire schema reference for route request and outcome report
- [Privacy Model](docs/privacy-model.md) - consent settings, redaction, and local data retention
- [Versioning Policy](docs/versioning-policy.md) - semver rules, schema-version relationship, breaking-change taxonomy, and deprecation policy
- [Release Checklist](docs/release-checklist.md) - pre-release gating, conformance tests, fixture updates, and release channels
- [Release Notes](docs/release-notes.md) - version history and release commands
- [Claude Code Adapter](packages/adapter-claude-code/README.md) - Claude Code adapter package reference
- [Wavemill Adapter](packages/adapter-wavemill/README.md) - Wavemill reference adapter package details
- [Reference Harness](examples/reference-harness/README.md) - minimal offline harness composition example
