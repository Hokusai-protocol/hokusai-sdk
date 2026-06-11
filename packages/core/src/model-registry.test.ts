import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODELS,
  InMemoryModelRegistry,
  ModelMappingError,
  OPENAI_MODELS,
  mapRecommendation,
  type ModelDefinition,
  validateRecommendedModel,
} from './model-registry.js';

describe('InMemoryModelRegistry', () => {
  const models: ModelDefinition[] = [
    {
      id: 'model-a',
      provider: 'openai',
      family: 'gpt',
      aliases: ['alpha'],
      capabilities: ['reasoning'],
      default: true,
    },
    {
      id: 'model-b',
      provider: 'anthropic',
      family: 'claude',
      aliases: ['beta'],
      capabilities: ['tool-use'],
      available: false,
    },
    {
      id: 'model-c',
      provider: 'anthropic',
      family: 'claude',
      aliases: ['gamma'],
      capabilities: ['streaming'],
    },
  ];

  it('resolves explicit and default models', () => {
    const registry = new InMemoryModelRegistry(models);

    expect(registry.get('model-a')?.provider).toBe('openai');
    expect(registry.getDefault()?.id).toBe('model-a');
    expect(registry.list()).toHaveLength(3);
  });

  it('resolves models by id and alias case-insensitively', () => {
    const registry = new InMemoryModelRegistry(models);

    expect(registry.resolve('MODEL-A')?.id).toBe('model-a');
    expect(registry.resolve('BeTa')?.id).toBe('model-b');
    expect(registry.resolve('')).toBeUndefined();
    expect(registry.resolve('missing')).toBeUndefined();
  });

  it('lists only available models', () => {
    const registry = new InMemoryModelRegistry(models);

    expect(registry.listAvailable().map((model) => model.id)).toEqual([
      'model-a',
      'model-c',
    ]);
  });

  it('rejects duplicate ids, duplicate aliases, and alias-id collisions', () => {
    expect(
      () =>
        new InMemoryModelRegistry([
          ...models,
          {
            id: 'model-a',
            provider: 'other',
            family: 'other',
            capabilities: ['reasoning'],
          },
        ]),
    ).toThrow(/model-a/i);

    expect(
      () =>
        new InMemoryModelRegistry([
          ...models,
          {
            id: 'model-d',
            provider: 'other',
            family: 'other',
            aliases: ['alpha'],
            capabilities: ['reasoning'],
          },
        ]),
    ).toThrow(/alpha/i);

    expect(
      () =>
        new InMemoryModelRegistry([
          ...models,
          {
            id: 'model-d',
            provider: 'other',
            family: 'other',
            aliases: ['model-c'],
            capabilities: ['reasoning'],
          },
        ]),
    ).toThrow(/model-c/i);

    expect(
      () =>
        new InMemoryModelRegistry([
          ...models,
          {
            id: 'alpha',
            provider: 'other',
            family: 'other',
            capabilities: ['reasoning'],
          },
        ]),
    ).toThrow(/alpha/i);
  });
});

