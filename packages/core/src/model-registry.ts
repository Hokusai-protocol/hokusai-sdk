export type ModelCapability = 'reasoning' | 'streaming' | 'tool-use';

export interface ModelDefinition {
  id: string;
  provider: string;
  family: string;
  capabilities: ModelCapability[];
  aliases?: string[];
  available?: boolean;
  default?: boolean;
}

export interface ModelSelection {
  id: string;
  provider: string;
  capabilities: ModelCapability[];
}

export interface ModelRegistry {
  get(modelId: string): ModelDefinition | undefined;
  getDefault(): ModelDefinition | undefined;
  list(): ModelDefinition[];
  resolve(idOrAlias: string): ModelDefinition | undefined;
  listAvailable(): ModelDefinition[];
}

export class InMemoryModelRegistry implements ModelRegistry {
  readonly #models: ModelDefinition[];
  readonly #idIndex = new Map<string, ModelDefinition>();
  readonly #aliasIndex = new Map<string, ModelDefinition>();

  constructor(models: ModelDefinition[]) {
    this.#models = [...models];

    for (const model of this.#models) {
      const normalizedId = this.#normalizeKey(model.id);

      if (normalizedId && this.#aliasIndex.has(normalizedId)) {
        throw new Error(`Duplicate model key: ${model.id}`);
      }

      this.#registerKey(this.#idIndex, model.id, model);

      for (const alias of model.aliases ?? []) {
        const normalizedAlias = this.#normalizeKey(alias);

        if (!normalizedAlias) {
          continue;
        }

        if (this.#idIndex.has(normalizedAlias)) {
          throw new Error(`Duplicate model key: ${alias}`);
        }

        this.#registerKey(this.#aliasIndex, alias, model);
      }
    }
  }

  get(modelId: string): ModelDefinition | undefined {
    return this.#models.find((model) => model.id === modelId);
  }

  getDefault(): ModelDefinition | undefined {
    return this.#models.find((model) => model.default) ?? this.#models[0];
  }

  list(): ModelDefinition[] {
    return [...this.#models];
  }

  resolve(idOrAlias: string): ModelDefinition | undefined {
    const normalizedKey = this.#normalizeKey(idOrAlias);

    if (!normalizedKey) {
      return undefined;
    }

    return this.#idIndex.get(normalizedKey) ?? this.#aliasIndex.get(normalizedKey);
  }

  listAvailable(): ModelDefinition[] {
    return this.#models.filter((model) => model.available !== false);
  }

  #registerKey(
    index: Map<string, ModelDefinition>,
    key: string,
    model: ModelDefinition,
  ): void {
    const normalizedKey = this.#normalizeKey(key);

    if (!normalizedKey) {
      return;
    }

    if (index.has(normalizedKey)) {
      throw new Error(`Duplicate model key: ${key}`);
    }

    index.set(normalizedKey, model);
  }

  #normalizeKey(key: string | undefined): string | undefined {
    const normalizedKey = key?.trim().toLowerCase();
    return normalizedKey ? normalizedKey : undefined;
  }
}

export type ModelMappingErrorCode =
  | 'UNKNOWN_MODEL'
  | 'PROVIDER_NOT_ALLOWED'
  | 'MODEL_UNAVAILABLE';

export class ModelMappingError extends Error {
  readonly code: ModelMappingErrorCode;
  readonly suggestions: string[];

  constructor(
    code: ModelMappingErrorCode,
    message: string,
    suggestions: string[],
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ModelMappingError';
    this.code = code;
    this.suggestions = suggestions;
  }
}

export interface MapRecommendationOptions {
  registry: ModelRegistry;
  allowedProviders?: string[];
  requireAvailable?: boolean;
}

export type ValidateRecommendedModelResult =
  | {
      ok: true;
      modelId: string;
      mappedFrom?: string;
    }
  | {
      ok: false;
      reason: 'unknown' | 'not-anthropic' | 'not-in-allowlist';
      suggestions: string[];
    };

