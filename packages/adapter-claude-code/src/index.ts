import { HokusaiClient, type HokusaiClientOptions, type HokusaiTaskInput } from '@hokusai/core';

export interface ClaudeCodeAdapterOptions {
  modelId: string;
  packageVersion: string;
  client?: HokusaiClient;
  clientOptions?: HokusaiClientOptions;
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
  client: HokusaiClient;
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createClaudeCodeAdapter(
  options: ClaudeCodeAdapterOptions,
): ClaudeCodeAdapter {
  const client =
    options.client ?? new HokusaiClient(options.clientOptions ?? {});
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
    client,
    toTaskReference(task) {
      return `claude-code:${task.id}`;
    },
  };
}
