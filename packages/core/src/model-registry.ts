export type ModelCapability = 'reasoning' | 'streaming' | 'tool-use';

export interface ModelDefinition {
  id: string;
  provider: string;
  family: string;
  capabilities: ModelCapability[];
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
}

export class InMemoryModelRegistry implements ModelRegistry {
  readonly #models: ModelDefinition[];

  constructor(models: ModelDefinition[]) {
    this.#models = [...models];
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
}
