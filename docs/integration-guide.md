# Integration Guide

This repository is intentionally split between reusable contracts and harness adapters.

## Recommended integration flow

1. Depend on `@hokusai/core` for the shared `HokusaiClient`, payload types, validation helpers, and typed error classes.
2. Choose an adapter package when a harness needs opinionated command or manifest metadata.
3. Use `HokusaiDispatchBuilder` only when you need the offline dispatch-preparation helper.

## Shared API client

```ts
import { HokusaiClient } from '@hokusai/core';

const client = new HokusaiClient({
  apiKey: 'k_prod_xxx',
});
```

The client:

- sends `Authorization`, request ID, and SDK version headers
- routes tasks to the Technical Task Router prediction endpoint at `https://api.hokus.ai/api/v1/models/30/predict`
- validates route and outcome payloads before any network call
- supports dry-run validation via `{ dryRun: true }`
- retries network failures, `429`, and `5xx` responses with backoff

For tests, inject a transport instead of mocking globals:

```ts
const client = new HokusaiClient({
  apiKey: 'k_test',
  transport: async () => ({
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify({
        routeId: 'route_123',
        taskId: 'task-1',
        status: 'accepted',
      }),
  }),
});
```

## Adapter reuse

All three adapters accept the same optional shared client instance:

```ts
import { createCodexAdapter } from '@hokusai/adapter-codex';
import { createClaudeCodeAdapter } from '@hokusai/adapter-claude-code';
import {
  createWavemillAdapter,
  reportWavemillOutcome,
  routeWithWavemill,
} from '@hokusai/adapter-wavemill';

const apiClient = new HokusaiClient({ apiKey: 'k_prod_xxx' });

createCodexAdapter({
  defaultModel: 'gpt-5-codex',
  pluginId: 'hokusai.codex',
  apiClient,
});
createClaudeCodeAdapter({
  modelId: 'claude-sonnet',
  packageVersion: '0.1.1',
  apiClient,
});
createWavemillAdapter({ integrationId: 'wavemill', apiClient });
```

Wavemill also exposes `buildWavemillTaskPacket`, `previewWavemillTaskPacket`, `buildWavemillOutcomeReport`, `wavemillConformanceFixtures`, and thin `routeWithWavemill` / `reportWavemillOutcome` helpers for harnesses that want a public reference implementation of replay-aware dispatch plus typed harness telemetry.

### Codex integration surface

The Codex adapter ships an installable plugin with an MCP stdio server. The available tools are `hokusai_route`, `hokusai_preview_route_payload`, `hokusai_submit_outcome`, `hokusai_latest_route`, `hokusai_privacy_status`, and `hokusai_prompt_outcome_contribution`. Bundled skills call those tools rather than generating routing advice locally.

For a Codex-facing integration:

- Use `hokusai_preview_route_payload` before route submission so the user can inspect the redacted task payload.
- Use `hokusai_prompt_outcome_contribution` from optional completion hooks to prompt after likely success without submitting automatically.
- Use the `preview` field from `hokusai_submit_outcome` before confirming, so the user can inspect the anonymized outcome report.
- Apply the shared consent and storage rules from [privacy-model.md](privacy-model.md), especially `HOKUSAI_OUTCOME_OPT_IN` for outcome submission.

## Scope

- Adapters still expose typed factories and metadata only.
- Harness-specific config discovery and command output stay out of `@hokusai/core`.
- Private Wavemill code is out of scope for this repository.

## Reusable SDK Components vs. Harness-Specific Adapter Methods

Third-party harness authors implement the `HarnessAdapter` interface and wire it to reusable `@hokusai/core` utilities. The reference implementation in [`examples/reference-harness`](../examples/reference-harness/README.md) shows the smallest complete mocked flow.

Reusable `@hokusai/core` components:

- `HokusaiDispatchBuilder` prepares a route payload, applies consent checks, and redacts task text before submission.
- `InMemoryModelRegistry` and `mapRecommendation()` resolve Hokusai model ids into concrete model definitions.
- `buildTaskPacket()` creates a normalized task packet from generic task signals.
- `buildOutcomeReport()` and `previewOutcomePayload()` build and preview an anonymized outcome report.
- `InMemoryLocalStore` persists correlation ids and packet hashes without storing raw prompts.
- `HokusaiClient` is the real transport when a harness is ready to call the API instead of using the mock client from the example.