export function mapRecommendation(
  recommendation: { model: unknown },
  options: MapRecommendationOptions,
): ModelDefinition {
  const modelId =
    typeof recommendation.model === 'string' ? recommendation.model.trim() : '';
  const allowedProviders = options.allowedProviders;
  const filteredSuggestions = (
    excludedModelId?: string,
  ): string[] => {
    return options.registry
      .listAvailable()
      .filter((model) => allowedProviders?.includes(model.provider) ?? true)
      .filter((model) => model.id !== excludedModelId)
      .map((model) => model.id);
  };

  if (!modelId) {
    throw new ModelMappingError(
      'UNKNOWN_MODEL',
      'Model recommendation must include a non-empty model id.',
      filteredSuggestions(),
    );
  }

  const descriptor = options.registry.resolve(modelId);

  if (!descriptor) {
    throw new ModelMappingError(
      'UNKNOWN_MODEL',
      `Unsupported model recommendation: ${modelId}.`,
      filteredSuggestions(),
    );
  }

  if (allowedProviders && !allowedProviders.includes(descriptor.provider)) {
    throw new ModelMappingError(
      'PROVIDER_NOT_ALLOWED',
      `Model ${descriptor.id} uses provider ${descriptor.provider}, which is not supported by this harness.`,
      filteredSuggestions(descriptor.id),
    );
  }

  if (options.requireAvailable && descriptor.available === false) {
    throw new ModelMappingError(
      'MODEL_UNAVAILABLE',
      `Model ${descriptor.id} is currently unavailable in this harness.`,
      filteredSuggestions(descriptor.id),
    );
  }

  return descriptor;
}

export function validateRecommendedModel(
  modelId: string,
  options: {
    allowlist: string[];
    registry?: ModelRegistry;
  },
): ValidateRecommendedModelResult {
  const registry = options.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const normalizedModelId = modelId.trim();
  const allowlistedIds = new Set(
    options.allowlist
      .map((entry) => registry.resolve(entry))
      .filter(
        (descriptor): descriptor is ModelDefinition =>
          descriptor !== undefined && descriptor.provider === 'anthropic',
      )
      .map((descriptor) => descriptor.id),
  );
  const suggestions = registry
    .listAvailable()
    .filter((descriptor) => descriptor.provider === 'anthropic')
    .filter((descriptor) => allowlistedIds.has(descriptor.id))
    .map((descriptor) => descriptor.id);

  if (normalizedModelId.length === 0) {
    return {
      ok: false,
      reason: 'unknown',
      suggestions,
    };
  }

  const descriptor = registry.resolve(normalizedModelId);
  if (!descriptor) {
    return {
      ok: false,
      reason: 'unknown',
      suggestions,
    };
  }

  if (descriptor.provider !== 'anthropic') {
    return {
      ok: false,
      reason: 'not-anthropic',
      suggestions: suggestions.filter((suggestion) => suggestion !== descriptor.id),
    };
  }

  if (!allowlistedIds.has(descriptor.id)) {
    return {
      ok: false,
      reason: 'not-in-allowlist',
      suggestions: suggestions.filter((suggestion) => suggestion !== descriptor.id),
    };
  }

  return normalizedModelId === descriptor.id
    ? {
        ok: true,
        modelId: descriptor.id,
      }
    : {
        ok: true,
        modelId: descriptor.id,
        mappedFrom: normalizedModelId,
      };
}

export const ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    provider: 'anthropic',
    id: 'claude-opus-4-8',
    family: 'claude',
    aliases: ['opus', 'claude-opus'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-4-6',
    family: 'claude',
    aliases: ['sonnet', 'claude-sonnet'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
    default: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-haiku-4-5-20251001',
    family: 'claude',
    aliases: ['haiku', 'claude-haiku'],
    capabilities: ['streaming', 'tool-use'],
    available: true,
  },
];
