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

export class InvalidStoreIdError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(`Invalid local store identifier: ${id}`);
    this.name = 'InvalidStoreIdError';
    this.id = id;
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
  clearCorrelations(): Promise<void>;

  putPayloadHash(record: PayloadHashRecord): Promise<void>;
  listPayloadHashes(): Promise<PayloadHashRecord[]>;
  clearPayloadHashes(): Promise<void>;

  appendAudit(entry: SubmissionAuditEntry): Promise<void>;
  listAudit(): Promise<SubmissionAuditEntry[]>;
  clearAudit(): Promise<void>;

  putConfigRecord(id: string, record: Record<string, unknown>): Promise<void>;
  getConfigRecord(id: string): Promise<Record<string, unknown> | undefined>;
  deleteConfigRecord(id: string): Promise<void>;

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
const RAW_FIELD_PATTERNS = [
  /^customer/i,
  /^rawCustomer/i,
  /^prompt$/i,
  /^rawPrompt$/i,
  /^rawContent$/i,
  /^rawCode$/i,
  /^rawLog$/i,
];

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertSafeStoreId(id: string): void {
  if (id.length === 0 || id.length > 255 || !SAFE_ID_PATTERN.test(id)) {
    throw new InvalidStoreIdError(id);
  }
}

function isRawFieldName(key: string): boolean {
  return (
    RAW_FIELD_NAMES.has(key) ||
    RAW_FIELD_PATTERNS.some((pattern) => pattern.test(key))
  );
}

function assertNoRawPayloadFields(record: unknown, path = ''): void {
  if (Array.isArray(record)) {
    for (const [index, value] of record.entries()) {
      assertNoRawPayloadFields(value, `${path}[${index}]`);
    }
    return;
  }

  if (!record || typeof record !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (isRawFieldName(key)) {
      throw new RawPayloadRejectedError(fieldPath);
    }
    assertNoRawPayloadFields(value, fieldPath);
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

function cloneConfigRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (Array.isArray(value)) {
        const arrayValue: unknown[] = value;
        return [key, arrayValue.slice()];
      }

      return [key, value];
    }),
  );
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
  readonly #configRecords = new Map<string, Record<string, unknown>>();

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

  clearCorrelations(): Promise<void> {
    this.#correlations.clear();
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

  clearPayloadHashes(): Promise<void> {
    this.#payloadHashes.clear();
    return Promise.resolve();
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

  clearAudit(): Promise<void> {
    this.#auditEntries.clear();
    return Promise.resolve();
  }

  putConfigRecord(id: string, record: Record<string, unknown>): Promise<void> {
    try {
      assertSafeStoreId(id);
      assertNoRawPayloadFields(record);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    this.#configRecords.set(id, cloneConfigRecord(record));
    return Promise.resolve();
  }

  getConfigRecord(id: string): Promise<Record<string, unknown> | undefined> {
    const record = this.#configRecords.get(id);
    return Promise.resolve(
      record ? cloneConfigRecord(record) : undefined,
    );
  }

  deleteConfigRecord(id: string): Promise<void> {
    this.#configRecords.delete(id);
    return Promise.resolve();
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
    this.#configRecords.clear();
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

  async clearCorrelations(): Promise<void> {
    await rm(this.#correlationsDir(), { recursive: true, force: true });
  }

  async putPayloadHash(record: PayloadHashRecord): Promise<void> {
    await writeJsonFile(this.#payloadHashFilePath(record.hash), record);
  }

  async listPayloadHashes(): Promise<PayloadHashRecord[]> {
    return (await readJsonFiles<PayloadHashRecord>(this.#hashesDir())).sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  }

  async clearPayloadHashes(): Promise<void> {
    await rm(this.#hashesDir(), { recursive: true, force: true });
  }

  async appendAudit(entry: SubmissionAuditEntry): Promise<void> {
    await writeJsonFile(this.#auditFilePath(entry.id), entry);
  }

  async listAudit(): Promise<SubmissionAuditEntry[]> {
    return (await readJsonFiles<SubmissionAuditEntry>(this.#auditDir())).sort(
      (left, right) => left.timestamp - right.timestamp,
    );
  }

  async clearAudit(): Promise<void> {
    await rm(this.#auditDir(), { recursive: true, force: true });
  }

  async putConfigRecord(
    id: string,
    record: Record<string, unknown>,
  ): Promise<void> {
    assertSafeStoreId(id);
    assertNoRawPayloadFields(record);
    await writeJsonFile(this.#configFilePath(id), record);
  }

  async getConfigRecord(
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const filePath = this.#configFilePath(id);

    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw new StoreCorruptError(filePath, error);
    }
  }

  deleteConfigRecord(id: string): Promise<void> {
    return removeFile(this.#configFilePath(id));
  }

  async pruneExpired(now: number, policy: RetentionPolicy): Promise<void> {
    const correlations = await this.listCorrelations();
    await this.#rewriteRecords(
      this.#correlationsDir(),
      correlations,
      pruneByRetention(correlations, now, policy),
      (record) => this.#correlationFilePath(record.correlationId),
    );

    const payloadHashes = await this.listPayloadHashes();
    await this.#rewriteRecords(
      this.#hashesDir(),
      payloadHashes,
      pruneByRetention(payloadHashes, now, policy),
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
      this.clearCorrelations(),
      this.clearPayloadHashes(),
      this.clearAudit(),
      rm(this.#configDir(), { recursive: true, force: true }),
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

  #configDir(): string {
    return join(this.#baseDir, 'config');
  }

  #correlationFilePath(correlationId: string): string {
    assertSafeStoreId(correlationId);
    return join(this.#correlationsDir(), `${correlationId}.json`);
  }

  #payloadHashFilePath(hash: string): string {
    assertSafeStoreId(hash);
    return join(this.#hashesDir(), `${hash}.json`);
  }

  #auditFilePath(id: string): string {
    assertSafeStoreId(id);
    return join(this.#auditDir(), `${id}.json`);
  }

  #configFilePath(id: string): string {
    assertSafeStoreId(id);
    return join(this.#configDir(), `${id}.json`);
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