Harness-specific adapter methods:

- `context.collectTaskContext()` reads the current task, prompt, cwd, command, and harness metadata from your environment.
- `models.discoverModels()` lists the harness models a user can actually run.
- `models.mapModel()` maps a harness-specific model id or alias onto a Hokusai model definition.
- `recommendations.displayRecommendation()` renders the selected recommendation in the harness UI or CLI.
- `outcomes.collectOutcome()` gathers completion status and a user-visible summary from the harness runtime.
- `payloads.previewPayload()` decides how dispatch previews are shown before sending.
- `consent.promptConsent()` implements the harness-specific consent UX.
- `storage.get()/set()/delete()` bridges Hokusai state to the harness-local storage mechanism when needed.

The boundary is deliberate: core owns schemas, validation, anonymization, routing, reporting, and generic persistence primitives; the adapter owns runtime discovery, UX, and harness-specific execution details.

## Minimal adapter implementation

Core owns Hokusai task, payload, consent, validation, anonymization, outcome, and persistence contracts. Adapters stay responsible for harness-specific command surfaces, config paths, model labels, execution telemetry, and user-facing rendering.

```ts
import type {
  HarnessAdapter,
  HarnessConsentPromptRequest,
  HarnessModelMappingRequest,
  HarnessRecommendationDisplayRequest,
} from '@hokusai/core';

const memory = new Map<string, string>();

export const minimalAdapter = {
  context: {
    async collectTaskContext() {
      return {
        ok: true,
        value: {
          task: {
            id: 'task-1',
            prompt: 'Summarize the failing test output.',
          },
          harness: {
            name: 'reference-harness',
          },
          command: 'hokusai.run',
        },
      };
    },
  },
  models: {
    async discoverModels() {
      return {
        ok: true,
        value: [
          {
            id: 'gpt-5-codex',
            label: 'GPT-5 Codex',
          },
        ],
      };
    },
    async mapModel(request: HarnessModelMappingRequest) {
      const selectedModel = request.availableModels[0];
      if (!selectedModel) {
        return {
          ok: false,
          error: {
            code: 'no_models_available',
            message: 'No Hokusai models are available to map.',
          },
        };
      }

      return {
        ok: true,
        value: {
          id: selectedModel.id,
          provider: selectedModel.provider,
          capabilities: selectedModel.capabilities,
        },
      };
    },
  },
  recommendations: {
    displayRecommendation(_request: HarnessRecommendationDisplayRequest) {
      return {
        ok: true,
        value: undefined,
      };
    },
  },
  outcomes: {
    async collectOutcome(request) {
      return {
        ok: true,
        value: {
          taskId: request.task.id,
          status: 'completed',
          summary: 'Task completed in the harness.',
        },
      };
    },
  },
  payloads: {
    previewPayload(request) {
      return {
        ok: true,
        value: {
          summary: `Dispatch ${request.payload.task.id}`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        },
      };
    },
  },
  consent: {
    async promptConsent(request: HarnessConsentPromptRequest) {
      return {
        ok: true,
        value: {
          outcome: request.scope === 'task-execution' ? 'granted' : 'dismissed',
          scope: request.scope,
        },
      };
    },
  },
  storage: {
    async get(key) {
      return {
        ok: true,
        value: memory.get(key),
      };
    },
    async set(key, value) {
      memory.set(key, value);
      return {
        ok: true,
        value: undefined,
      };
    },
    async delete(key) {
      memory.delete(key);
      return {
        ok: true,
        value: undefined,
      };
    },
  },
} satisfies HarnessAdapter;
```

Wavemill is the richer reference point when your harness needs more than this minimal shape. It adds:

- correlation replay metadata for reruns
- customer-specific redaction lexicons
- typed outcome extensions like `spendUsdBucket` and `wallClockMinutes`
- a default TypeScript/pnpm-oriented task profile

That route/report flow stays on the shared core client:

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

const client = new HokusaiClient({ apiKey: 'k_prod_xxx' });
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
