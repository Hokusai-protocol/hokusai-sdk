import { createCodexAdapter } from '@hokusai/adapter-codex';
import { HokusaiDispatchBuilder, InMemoryModelRegistry } from '@hokusai/core';

export function createReferenceHarness() {
  const adapter = createCodexAdapter({
    defaultModel: 'gpt-5-codex',
    pluginId: 'hokusai.codex',
  });

  const client = new HokusaiDispatchBuilder({
    consent: {
      subjectId: 'reference-user',
      grantedScopes: ['task-execution'],
    },
    modelRegistry: new InMemoryModelRegistry([
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        family: 'gpt-5',
        capabilities: ['reasoning', 'tool-use'],
        default: true,
      },
    ]),
    clock: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  return {
    adapter,
    async prepare(prompt: string) {
      const payload = await client.prepareDispatch(
        {
          id: 'reference-task',
          prompt,
          metadata: {
            source: 'reference-harness',
          },
        },
        'gpt-5-codex',
      );

      return {
        adapter,
        payload,
      };
    },
  };
}
