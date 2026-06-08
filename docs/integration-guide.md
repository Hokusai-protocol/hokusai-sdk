# Integration Guide

This repository is intentionally split between reusable contracts and harness adapters.

## Recommended integration flow

1. Depend on `@hokusai/core` for shared task, outcome, consent, anonymization, and correlation abstractions.
2. Choose an adapter package when a harness needs opinionated command or manifest metadata.
3. Use `examples/reference-harness` as the smallest offline composition template.

## Current scope

- Adapters expose typed factories and metadata only.
- Live harness APIs, authentication, transport, and protocol negotiation are future work.
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
