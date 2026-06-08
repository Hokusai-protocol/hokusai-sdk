import type { HarnessAdapter, HokusaiTaskInput } from '@hokusai/core';

export interface ClaudeCodeAdapterOptions {
  modelId: string;
  packageVersion: string;
}

export interface ClaudeCodeAdapter {
  harness: 'claude-code';
  commands: Array<{
    name: 'hokusai.run';
    description: string;
  }>;
  manifest: {
    entrypoint: 'hokusai';
    modelId: string;
    version: string;
  };
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createClaudeCodeAdapter(
  options: ClaudeCodeAdapterOptions,
): ClaudeCodeAdapter {
  return {
    harness: 'claude-code',
    commands: [
      {
        name: 'hokusai.run',
        description: 'Dispatch a Hokusai task from Claude Code.',
      },
    ],
    manifest: {
      entrypoint: 'hokusai',
      modelId: options.modelId,
      version: options.packageVersion,
    },
    toTaskReference(task) {
      return `claude-code:${task.id}`;
    },
  };
}

void ({
  context: {
    collectTaskContext() {
      return Promise.resolve({
        ok: true,
        value: {
          task: {
            id: 'task-1',
            prompt: 'Claude Code task',
          },
          harness: {
            name: 'claude-code',
          },
        },
      });
    },
  },
  models: {
    discoverModels(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: [
          {
            id: 'claude-sonnet-4',
            label: 'Claude Sonnet 4',
          },
        ],
      });
    },
    mapModel(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          id: 'claude-sonnet-4',
          provider: 'anthropic',
          capabilities: ['reasoning', 'tool-use'],
        },
      });
    },
  },
  recommendations: {
    displayRecommendation() {
      return {
        ok: true,
        value: undefined,
      };
    },
  },
  outcomes: {
    collectOutcome(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          taskId: 'task-1',
          status: 'accepted',
          summary: 'Accepted by Claude Code',
        },
      });
    },
  },
  payloads: {
    previewPayload(request) {
      return {
        ok: true,
        value: {
          summary: `Preview ${request.payload.task.id}`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        },
      };
    },
  },
  consent: {
    promptConsent(request) {
      return Promise.resolve({
        ok: true,
        value: {
          outcome: 'granted',
          scope: request.scope,
        },
      });
    },
  },
  storage: {
    get(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    set(key, value) {
      void key;
      void value;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    delete(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
  },
} satisfies HarnessAdapter);
