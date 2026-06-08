import { describe, expect, it } from 'vitest';
import { InMemoryModelRegistry } from './model-registry.js';

describe('InMemoryModelRegistry', () => {
  it('resolves explicit and default models', () => {
    const registry = new InMemoryModelRegistry([
      {
        id: 'model-a',
        provider: 'openai',
        family: 'gpt',
        capabilities: ['reasoning'],
      },
      {
        id: 'model-b',
        provider: 'anthropic',
        family: 'claude',
        capabilities: ['tool-use'],
        default: true,
      },
    ]);

    expect(registry.get('model-a')?.provider).toBe('openai');
    expect(registry.getDefault()?.id).toBe('model-b');
    expect(registry.list()).toHaveLength(2);
  });
});
