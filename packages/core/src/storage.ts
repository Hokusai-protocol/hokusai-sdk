import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RetentionPolicy } from './consent.js';

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

export interface LocalCorrelationRecord {
  correlationId: string;
  packetHash: string;
  createdAt: number;
  metadata?: Record<string, string>;
}

export interface PayloadHashRecord {
  hash: string;
  algorithm: string;
  createdAt: number;
}

export type SubmissionAuditStatus = 'submitted' | 'failed' | 'skipped';
export type SubmissionAuditKind = 'routing' | 'outcome';

export interface SubmissionAuditEntry {
  id: string;
  kind: SubmissionAuditKind;
  correlationId: string;
  status: SubmissionAuditStatus;
  timestamp: number;
  error?: string;
}

export class RawPayloadRejectedError extends Error {
  constructor(fieldName: string) {
    super(`Raw payload field is not allowed in local storage: ${fieldName}`);
    this.name = 'RawPayloadRejectedError';
  }
}

export class StoreCorruptError extends Error {
  readonly filePath: string;

  constructor(filePath: string, cause?: unknown) {
    super(`Stored Hokusai state is corrupt: ${filePath}`);
    this.name = 'StoreCorruptError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

export interface LocalStore {
  putCorrelation(record: LocalCorrelationRecord): Promise<void>;
  getCorrelation(
    correlationId: string,
  ): Promise<LocalCorrelationRecord | undefined>;
  listCorrelations(): Promise<LocalCorrelationRecord[]>;
  deleteCorrelation(correlationId: string): Promise<void>;

  putPayloadHash(record: PayloadHashRecord): Promise<void>;
  listPayloadHashes(): Promise<PayloadHashRecord[]>;

  appendAudit(entry: SubmissionAuditEntry): Promise<void>;
  listAudit(): Promise<SubmissionAuditEntry[]>;

  pruneExpired(now: number, policy: RetentionPolicy): Promise<void>;
  clear(): Promise<void>;
}

const RAW_FIELD_NAMES = new Set([
  'rawTaskText',
  'rawCode',
  'rawLog',
  'prompt',
  'rawPrompt',
  'rawContent',
]);

function assertNoRawPayloadFields(record: object): void {
  for (const key of Object.keys(record)) {
    if (RAW_FIELD_NAMES.has(key)) {
      throw new RawPayloadRejectedError(key);
    }
  }
}

function cloneCorrelationRecord(
  record: LocalCorrelationRecord,
): LocalCorrelationRecord {
  if (record.metadata === undefined) {
    return { ...record };
  }

  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function pruneByRetention<T extends { createdAt: number }>(
  records: T[],
  now: number,
  policy: RetentionPolicy,
): T[] {
  const minCreatedAt =
    policy.maxAgeMs === undefined ? undefined : now - policy.maxAgeMs;
  let kept =
    minCreatedAt === undefined
      ? [...records]
      : records.filter((record) => record.createdAt >= minCreatedAt);

  if (policy.maxRecords !== undefined && kept.length > policy.maxRecords) {
    kept = kept
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-policy.maxRecords);
  }

  return kept;
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function readJsonFiles<T>(dirPath: string): Promise<T[]> {
  let fileNames: string[];

  try {
    fileNames = await readdir(dirPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const records = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        const filePath = join(dirPath, fileName);

        try {
          return JSON.parse(await readFile(filePath, 'utf8')) as T;
        } catch (error) {
          throw new StoreCorruptError(filePath, error);
        }
      }),
  );

  return records;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function removeFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export class InMemoryLocalStore implements LocalStore {
  readonly #correlations = new Map<string, LocalCorrelationRecord>();
  readonly #payloadHashes = new Map<string, PayloadHashRecord>();
  readonly #auditEntries = new Map<string, SubmissionAuditEntry>();

  putCorrelation(record: LocalCorrelationRecord): Promise<void> {
    try {
      assertNoRawPayloadFields(record);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    this.#correlations.set(
      record.correlationId,
      cloneCorrelationRecord(record),
    );
    return Promise.resolve();
  }

  getCorrelation(
    correlationId: string,
  ): Promise<LocalCorrelationRecord | undefined> {
    const record = this.#correlations.get(correlationId);
    return Promise.resolve(
      record ? cloneCorrelationRecord(record) : undefined,
    );
  }

  listCorrelations(): Promise<LocalCorrelationRecord[]> {
    return Promise.resolve(
      [...this.#correlations.values()]
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((record) => cloneCorrelationRecord(record)),
    );
  }

  deleteCorrelation(correlationId: string): Promise<void> {
    this.#correlations.delete(correlationId);
    return Promise.resolve();
  }

  putPayloadHash(record: PayloadHashRecord): Promise<void> {
    this.#payloadHashes.set(record.hash, { ...record });
    return Promise.resolve();
  }

  listPayloadHashes(): Promise<PayloadHashRecord[]> {
    return Promise.resolve(
      [...this.#payloadHashes.values()].sort(
        (left, right) => left.createdAt - right.createdAt,
      ),
    );
  }

  appendAudit(entry: SubmissionAuditEntry): Promise<void> {
    this.#auditEntries.set(entry.id, { ...entry });
    return Promise.resolve();
  }

  listAudit(): Promise<SubmissionAuditEntry[]> {
    return Promise.resolve(
      [...this.#auditEntries.values()].sort(
        (left, right) => left.timestamp - right.timestamp,
      ),
    );
  }

  async pruneExpired(now: number, policy: RetentionPolicy): Promise<void> {
    this.#replaceMap(
      this.#correlations,
      pruneByRetention(await this.listCorrelations(), now, policy),
      (record) => record.correlationId,
    );
    this.#replaceMap(
      this.#payloadHashes,
      pruneByRetention(await this.listPayloadHashes(), now, policy),
      (record) => record.hash,
    );
    this.#replaceMap(
      this.#auditEntries,
      pruneByRetention(
        (await this.listAudit()).map((entry) => ({
          ...entry,
          createdAt: entry.timestamp,
        })),
        now,
        policy,
      ).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        correlationId: entry.correlationId,
        status: entry.status,
        timestamp: entry.timestamp,
        ...(entry.error === undefined ? {} : { error: entry.error }),
      })),
      (entry) => entry.id,
    );
  }

  clear(): Promise<void> {
    this.#correlations.clear();
    this.#payloadHashes.clear();
    this.#auditEntries.clear();
    return Promise.resolve();
  }

  #replaceMap<T>(
    map: Map<string, T>,
    records: T[],
    getKey: (record: T) => string,
  ): void {
    map.clear();
    for (const record of records) {
      map.set(getKey(record), record);
    }
  }
}

