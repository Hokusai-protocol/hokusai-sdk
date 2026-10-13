import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTaskCostLedger } from '../ledger/ledger.js';
import { createMemoryLedgerStorage } from '../ledger/storage.js';
import { hash } from '../ledger/test-support.js';
import {
  claudeAssistantLine,
  claudeUsage,
  claudeUserLine,
  codexSessionMetaLine,
  codexTokenCountLine,
  codexTurnContextLine,
  codexUsage,
} from '../sources/test-support.js';
import { measureTask } from './measure-task.js';
import { MeasureError } from './types.js';

const T0 = '2026-01-01T00:01:00Z';
const T1 = '2026-01-01T00:02:00Z';

let root: string;
let claudeFile: string;
let codexFile: string;

function claudeTranscript(): string {
  return [
    claudeUserLine('session-claude', T0),
    claudeAssistantLine({
      sessionId: 'session-claude',
      uuid: 'ua-1',
      timestamp: T0,
      usage: claudeUsage(1000, 500, 0, 0, 0),
    }),
    claudeAssistantLine({
      sessionId: 'session-claude',
      uuid: 'ua-2',
      timestamp: T1,
      usage: claudeUsage(2000, 1000, 0, 0, 0),
    }),
  ].join('\n');
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hokusai-measure-test-'));
  claudeFile = join(root, 'claude-session.jsonl');
  await writeFile(claudeFile, claudeTranscript(), 'utf8');
  codexFile = join(root, 'codex-rollout.jsonl');
  await writeFile(
    codexFile,
    [
      codexSessionMetaLine({ id: 'session-codex', timestamp: T0 }),
      codexTurnContextLine({
        turnId: 'turn-1',
        model: 'gpt-5-codex',
        timestamp: T0,
      }),
      codexTokenCountLine({
        timestamp: T0,
        last: codexUsage(1500, 700, 0, 0, 0),
      }),
    ].join('\n'),
    'utf8',
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('measureTask — session-file path', () => {
  it('REQ-F2: claude-code session file yields a full-field report', async () => {
    const { result, cost } = await measureTask(
      { taskId: 'task-f2', harness: 'claude-code', sessionFile: claudeFile },
      () => 'done',
    );
    expect(result).toBe('done');
    expect(cost.taskId).toBe('task-f2');
    // 3000 in × $3/MTok + 1500 out × $15/MTok (claude-sonnet-5)
    expect(cost.totalUsd).toBeCloseTo(0.0315, 9);
    expect(cost.usage).toEqual({
      input: 3000,
      output: 1500,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    });
    expect(cost.byModel['claude-sonnet-5']?.usd).toBeCloseTo(0.0315, 9);
    expect(cost.byHarness['claude-code']?.usd).toBeCloseTo(0.0315, 9);
    expect(cost.source).toEqual({
      kind: 'session-file',
      harness: 'claude-code',
      files: [claudeFile],
    });
    expect(cost.pricing.currency).toBe('USD');
    expect(cost.pricing.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cost.pricing.snapshotId).toContain('anthropic');
    expect(cost.coverage).toEqual({
      status: 'complete',
      pricedRecords: 2,
      unpricedRecords: 0,
      unknownModels: [],
    });
  });

  it('REQ-F2: codex rollout yields a priced report', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-codex', harness: 'codex', sessionFile: codexFile },
      () => undefined,
    );
    expect(cost.totalUsd).not.toBeNull();
    expect(cost.totalUsd ?? 0).toBeGreaterThan(0);
    expect(Object.keys(cost.byModel)).toEqual(['gpt-5-codex']);
    expect(cost.source.kind).toBe('session-file');
    expect(cost.coverage.status).toBe('complete');
  });

  it('a nonexistent session file never throws: SESSION_FILE_UNREADABLE + coverage none', async () => {
    const { cost } = await measureTask(
      {
        taskId: 'task-missing',
        harness: 'claude-code',
        sessionFile: join(root, 'does-not-exist.jsonl'),
      },
      () => undefined,
    );
    expect(cost.coverage.status).toBe('none');
    expect(cost.totalUsd).toBeNull();
    expect(
      cost.diagnostics.some((d) => d.code === 'SESSION_FILE_UNREADABLE'),
    ).toBe(true);
  });

  it('a malformed line is reported and the remaining records still price', async () => {
    const path = join(root, 'malformed.jsonl');
    await writeFile(
      path,
      ['{not json at all', claudeTranscript()].join('\n'),
      'utf8',
    );
    const { cost } = await measureTask(
      { taskId: 'task-malformed', harness: 'claude-code', sessionFile: path },
      () => undefined,
    );
    const malformed = cost.diagnostics.find(
      (d) => d.code === 'MALFORMED_RECORD',
    );
    expect(malformed?.level).toBe('warn');
    expect(cost.coverage.pricedRecords).toBe(2);
    expect(cost.totalUsd).toBeCloseTo(0.0315, 9);
  });

  it('manual tracker records merge with session-file capture', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-mixed', harness: 'claude-code', sessionFile: claudeFile },
      (tracker) => {
        tracker.recordUsage({
          model: 'claude-sonnet-4-6',
          harness: 'custom',
          usage: { input: 1000, output: 500 },
        });
      },
    );
    expect(cost.coverage.pricedRecords).toBe(3);
    expect(cost.totalUsd).toBeCloseTo(0.0315 + 0.0105, 9);
    expect(Object.keys(cost.byHarness).sort()).toEqual([
      'claude-code',
      'custom',
    ]);
  });

  it('500 records measure in under 500 ms (NFR)', async () => {
    const lines: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      lines.push(
        claudeAssistantLine({
          sessionId: 'session-many',
          uuid: `many-${String(index)}`,
          timestamp: new Date(
            Date.parse(T0) + index * 1000,
          ).toISOString(),
          usage: claudeUsage(100, 50, 0, 0, 0),
        }),
      );
    }
    const path = join(root, 'many.jsonl');
    await writeFile(path, lines.join('\n'), 'utf8');
    const started = performance.now();
    const { cost } = await measureTask(
      { taskId: 'task-many', harness: 'claude-code', sessionFile: path },
      () => undefined,
    );
    expect(performance.now() - started).toBeLessThan(500);
    expect(cost.coverage.pricedRecords).toBe(500);
  });
});

