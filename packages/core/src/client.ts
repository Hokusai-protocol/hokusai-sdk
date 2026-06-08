import { anonymizeText, type AnonymizationOptions } from './anonymization.js';
import {
  isConsentGranted,
  type ConsentConfig,
  type ConsentScope,
} from './consent.js';
import {
  type HokusaiDispatchPayload,
  type HokusaiTaskInput,
} from './schemas.js';
import {
  type ModelDefinition,
  type ModelRegistry,
  type ModelSelection,
} from './model-registry.js';
import {
  InMemoryCorrelationStorage,
  type CorrelationRecord,
  type CorrelationStorage,
} from './storage.js';

export class HokusaiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HokusaiClientError';
  }
}

export interface HokusaiClientOptions {
  consent: ConsentConfig;
  anonymization?: AnonymizationOptions;
  modelRegistry: ModelRegistry;
  storage?: CorrelationStorage;
  clock?: () => Date;
}

export class HokusaiClient {
  readonly #consent: ConsentConfig;
  readonly #anonymization: AnonymizationOptions | undefined;
  readonly #modelRegistry: ModelRegistry;
  readonly #storage: CorrelationStorage;
  readonly #clock: () => Date;

  constructor(options: HokusaiClientOptions) {
    this.#consent = options.consent;
    this.#anonymization = options.anonymization;
    this.#modelRegistry = options.modelRegistry;
    this.#storage = options.storage ?? new InMemoryCorrelationStorage();
    this.#clock = options.clock ?? (() => new Date());
  }

  async prepareDispatch(
    task: HokusaiTaskInput,
    modelId: string,
    scope: ConsentScope = 'task-execution',
  ): Promise<HokusaiDispatchPayload> {
    if (!isConsentGranted(this.#consent, scope)) {
      throw new HokusaiClientError(
        `Consent has not been granted for scope "${scope}".`,
      );
    }

    const model = this.#resolveModel(modelId);
    const correlationRecord = await this.#getOrCreateCorrelationRecord(task.id);
    const anonymizedPrompt = anonymizeText(
      task.prompt,
      this.#anonymization ?? {},
    );

    return {
      task,
      consent: {
        grantedScopes: [...this.#consent.grantedScopes],
        subjectId: this.#consent.subjectId,
      },
      model: this.#toModelSelection(model),
      correlation: correlationRecord,
      prompt: anonymizedPrompt.text,
      redactions: anonymizedPrompt.redactions,
      createdAt: this.#clock().toISOString(),
    };
  }

  #resolveModel(modelId: string): ModelDefinition {
    const model = this.#modelRegistry.get(modelId);
    if (!model) {
      throw new HokusaiClientError(`Unknown model "${modelId}".`);
    }

    return model;
  }

  #toModelSelection(model: ModelDefinition): ModelSelection {
    return {
      id: model.id,
      provider: model.provider,
      capabilities: [...model.capabilities],
    };
  }

  async #getOrCreateCorrelationRecord(taskId: string): Promise<CorrelationRecord> {
    const existing = await this.#storage.get(taskId);
    if (existing) {
      return existing;
    }

    const createdAt = this.#clock().toISOString();
    const correlationRecord = {
      taskId,
      correlationId: `${taskId}:${createdAt}`,
      createdAt,
    };

    await this.#storage.set(correlationRecord);
    return correlationRecord;
  }
}
