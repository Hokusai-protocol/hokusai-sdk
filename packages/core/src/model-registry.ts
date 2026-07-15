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

export function listSupportedModelIds(
  registry: ModelRegistry,
  options: {
    allowedProviders?: string[];
    requireAvailable?: boolean;
  } = {},
): string[] {
  const models =
    options.requireAvailable === false
      ? registry.list()
      : registry.listAvailable();

  return models
    .filter((model) => options.allowedProviders?.includes(model.provider) ?? true)
    .map((model) => model.id);
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
    aliases: ['opus', 'claude-opus', 'anthropic/claude-opus-4.8'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-4-6',
    family: 'claude',
    aliases: ['sonnet', 'claude-sonnet', 'anthropic/claude-sonnet-4.6'],
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

export const OPENAI_MODELS: ModelDefinition[] = [
  {
    provider: 'openai',
    id: 'gpt-5-codex',
    family: 'gpt-5',
    aliases: ['codex'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
    default: true,
  },
  {
    provider: 'openai',
    id: 'gpt-5',
    family: 'gpt-5',
    aliases: ['openai/gpt-5'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'openai',
    id: 'gpt-5-mini',
    family: 'gpt-5',
    aliases: ['openai/gpt-5-mini'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
];

/**
 * Launch-priority non-Anthropic/non-OpenAI models from Wavemill's Model 30
 * OpenRouter catalog fixture. The canonical id is the Wavemill alias; the
 * OpenRouter id is kept as an alias so callers can use either spelling.
 */
export const OPENROUTER_PRIORITY_MODELS: ModelDefinition[] = [
  {
    provider: 'deepseek',
    id: 'deepseek-r1',
    family: 'deepseek',
    aliases: ['deepseek/deepseek-r1'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'deepseek',
    id: 'deepseek-v3',
    family: 'deepseek',
    aliases: ['deepseek/deepseek-chat-v3'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'deepseek',
    id: 'deepseek-coder-v2',
    family: 'deepseek',
    aliases: ['deepseek/deepseek-coder-v2-instruct'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'qwen',
    id: 'qwen-2.5-coder-32b',
    family: 'qwen',
    aliases: ['qwen/qwen-2.5-coder-32b-instruct', 'qwen2.5-coder-32b'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'qwen',
    id: 'qwen-3-coder',
    family: 'qwen',
    aliases: ['qwen/qwen3-coder'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'qwen',
    id: 'qwen-3-235b',
    family: 'qwen',
    aliases: ['qwen/qwen3-235b-a22b-instruct'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'qwen',
    id: 'qwen-2.5-72b',
    family: 'qwen',
    aliases: ['qwen/qwen-2.5-72b-instruct'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'moonshotai',
    id: 'kimi-k2',
    family: 'kimi',
    aliases: ['moonshotai/kimi-k2'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'moonshotai',
    id: 'kimi-k2.7-code',
    family: 'kimi',
    aliases: ['moonshotai/kimi-k2.7-code'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'moonshotai',
    id: 'kimi-k2-thinking',
    family: 'kimi',
    aliases: ['moonshotai/kimi-k2-thinking'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'z-ai',
    id: 'glm-5.2',
    family: 'glm',
    aliases: ['z-ai/glm-5.2'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'google',
    id: 'gemini-2.5-pro',
    family: 'gemini',
    aliases: ['google/gemini-2.5-pro'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'google',
    id: 'gemini-2.5-flash',
    family: 'gemini',
    aliases: ['google/gemini-2.5-flash'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'google',
    id: 'gemini-2.0-flash',
    family: 'gemini',
    aliases: ['google/gemini-2.0-flash-001'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'meta',
    id: 'llama-3.3-70b',
    family: 'llama',
    aliases: ['meta-llama/llama-3.3-70b-instruct'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'meta',
    id: 'llama-4-maverick',
    family: 'llama',
    aliases: ['meta-llama/llama-4-maverick'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'meta',
    id: 'llama-4-scout',
    family: 'llama',
    aliases: ['meta-llama/llama-4-scout'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'mistralai',
    id: 'mistral-large-2',
    family: 'mistral',
    aliases: ['mistralai/mistral-large-2411'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'mistralai',
    id: 'mistral-medium-3',
    family: 'mistral',
    aliases: ['mistralai/mistral-medium-3'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'mistralai',
    id: 'devstral-small',
    family: 'mistral',
    aliases: ['mistralai/devstral-small'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'mistralai',
    id: 'devstral-medium',
    family: 'mistral',
    aliases: ['mistralai/devstral-medium'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'x-ai',
    id: 'grok-code-fast',
    family: 'grok',
    aliases: ['x-ai/grok-code-fast-1'],
    capabilities: ['tool-use'],
    available: true,
  },
];

export const PRIORITY_MODELS: ModelDefinition[] = [
  {
    provider: 'anthropic',
    id: 'claude-opus-4-8',
    family: 'claude',
    aliases: ['anthropic/claude-opus-4.8'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-opus-4-7',
    family: 'claude',
    aliases: ['anthropic/claude-opus-4.7'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-5',
    family: 'claude',
    aliases: ['anthropic/claude-sonnet-5'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-4-6',
    family: 'claude',
    aliases: ['anthropic/claude-sonnet-4.6'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-haiku-4-5',
    family: 'claude',
    aliases: ['anthropic/claude-haiku-4.5'],
    capabilities: ['streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'anthropic',
    id: 'claude-fable-5',
    family: 'claude',
    aliases: ['anthropic/claude-fable-5'],
    capabilities: ['reasoning', 'streaming', 'tool-use'],
    available: true,
  },
  {
    provider: 'openai',
    id: 'gpt-5.5',
    family: 'gpt',
    aliases: ['openai/gpt-5.5'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'openai',
    id: 'gpt-5',
    family: 'gpt',
    aliases: ['openai/gpt-5'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'openai',
    id: 'gpt-5-mini',
    family: 'gpt',
    aliases: ['openai/gpt-5-mini'],
    capabilities: ['reasoning', 'tool-use'],
    available: true,
  },
  {
    provider: 'openai',
    id: 'gpt-4.1',
    family: 'gpt',
    aliases: ['openai/gpt-4.1'],
    capabilities: ['tool-use'],
    available: true,
  },
  {
    provider: 'openai',
    id: 'o3-mini',
    family: 'gpt',
    aliases: ['openai/o3-mini'],
    capabilities: ['reasoning', 'tool-use'],
    available: false,
  },
  ...OPENROUTER_PRIORITY_MODELS,
];
