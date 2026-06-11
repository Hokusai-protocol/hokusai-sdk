import {
  InMemoryModelRegistry,
  OPENAI_MODELS,
  type ModelDefinition,
} from '@hokusai/core';

export { OPENAI_MODELS } from '@hokusai/core';

export function createOpenAiRegistry(
  models: ModelDefinition[] = OPENAI_MODELS,
): InMemoryModelRegistry {
  return new InMemoryModelRegistry(models);
}

export function createAllowlistedOpenAiRegistry(
  allowlist: readonly string[],
): InMemoryModelRegistry {
  const registry = createOpenAiRegistry();
  const allowlistedModelIds = new Set(
    allowlist
      .map((entry) => registry.resolve(entry))
      .filter(
        (model): model is ModelDefinition =>
          model !== undefined && model.provider === 'openai',
      )
      .map((model) => model.id),
  );

  if (allowlistedModelIds.size === 0) {
    return createOpenAiRegistry([]);
  }

  return createOpenAiRegistry(
    OPENAI_MODELS.filter((model) => allowlistedModelIds.has(model.id)),
  );
}
