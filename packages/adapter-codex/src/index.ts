import type {
  ConsentScope,
  HarnessAdapter,
  HokusaiTaskInput,
} from '@hokusai/core';

export interface CodexAdapterOptions {
  defaultModel: string;
  pluginId: string;
}

export interface CodexAdapter {
  harness: 'codex';
  commands: Array<{
    name: 'hokusai:run';
    consentScope: ConsentScope;
  }>;
  manifest: {
    pluginId: string;
    defaultModel: string;
  };
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createCodexAdapter(options: CodexAdapterOptions): CodexAdapter {
  return {
    harness: 'codex',
    commands: [
      {
        name: 'hokusai:run',
        consentScope: 'task-execution',
      },
    ],
    manifest: {
      pluginId: options.pluginId,
      defaultModel: options.defaultModel,
    },
    toTaskReference(task) {
      return `codex:${task.id}`;
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
            prompt: 'Codex task',
          },
          harness: {
            name: 'codex',
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
            id: 'gpt-5-codex',
            label: 'GPT-5 Codex',
          },
        ],
      });
    },
    mapModel(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          id: 'gpt-5-codex',
          provider: 'openai',
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
          summary: 'Accepted by Codex',
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