describe('measureTask — events path', () => {
  const eventRecord = (id: number): Record<string, unknown> => ({
    eventId: `src-evt-${String(id)}`,
    taskId: 'task-events',
    sessionId: 'session-events',
    turnId: `turn-${String(id)}`,
    sequence: id,
    harness: 'native',
    providerContractVersion: 'native/1',
    observedModel: 'claude-sonnet-4-6',
    usage: { input_tokens: 1000, output_tokens: 500 },
    observedAt: T0,
  });

  it('collects already-normalized records', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-events', events: [eventRecord(1), eventRecord(2)] },
      () => undefined,
    );
    expect(cost.source.kind).toBe('events');
    expect(cost.coverage.pricedRecords).toBe(2);
    expect(cost.totalUsd).toBeCloseTo(0.021, 9);
    expect(Object.keys(cost.byHarness)).toEqual(['native']);
  });

  it('adopts the records\' taskId when the caller omits one', async () => {
    const { cost } = await measureTask(
      { events: [eventRecord(1)] },
      () => undefined,
    );
    expect(cost.taskId).toBe('task-events');
    expect(cost.coverage.pricedRecords).toBe(1);
  });

  it('accepts an async iterable of records', async () => {
    async function* generate(): AsyncGenerator<unknown> {
      yield eventRecord(1);
      await Promise.resolve();
      yield eventRecord(2);
    }
    const { cost } = await measureTask(
      { taskId: 'task-events', events: generate() },
      () => undefined,
    );
    expect(cost.coverage.pricedRecords).toBe(2);
  });

  it('records for a different task are dropped with RECORD_OUT_OF_BOUNDARY', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-other', events: [eventRecord(1)] },
      () => undefined,
    );
    expect(cost.coverage.status).toBe('none');
    expect(
      cost.diagnostics.some((d) => d.code === 'RECORD_OUT_OF_BOUNDARY'),
    ).toBe(true);
  });
});

