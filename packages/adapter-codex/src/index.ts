import type { ConsentScope, HokusaiTaskInput } from '@hokusai/core';

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
