import { InMemoryModelRegistry, type ModelDefinition } from '@hokusai/core';

export const OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-5-codex',
    provider: 'openai',
    family: 'gpt-5',
    capabilities: ['reasoning', 'tool-use'],
    aliases: ['codex'],
    default: true,
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    family: 'gpt-5',
    capabilities: ['reasoning', 'tool-use'],
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    family: 'gpt-5',
    capabilities: ['reasoning', 'tool-use'],
  },
];

export function createOpenAiRegistry() {
  return new InMemoryModelRegistry(OPENAI_MODELS);
}
