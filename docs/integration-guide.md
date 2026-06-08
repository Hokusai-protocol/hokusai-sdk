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
  baseUrl: 'https://api.hokusai.app',
});
```

The client:

- sends `Authorization`, request ID, and SDK version headers
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
  packageVersion: '0.1.0',
  apiClient,
});
createWavemillAdapter({ integrationId: 'wavemill', apiClient });
```

Wavemill also exposes `buildWavemillTaskPacket`, `previewWavemillTaskPacket`, `buildWavemillOutcomeReport`, `wavemillConformanceFixtures`, and thin `routeWithWavemill` / `reportWavemillOutcome` helpers for harnesses that want a public reference implementation of replay-aware dispatch plus typed harness telemetry.

## Scope

- Adapters still expose typed factories and metadata only.
- Harness-specific config discovery and command output stay out of `@hokusai/core`.
- Private Wavemill code is out of scope for this repository.

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
