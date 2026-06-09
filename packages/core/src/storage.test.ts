import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalStore } from './storage.js';
import type { StoreCorruptError } from './storage.js';
import {
  FsLocalStore,
  InMemoryCorrelationStorage,
  InMemoryLocalStore,
  InvalidStoreIdError,
  RawPayloadRejectedError,
} from './storage.js';

describe('InMemoryCorrelationStorage', () => {
  it('stores and resolves correlation records', async () => {
    const storage = new InMemoryCorrelationStorage();
    await storage.set({
      taskId: 'task-1',
      correlationId: 'correlation-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(storage.get('task-1')).resolves.toEqual({
      taskId: 'task-1',
      correlationId: 'correlation-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dirPath) =>
      rm(dirPath, { recursive: true, force: true }),
    ),
  );
});

async function createFsStore(): Promise<{
  baseDir: string;
  store: FsLocalStore;
}> {
  const baseDir = await mkdtemp(join(tmpdir(), 'hokusai-local-store-'));
  tempDirs.push(baseDir);
  return {
    baseDir,
    store: new FsLocalStore(baseDir),
  };
}

describe('local store implementations', () => {
  it('records audit entries and returns them sorted by timestamp', async () => {
    const memoryStore = new InMemoryLocalStore();
    const { store: fsStore } = await createFsStore();

    for (const store of [memoryStore, fsStore]) {
      await store.appendAudit({
        id: 'audit-2',
        kind: 'routing',
        correlationId: 'correlation-1',
        status: 'failed',
        timestamp: 20,
        error: 'network error',
      });
      await store.appendAudit({
        id: 'audit-1',
        kind: 'outcome',
        correlationId: 'correlation-1',
        status: 'skipped',
        timestamp: 10,
      });

      await expect(store.listAudit()).resolves.toEqual([
        {
          id: 'audit-1',
          kind: 'outcome',
          correlationId: 'correlation-1',
          status: 'skipped',
          timestamp: 10,
        },
        {
          id: 'audit-2',
          kind: 'routing',
          correlationId: 'correlation-1',
          status: 'failed',
          timestamp: 20,
          error: 'network error',
        },
      ]);

      await store.clear();
    }
  });

  it('prunes expired and excess records per record type', async () => {
    const now = 1_000;
    const memoryStore = new InMemoryLocalStore();
    const { store: fsStore } = await createFsStore();

    for (const store of [memoryStore, fsStore]) {
      await store.putCorrelation({
        correlationId: 'correlation-old',
        packetHash: 'packet-old',
        createdAt: 100,
      });
      await store.putCorrelation({
        correlationId: 'correlation-mid',
        packetHash: 'packet-mid',
        createdAt: 850,
      });
      await store.putCorrelation({
        correlationId: 'correlation-new',
        packetHash: 'packet-new',
        createdAt: 950,
      });
      await store.putPayloadHash({
        hash: 'hash-old',
        algorithm: 'sha256',
        createdAt: 200,
      });
      await store.putPayloadHash({
        hash: 'hash-new',
        algorithm: 'sha256',
        createdAt: 975,
      });
      await store.appendAudit({
        id: 'audit-old',
        kind: 'routing',
        correlationId: 'correlation-old',
        status: 'submitted',
        timestamp: 300,
      });
      await store.appendAudit({
        id: 'audit-new',
        kind: 'outcome',
        correlationId: 'correlation-new',
        status: 'submitted',
        timestamp: 990,
      });

      await store.pruneExpired(now, {
        maxAgeMs: 200,
        maxRecords: 1,
      });

      await expect(store.listCorrelations()).resolves.toEqual([
        {
          correlationId: 'correlation-new',
          packetHash: 'packet-new',
          createdAt: 950,
        },
      ]);
      await expect(store.listPayloadHashes()).resolves.toEqual([
        {
          hash: 'hash-new',
          algorithm: 'sha256',
          createdAt: 975,
        },
      ]);
      await expect(store.listAudit()).resolves.toEqual([
        {
          id: 'audit-new',
          kind: 'outcome',
          correlationId: 'correlation-new',
          status: 'submitted',
          timestamp: 990,
        },
      ]);

      await store.clear();
    }
  });

  it('clears all local state and tolerates clearing an empty store', async () => {
    const memoryStore = new InMemoryLocalStore();
    const { store: fsStore } = await createFsStore();

    for (const store of [memoryStore, fsStore]) {
      await store.putCorrelation({
        correlationId: 'correlation-1',
        packetHash: 'packet-1',
        createdAt: 1,
      });
      await store.putCorrelation({
        correlationId: 'correlation-2',
        packetHash: 'packet-2',
        createdAt: 2,
      });
      await store.appendAudit({
        id: 'audit-1',
        kind: 'routing',
        correlationId: 'correlation-1',
        status: 'submitted',
        timestamp: 3,
      });

      await expect(store.clear()).resolves.toBeUndefined();
      await expect(store.clear()).resolves.toBeUndefined();
      await expect(store.listCorrelations()).resolves.toEqual([]);
      await expect(store.listPayloadHashes()).resolves.toEqual([]);
      await expect(store.listAudit()).resolves.toEqual([]);
    }
  });

  it('clears each record type independently via scoped clear methods', async () => {
    const memoryStore = new InMemoryLocalStore();
    const { store: fsStore } = await createFsStore();

    for (const store of [memoryStore, fsStore]) {
      await store.putCorrelation({
        correlationId: 'correlation-scoped',
        packetHash: 'packet-scoped',
        createdAt: 10,
      });
      await store.putPayloadHash({
        hash: 'hash-scoped',
        algorithm: 'sha256',
        createdAt: 11,
      });
      await store.appendAudit({
        id: 'audit-scoped',
        kind: 'routing',
        correlationId: 'correlation-scoped',
        status: 'submitted',
        timestamp: 12,
      });

      await expect(store.clearCorrelations()).resolves.toBeUndefined();
      await expect(store.listCorrelations()).resolves.toEqual([]);
      await expect(store.listPayloadHashes()).resolves.toHaveLength(1);
      await expect(store.listAudit()).resolves.toHaveLength(1);

      await expect(store.clearPayloadHashes()).resolves.toBeUndefined();
      await expect(store.listPayloadHashes()).resolves.toEqual([]);
      await expect(store.listAudit()).resolves.toHaveLength(1);

      await expect(store.clearAudit()).resolves.toBeUndefined();
      await expect(store.listAudit()).resolves.toEqual([]);

      await expect(store.clearCorrelations()).resolves.toBeUndefined();
      await expect(store.clearPayloadHashes()).resolves.toBeUndefined();
      await expect(store.clearAudit()).resolves.toBeUndefined();
    }
  });

  it('returns empty results when filesystem store directories do not exist', async () => {
    const { store } = await createFsStore();

    await expect(store.clear()).resolves.toBeUndefined();
    await expect(store.listCorrelations()).resolves.toEqual([]);
    await expect(store.listPayloadHashes()).resolves.toEqual([]);
    await expect(store.listAudit()).resolves.toEqual([]);
  });

  it('rejects raw payload fields and does not persist them', async () => {
    const memoryStore = new InMemoryLocalStore();
    const { store: fsStore } = await createFsStore();

    for (const store of [memoryStore, fsStore]) {
      await expect(
        store.putCorrelation({
          correlationId: 'correlation-1',
          packetHash: 'packet-1',
          createdAt: 1,
          rawTaskText: 'secret task',
        } as never),
      ).rejects.toBeInstanceOf(RawPayloadRejectedError);
      await expect(store.listCorrelations()).resolves.toEqual([]);
    }
  });

  it('reports corrupt filesystem json with file path context', async () => {
    const { baseDir, store } = await createFsStore();
    const correlationsDir = join(baseDir, 'correlations');

    await mkdir(correlationsDir, { recursive: true });
    await writeFile(
      join(correlationsDir, 'broken.json'),
      '{"correlationId":',
      'utf8',
    );

    await expect(store.listCorrelations()).rejects.toMatchObject({
      filePath: join(correlationsDir, 'broken.json'),
    } satisfies Partial<StoreCorruptError>);
  });

  it('rejects path-traversal identifiers in the filesystem store', async () => {
    const { store } = await createFsStore();

    await expect(
      store.putCorrelation({
        correlationId: '../escape',
        packetHash: 'safe-hash',
        createdAt: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidStoreIdError);

    await expect(
      store.putPayloadHash({
        hash: 'a/b',
        algorithm: 'sha-256',
        createdAt: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidStoreIdError);

    await expect(
      store.appendAudit({
        id: '..',
        kind: 'routing',
        correlationId: 'correlation-1',
        status: 'submitted',
        timestamp: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidStoreIdError);

    await expect(store.getCorrelation('../escape')).rejects.toBeInstanceOf(
      InvalidStoreIdError,
    );
    await expect(store.deleteCorrelation('../escape')).rejects.toBeInstanceOf(
      InvalidStoreIdError,
    );
  });

  it('exposes both local store implementations through the shared interface', () => {
    const memoryStore: LocalStore = new InMemoryLocalStore();
    expect(memoryStore).toBeInstanceOf(InMemoryLocalStore);

    const fsStore: LocalStore = new FsLocalStore('/tmp/hokusai-local-store');
    expect(fsStore).toBeInstanceOf(FsLocalStore);
  });
});