export class FsLocalStore implements LocalStore {
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = baseDir;
  }

  async putCorrelation(record: LocalCorrelationRecord): Promise<void> {
    assertNoRawPayloadFields(record);
    await writeJsonFile(this.#correlationFilePath(record.correlationId), record);
  }

  async getCorrelation(
    correlationId: string,
  ): Promise<LocalCorrelationRecord | undefined> {
    const filePath = this.#correlationFilePath(correlationId);

    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as LocalCorrelationRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw new StoreCorruptError(filePath, error);
    }
  }

  async listCorrelations(): Promise<LocalCorrelationRecord[]> {
    return (await readJsonFiles<LocalCorrelationRecord>(this.#correlationsDir()))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async deleteCorrelation(correlationId: string): Promise<void> {
    await removeFile(this.#correlationFilePath(correlationId));
  }

  async putPayloadHash(record: PayloadHashRecord): Promise<void> {
    await writeJsonFile(this.#payloadHashFilePath(record.hash), record);
  }

  async listPayloadHashes(): Promise<PayloadHashRecord[]> {
    return (await readJsonFiles<PayloadHashRecord>(this.#hashesDir())).sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  }

  async appendAudit(entry: SubmissionAuditEntry): Promise<void> {
    await writeJsonFile(this.#auditFilePath(entry.id), entry);
  }

  async listAudit(): Promise<SubmissionAuditEntry[]> {
    return (await readJsonFiles<SubmissionAuditEntry>(this.#auditDir())).sort(
      (left, right) => left.timestamp - right.timestamp,
    );
  }

  async pruneExpired(now: number, policy: RetentionPolicy): Promise<void> {
    await this.#rewriteRecords(
      this.#correlationsDir(),
      await this.listCorrelations(),
      pruneByRetention(await this.listCorrelations(), now, policy),
      (record) => this.#correlationFilePath(record.correlationId),
    );
    await this.#rewriteRecords(
      this.#hashesDir(),
      await this.listPayloadHashes(),
      pruneByRetention(await this.listPayloadHashes(), now, policy),
      (record) => this.#payloadHashFilePath(record.hash),
    );

    const auditEntries = await this.listAudit();
    const keptAuditEntries = pruneByRetention(
      auditEntries.map((entry) => ({ ...entry, createdAt: entry.timestamp })),
      now,
      policy,
    ).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      correlationId: entry.correlationId,
      status: entry.status,
      timestamp: entry.timestamp,
      ...(entry.error === undefined ? {} : { error: entry.error }),
    }));

    await this.#rewriteRecords(
      this.#auditDir(),
      auditEntries,
      keptAuditEntries,
      (entry) => this.#auditFilePath(entry.id),
    );
  }

  async clear(): Promise<void> {
    await Promise.all([
      rm(this.#correlationsDir(), { recursive: true, force: true }),
      rm(this.#hashesDir(), { recursive: true, force: true }),
      rm(this.#auditDir(), { recursive: true, force: true }),
    ]);
  }

  #correlationsDir(): string {
    return join(this.#baseDir, 'correlations');
  }

  #hashesDir(): string {
    return join(this.#baseDir, 'hashes');
  }

  #auditDir(): string {
    return join(this.#baseDir, 'audit');
  }

  #correlationFilePath(correlationId: string): string {
    return join(this.#correlationsDir(), `${correlationId}.json`);
  }

  #payloadHashFilePath(hash: string): string {
    return join(this.#hashesDir(), `${hash}.json`);
  }

  #auditFilePath(id: string): string {
    return join(this.#auditDir(), `${id}.json`);
  }

  async #rewriteRecords<T>(
    dirPath: string,
    existing: T[],
    kept: T[],
    getFilePath: (record: T) => string,
  ): Promise<void> {
    const keptFilePaths = new Set(kept.map((record) => getFilePath(record)));
    await Promise.all(
      existing
        .map((record) => getFilePath(record))
        .filter((filePath) => !keptFilePaths.has(filePath))
        .map((filePath) => removeFile(filePath)),
    );

    if (kept.length === 0) {
      await rm(dirPath, { recursive: true, force: true });
      return;
    }

    await ensureDir(dirPath);
  }
}