describe('measureTask — edges (REQ-F5/F6, arguments, abort, ledger)', () => {
  it('REQ-F5: no usage source and no manual records -> coverage none', async () => {
    const { cost } = await measureTask({ taskId: 'task-empty' }, () => 42);
    expect(cost.totalUsd).toBeNull();
    expect(cost.coverage).toEqual({
      status: 'none',
      pricedRecords: 0,
      unpricedRecords: 0,
      unknownModels: [],
    });
    expect(cost.source.kind).toBe('manual');
    const diagnostic = cost.diagnostics.find(
      (d) => d.code === 'NO_USAGE_CAPTURED',
    );
    expect(diagnostic?.message).toMatch(/usage events or session files/);
  });

  it('REQ-F6: a failing fn rethrows the same instance with a partial report attached', async () => {
    const boom = new Error('task failed');
    let caught: unknown;
    try {
      await measureTask({ taskId: 'task-fail' }, (tracker) => {
        tracker.recordUsage({
          model: 'claude-sonnet-4-6',
          usage: { input: 1000, output: 500 },
        });
        throw boom;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(boom);
    const attached = (caught as { taskCost?: { totalUsd: number | null } })
      .taskCost;
    expect(attached?.totalUsd).toBeCloseTo(0.0105, 9);
  });

  it('REQ-F6 edge: a primitive throw is rethrown unchanged', async () => {
    await expect(
      measureTask({ taskId: 'task-string-throw' }, () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the primitive-throw edge is the point of this test
        throw 'plain failure';
      }),
    ).rejects.toBe('plain failure');
  });

  it('an already-aborted signal rejects with AbortError before fn runs', async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    const promise = measureTask(
      { taskId: 'task-abort', signal: controller.signal },
      () => {
        ran = true;
      },
    );
    await expect(promise).rejects.toSatisfy(
      (error: unknown) => (error as Error).name === 'AbortError',
    );
    expect(ran).toBe(false);
  });

  it('programmer errors throw MeasureError INVALID_ARGUMENT before fn runs', async () => {
    const fn = (): void => undefined;
    await expect(
      measureTask(null as unknown as Record<string, never>, fn),
    ).rejects.toThrowError(MeasureError);
    await expect(
      measureTask({}, 'not-a-function' as unknown as () => void),
    ).rejects.toThrowError(/task function/);
    await expect(
      measureTask({ sessionFile: claudeFile }, fn),
    ).rejects.toThrowError(/harness/);
    await expect(
      measureTask({ sessionFile: 42 as unknown as string, harness: 'claude-code' }, fn),
    ).rejects.toThrowError(MeasureError);
    await expect(
      measureTask(
        { sessionFile: claudeFile, harness: 'claude-code', events: [] },
        fn,
      ),
    ).rejects.toThrowError(/mutually exclusive/);
    await expect(
      measureTask({ taskId: 'bad id!' }, fn),
    ).rejects.toThrowError(/contract-safe/);
  });

  it('opt-in ledger persistence round-trips the priced records (D7)', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    const { cost } = await measureTask(
      {
        taskId: 'task-ledger',
        harness: 'claude-code',
        sessionFile: claudeFile,
        ledger,
      },
      () => undefined,
    );
    expect(cost.coverage.pricedRecords).toBe(2);
    expect(
      cost.diagnostics.some((d) => d.code === 'LEDGER_WRITE_FAILED'),
    ).toBe(false);

    const totals = ledger.query({}).totals;
    expect(totals.recordCount).toBe(2);
    expect(totals.meteredMicros + totals.tokenEquivalentMicros).toBe(
      Math.round((cost.totalUsd ?? 0) * 1e6),
    );
    ledger.close();

    const reopened = await openTaskCostLedger({ storage, hashFn: hash });
    expect(reopened.query({}).totals.recordCount).toBe(2);
    reopened.close();
  });

  it('without a ledger option nothing is persisted anywhere (opt-in only)', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-no-ledger', harness: 'claude-code', sessionFile: claudeFile },
      () => undefined,
    );
    expect(cost.coverage.pricedRecords).toBe(2);
    // No ledger handle existed; the only output is the in-memory report.
  });
});