describe('mapRecommendation', () => {
  const registry = new InMemoryModelRegistry([
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt',
      aliases: ['codex'],
      capabilities: ['reasoning', 'tool-use'],
    },
    {
      id: 'claude-sonnet-4-6',
      provider: 'anthropic',
      family: 'claude',
      aliases: ['sonnet'],
      capabilities: ['reasoning', 'tool-use'],
    },
    {
      id: 'claude-opus-4-8',
      provider: 'anthropic',
      family: 'claude',
      aliases: ['opus'],
      capabilities: ['reasoning', 'tool-use'],
      available: false,
    },
  ]);

  it('resolves model recommendations by id and alias', () => {
    expect(
      mapRecommendation(
        { model: 'gpt-5-codex' },
        { registry, requireAvailable: true },
      ).id,
    ).toBe('gpt-5-codex');

    expect(
      mapRecommendation({ model: 'SONNET' }, { registry, requireAvailable: true })
        .id,
    ).toBe('claude-sonnet-4-6');
  });

  it('throws structured unknown-model errors with suggestions', () => {
    expect.assertions(3);

    try {
      mapRecommendation({ model: 'missing' }, { registry, requireAvailable: true });
    } catch (error) {
      expect(error).toBeInstanceOf(ModelMappingError);
      expect((error as ModelMappingError).code).toBe('UNKNOWN_MODEL');
      expect((error as ModelMappingError).suggestions.length).toBeGreaterThan(0);
    }
  });

  it('rejects disallowed providers and filters suggestions', () => {
    expect.assertions(3);

    try {
      mapRecommendation(
        { model: 'gpt-5-codex' },
        {
          registry,
          allowedProviders: ['anthropic'],
          requireAvailable: true,
        },
      );
    } catch (error) {
      expect((error as ModelMappingError).code).toBe('PROVIDER_NOT_ALLOWED');
      expect((error as ModelMappingError).suggestions).toEqual([
        'claude-sonnet-4-6',
      ]);
      expect((error as ModelMappingError).suggestions).not.toContain(
        'gpt-5-codex',
      );
    }
  });

  it('rejects unavailable models only when availability is required', () => {
    expect.assertions(3);

    try {
      mapRecommendation({ model: 'opus' }, { registry, requireAvailable: true });
    } catch (error) {
      expect((error as ModelMappingError).code).toBe('MODEL_UNAVAILABLE');
      expect((error as ModelMappingError).suggestions).not.toContain(
        'claude-opus-4-8',
      );
    }

    expect(
      mapRecommendation({ model: 'opus' }, { registry, requireAvailable: false })
        .id,
    ).toBe('claude-opus-4-8');
  });

  it('rejects empty and non-string model input', () => {
    expect.assertions(2);

    try {
      mapRecommendation({ model: '' }, { registry, requireAvailable: true });
    } catch (error) {
      expect((error as ModelMappingError).code).toBe('UNKNOWN_MODEL');
    }

    try {
      mapRecommendation({ model: 123 }, { registry, requireAvailable: true });
    } catch (error) {
      expect((error as ModelMappingError).code).toBe('UNKNOWN_MODEL');
    }
  });
});

describe('validateRecommendedModel', () => {
  const registry = new InMemoryModelRegistry([
    ...ANTHROPIC_MODELS,
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt',
      aliases: ['codex'],
      capabilities: ['reasoning', 'tool-use'],
    },
  ]);

  it('accepts exact allowlisted identifiers', () => {
    expect(
      validateRecommendedModel('claude-sonnet-4-6', {
        allowlist: ['claude-sonnet-4-6'],
        registry,
      }),
    ).toEqual({
      ok: true,
      modelId: 'claude-sonnet-4-6',
    });
  });

  it('maps aliases to canonical allowlisted identifiers', () => {
    expect(
      validateRecommendedModel('sonnet', {
        allowlist: ['claude-sonnet-4-6'],
        registry,
      }),
    ).toEqual({
      ok: true,
      modelId: 'claude-sonnet-4-6',
      mappedFrom: 'sonnet',
    });
  });

  it('rejects non-anthropic models', () => {
    expect(
      validateRecommendedModel('gpt-5-codex', {
        allowlist: ['claude-sonnet-4-6'],
        registry,
      }),
    ).toEqual({
      ok: false,
      reason: 'not-anthropic',
      suggestions: ['claude-sonnet-4-6'],
    });
  });

  it('rejects anthropic models outside the allowlist', () => {
    expect(
      validateRecommendedModel('claude-opus-4-8', {
        allowlist: ['claude-sonnet-4-6'],
        registry,
      }),
    ).toEqual({
      ok: false,
      reason: 'not-in-allowlist',
      suggestions: ['claude-sonnet-4-6'],
    });
  });

  it('rejects unknown model identifiers', () => {
    expect(
      validateRecommendedModel('', {
        allowlist: ['claude-sonnet-4-6'],
        registry,
      }),
    ).toEqual({
      ok: false,
      reason: 'unknown',
      suggestions: ['claude-sonnet-4-6'],
    });
  });
});

describe('OPENAI_MODELS', () => {
  it('contains only OpenAI models', () => {
    expect(OPENAI_MODELS.every((model) => model.provider === 'openai')).toBe(true);
  });

  it('resolves every available model and exposes a default', () => {
    const registry = new InMemoryModelRegistry(OPENAI_MODELS);

    expect(
      registry.listAvailable().map((model) => registry.resolve(model.id)?.id),
    ).toEqual(registry.listAvailable().map((model) => model.id));
    expect(OPENAI_MODELS).toContainEqual(
      expect.objectContaining({ id: registry.getDefault()?.id }),
    );
  });
});
