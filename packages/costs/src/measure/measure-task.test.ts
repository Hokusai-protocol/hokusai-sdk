import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  codexSessionMetaLine,
  codexTokenCountLine,
  codexTurnContextLine,
  codexUsage,
} from '../sources/test-support.js';
import { TaskCostMeasureError } from './errors.js';
import { measureTask } from './measure-task.js';
import {
  EXAMPLE_SESSION_ID,
  EXAMPLE_TASK_ID,
  EXAMPLE_WINDOW,
  buildExampleClaudeSessionJsonl,
} from './test-support.js';
import type { TaskCostReport, TaskUsageRecord } from './types.js';

const fixedNow = (): Date => new Date('2026-01-01T00:30:00Z');

const tempDirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hokusai-measure-test-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function usageRecord(input: number, output: number): TaskUsageRecord {
  return {
    model: 'claude-sonnet-5',
    usage: {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  };
}

describe('measureTask: session files (REQ-F2)', () => {
  it('measures a Claude Code session behind an explicit boundary', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, `${EXAMPLE_SESSION_ID}.jsonl`), buildExampleClaudeSessionJsonl());

    const { result, cost } = await measureTask(
      {
        taskId: EXAMPLE_TASK_ID,
        now: fixedNow,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: [EXAMPLE_SESSION_ID],
          roots: [dir],
          window: EXAMPLE_WINDOW,
        },
      },
      () => 42,
    );

    expect(result).toBe(42);
    expect(cost.totalUsd).not.toBeNull();
    expect(cost.totalUsd ?? 0).toBeGreaterThan(0);
    expect(cost.coverage.status).toBe('complete');
    expect(cost.byModel['claude-sonnet-5']?.totalUsd).toBe(cost.totalUsd);
    expect(cost.byHarness['claude-code']?.eventCount).toBe(2);
    expect(cost.usage.inputTokens ?? 0).toBeGreaterThan(0);
    expect(cost.usage.outputTokens ?? 0).toBeGreaterThan(0);
    expect(cost.source.capture).toEqual(['session-files']);
    expect(cost.source.sessionFileCount).toBe(1);
    expect(cost.pricing.revision).toBeTruthy();
    expect(cost.pricing.effectiveDate).toBeTruthy();
    expect(Array.isArray(cost.diagnostics)).toBe(true);
  });

  it('measures a Codex rollout the same way', async () => {
    const dir = await tempDir();
    const sessionId = 'codex-session-0001';
    const lines = [
      codexSessionMetaLine({ id: sessionId, timestamp: '2026-01-01T00:05:00Z' }),
      codexTurnContextLine({
        turnId: 'codex-turn-0001',
        model: 'gpt-5-codex',
        timestamp: '2026-01-01T00:10:00Z',
      }),
      codexTokenCountLine({
        timestamp: '2026-01-01T00:10:30Z',
        // No cache tokens: the built-in table does not model non-Anthropic
        // cache rates, and a reported cache counter would stay unpriced.
        last: codexUsage(8_000, 1_200, 0, 0, 400),
      }),
    ];
    await writeFile(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`);

    const { result, cost } = await measureTask(
      {
        taskId: 'task-codex-example',
        now: fixedNow,
        sessionFiles: {
          harness: 'codex',
          sessionIds: () => [sessionId],
          roots: [dir],
          window: EXAMPLE_WINDOW,
        },
      },
      () => 'done',
    );

    expect(result).toBe('done');
    expect(cost.totalUsd ?? 0).toBeGreaterThan(0);
    expect(cost.byHarness.codex?.totalUsd).toBe(cost.totalUsd);
    expect(cost.byModel['gpt-5-codex']).toBeDefined();
    expect(cost.source.capture).toEqual(['session-files']);
  });

  it('degrades a missing session file to a count-only diagnostic', async () => {
    const dir = await tempDir();
    const { cost } = await measureTask(
      {
        taskId: 'task-missing-file',
        now: fixedNow,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: ['sess-x'],
          paths: [join(dir, 'does-not-exist.jsonl')],
        },
      },
      () => 1,
    );
    const diagnostic = cost.diagnostics.find((d) => d.code === 'session_file_unreadable');
    expect(diagnostic).toMatchObject({ level: 'warn', count: 1 });
    expect(JSON.stringify(cost)).not.toContain('does-not-exist');
    expect(cost.coverage.status).toBe('unavailable');
  });

  it('skips a malformed line and still prices the rest', async () => {
    const dir = await tempDir();
    const content = `not json at all\n${buildExampleClaudeSessionJsonl()}`;
    await writeFile(join(dir, `${EXAMPLE_SESSION_ID}.jsonl`), content);
    const { cost } = await measureTask(
      {
        taskId: EXAMPLE_TASK_ID,
        now: fixedNow,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: [EXAMPLE_SESSION_ID],
          roots: [dir],
          window: EXAMPLE_WINDOW,
        },
      },
      () => 1,
    );
    expect(cost.totalUsd ?? 0).toBeGreaterThan(0);
    const diagnostic = cost.diagnostics.find((d) => d.code === 'malformed_record');
    expect(diagnostic).toMatchObject({ count: 1 });
  });

  it('treats an empty file as no usage, without a malformed_record', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, `${EXAMPLE_SESSION_ID}.jsonl`), '');
    const { cost } = await measureTask(
      {
        taskId: EXAMPLE_TASK_ID,
        now: fixedNow,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: [EXAMPLE_SESSION_ID],
          roots: [dir],
          window: EXAMPLE_WINDOW,
        },
      },
      () => 1,
    );
    expect(cost.coverage.status).toBe('unavailable');
    expect(cost.diagnostics.some((d) => d.code === 'malformed_record')).toBe(false);
    expect(cost.diagnostics.some((d) => d.code === 'no_usage_captured')).toBe(true);
  });

  it('counts and drops rows outside the window', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, `${EXAMPLE_SESSION_ID}.jsonl`), buildExampleClaudeSessionJsonl());
    const { cost } = await measureTask(
      {
        taskId: EXAMPLE_TASK_ID,
        now: fixedNow,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: [EXAMPLE_SESSION_ID],
          roots: [dir],
          // A window that excludes the second turn (at 00:20).
          window: { startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:15:00Z' },
        },
      },
      () => 1,
    );
    expect(cost.eventCount).toBe(1);
    const diagnostic = cost.diagnostics.find((d) => d.code === 'outside_time_window');
    expect(diagnostic).toMatchObject({ level: 'info', count: 1 });
  });
});

describe('measureTask: event sources', () => {
  it('subscribes to an EventEmitter for the duration of fn', async () => {
    const emitter = new EventEmitter();
    const { result, cost } = await measureTask(
      { taskId: 'task-emitter', now: fixedNow, events: emitter },
      async () => {
        emitter.emit('usage', usageRecord(1000, 100));
        await Promise.resolve();
        emitter.emit('usage', usageRecord(2000, 200));
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect(cost.eventCount).toBe(2);
    expect(cost.usage.inputTokens).toBe(3000);
    expect(cost.source.capture).toEqual(['events']);
    expect(emitter.listenerCount('usage')).toBe(0); // removed after success
  });

  it('subscribes to an EventTarget (CustomEvent detail unwrap)', async () => {
    const target = new EventTarget();
    const { cost } = await measureTask(
      { taskId: 'task-target', now: fixedNow, events: target },
      () => {
        target.dispatchEvent(new CustomEvent('usage', { detail: usageRecord(500, 50) }));
        return 1;
      },
    );
    expect(cost.eventCount).toBe(1);
    expect(cost.usage.inputTokens).toBe(500);
  });

  it('honors a custom eventName and mapEvent', async () => {
    const emitter = new EventEmitter();
    const { cost } = await measureTask(
      {
        taskId: 'task-mapped',
        now: fixedNow,
        events: emitter,
        eventName: 'llm-usage',
        mapEvent: (payload) => {
          const p = payload as { model: string; usage: { input: number; output: number } };
          return {
            model: p.model,
            usage: { inputTokens: p.usage.input, outputTokens: p.usage.output },
          };
        },
      },
      () => {
        emitter.emit('llm-usage', { model: 'gpt-5', usage: { input: 700, output: 70 } });
        return 1;
      },
    );
    expect(cost.eventCount).toBe(1);
    expect(cost.byModel['gpt-5']).toBeDefined();
  });

  it('consumes an array source after fn', async () => {
    const { cost } = await measureTask(
      {
        taskId: 'task-array',
        now: fixedNow,
        events: [usageRecord(100, 10), usageRecord(200, 20)],
      },
      () => 1,
    );
    expect(cost.eventCount).toBe(2);
    expect(cost.source.capture).toEqual(['events']);
  });

  it('consumes an async-iterable source after fn', async () => {
    async function* records(): AsyncGenerator<TaskUsageRecord> {
      yield usageRecord(100, 10);
      await Promise.resolve();
      yield usageRecord(200, 20);
    }
    const { cost } = await measureTask(
      { taskId: 'task-async', now: fixedNow, events: records() },
      () => 1,
    );
    expect(cost.eventCount).toBe(2);
    expect(cost.source.capture).toEqual(['events']);
  });

  it('captures inline tracker.recordUsage as manual', async () => {
    const { cost } = await measureTask({ taskId: 'task-manual', now: fixedNow }, (tracker) => {
      tracker.recordUsage(usageRecord(100, 10));
      return 1;
    });
    expect(cost.eventCount).toBe(1);
    expect(cost.source.capture).toEqual(['manual']);
  });

  it('reports unavailable with guidance when nothing was captured (REQ-F5)', async () => {
    for (const options of [
      { taskId: 'task-empty-1', now: fixedNow },
      { taskId: 'task-empty-2', now: fixedNow, events: [] as unknown[] },
    ]) {
      const { cost } = await measureTask(options, () => 1);
      expect(cost.totalUsd).toBeNull();
      expect(cost.coverage.status).toBe('unavailable');
      const warn = cost.diagnostics.find((d) => d.code === 'no_usage_captured');
      expect(warn?.message).toContain('usage events or session files');
    }
  });
});

describe('measureTask: errors and aborts (REQ-F6)', () => {
  it('rethrows fn errors with the partial report attached', async () => {
    const emitter = new EventEmitter();
    const err = new Error('task failed');
    let caught: unknown;
    try {
      await measureTask({ taskId: 'task-fail', now: fixedNow, events: emitter }, () => {
        emitter.emit('usage', usageRecord(1_000_000, 0));
        throw err;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(err);
    const cost = (caught as { taskCost?: TaskCostReport }).taskCost;
    expect(cost?.totalUsd ?? 0).toBeGreaterThan(0);
    // Attached non-enumerably: serializing the error does not leak the report.
    expect(Object.keys(caught as object)).not.toContain('taskCost');
    expect(emitter.listenerCount('usage')).toBe(0); // removed after throw
  });

  it('rethrows a primitive throw unchanged (no cost attachment possible)', async () => {
    await expect(
      measureTask({ taskId: 'task-str', now: fixedNow }, () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- REQ-F6: a primitive throw must rethrow unchanged
        throw 'plain string';
      }),
    ).rejects.toBe('plain string');
  });

  it('keeps the original error when collection fails after the throw', async () => {
    const err = new Error('task failed first');
    function* badSource(): Generator<TaskUsageRecord> {
      yield usageRecord(1000, 100);
      throw new Error('iterable collapsed');
    }
    let caught: unknown;
    try {
      await measureTask(
        { taskId: 'task-fail-collect', now: fixedNow, events: badSource() },
        () => {
          throw err;
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(err);
    const cost = (caught as { taskCost?: TaskCostReport }).taskCost;
    expect(cost?.diagnostics.some((d) => d.code === 'collection_failed')).toBe(true);
    expect(cost?.eventCount).toBe(1); // records before the failure still count
  });

  it('rejects with an AbortError before fn runs when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(
      measureTask({ taskId: 'task-abort', signal: controller.signal }, () => {
        ran = true;
        return 1;
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(ran).toBe(false);
  });

  it('throws INVALID_ARGUMENT for programmer errors', async () => {
    const calls: (() => Promise<unknown>)[] = [
      () => measureTask(null as never, () => 1),
      () => measureTask({}, 'not-a-function' as never),
      () =>
        measureTask(
          {
            sessionFiles: {
              harness: 'claude-code',
              sessionIds: ['s'],
              paths: [123] as never,
            },
          },
          () => 1,
        ),
      () =>
        measureTask(
          { sessionFiles: { harness: 'claude-code', sessionIds: ['s'] } as never },
          () => 1,
        ),
      () =>
        measureTask(
          {
            sessionFiles: {
              harness: 'claude-code',
              sessionIds: [],
              roots: ['/tmp'],
            },
          },
          () => 1,
        ),
      () => measureTask({ events: 'nope' as never }, () => 1),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof TaskCostMeasureError && error.code === 'INVALID_ARGUMENT',
      );
    }
  });
});

describe('measureTask: opt-in ledger', () => {
  it('persists accepted events, reconciles totals, and dedupes a rerun', async () => {
    const { openTaskCostLedger } = await import('../ledger/ledger.js');
    const { createMemoryLedgerStorage } = await import('../ledger/storage.js');
    const { hash } = await import('../ledger/test-support.js');
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });

    const run = () =>
      measureTask(
        {
          taskId: 'task-ledger',
          now: fixedNow,
          ledger,
          events: [
            { ...usageRecord(1_000_000, 0), eventId: 'stable-1' },
            { ...usageRecord(0, 1_000_000), eventId: 'stable-2' },
          ],
        },
        () => 1,
      );

    const { cost } = await run();
    const summary = ledger.summarizeTask('task-ledger');
    expect(summary.totals.recordCount).toBe(2);
    expect(summary.totals.tokenEquivalentMicros / 1e6).toBeCloseTo(cost.totalUsd ?? 0, 6);

    // A rerun with the same stable event ids persists nothing new.
    await run();
    expect(ledger.summarizeTask('task-ledger').totals.recordCount).toBe(2);
  });
});

describe('measureTask: perf guard', () => {
  it('measures the bundled fixture well under the latency bound', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, `${EXAMPLE_SESSION_ID}.jsonl`), buildExampleClaudeSessionJsonl());
    const start = performance.now();
    await measureTask(
      {
        taskId: EXAMPLE_TASK_ID,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: [EXAMPLE_SESSION_ID],
          roots: [dir],
          window: EXAMPLE_WINDOW,
        },
      },
      () => 1,
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(process.env.CI ? 2000 : 500);
  });
});
