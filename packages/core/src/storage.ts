export interface CorrelationRecord {
  taskId: string;
  correlationId: string;
  createdAt: string;
}

export interface CorrelationStorage {
  get(taskId: string): Promise<CorrelationRecord | undefined>;
  set(record: CorrelationRecord): Promise<void>;
}

export class InMemoryCorrelationStorage implements CorrelationStorage {
  readonly #records = new Map<string, CorrelationRecord>();

  get(taskId: string): Promise<CorrelationRecord | undefined> {
    return Promise.resolve(this.#records.get(taskId));
  }

  set(record: CorrelationRecord): Promise<void> {
    this.#records.set(record.taskId, record);
    return Promise.resolve();
  }
}
