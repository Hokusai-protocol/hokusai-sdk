import {
  HokusaiClient,
  type HokusaiClientOptions,
  type ConsentScope,
  type HokusaiTaskInput,
} from '@hokusai/core';

export interface CodexAdapterOptions {
  defaultModel: string;
  pluginId: string;
  client?: HokusaiClient;
  clientOptions?: HokusaiClientOptions;
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
  client: HokusaiClient;
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createCodexAdapter(options: CodexAdapterOptions): CodexAdapter {
  const client =
    options.client ?? new HokusaiClient(options.clientOptions ?? {});
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
    client,
    toTaskReference(task) {
      return `codex:${task.id}`;
    },
  };
}
