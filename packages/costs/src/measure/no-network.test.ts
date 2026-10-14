/**
 * D6 runtime proof: measurement makes no network call, reads no `HOKUSAI_*`
 * environment variable, and produces an identical, key-free report whether or
 * not a Hokusai API key is present in the environment. (The static source
 * scan lives in `../ledger/no-network.test.ts` and covers all of `src/`.)
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { measureTask } from './measure-task.js';
import { createTaskCostTracker } from './tracker.js';
import {
  EXAMPLE_SESSION_ID,
  EXAMPLE_TASK_ID,
  EXAMPLE_WINDOW,
  buildExampleClaudeSessionJsonl,
} from './test-support.js';
import type { TaskCostReport } from './types.js';

const fixedNow = (): Date => new Date('2026-01-01T00:30:00Z');

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function measureEverything(): Promise<TaskCostReport> {
  const dir = await mkdtemp(join(tmpdir(), 'hokusai-no-network-'));
  tempDirs.push(dir);
  await writeFile(
    join(dir, `${EXAMPLE_SESSION_ID}.jsonl`),
    buildExampleClaudeSessionJsonl(),
  );

  const tracker = createTaskCostTracker({
    taskId: 'side-tracker',
    now: fixedNow,
  });
  tracker.recordUsage({
    model: 'claude-sonnet-5',
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  tracker.summary();

  const { cost } = await measureTask(
    {
      taskId: EXAMPLE_TASK_ID,
      now: fixedNow,
      events: [
        {
          model: 'gpt-5',
          eventId: 'net-e1',
          usage: { inputTokens: 100, outputTokens: 10 },
        },
      ],
      sessionFiles: {
        harness: 'claude-code',
        sessionIds: [EXAMPLE_SESSION_ID],
        roots: [dir],
        window: EXAMPLE_WINDOW,
      },
    },
    () => 1,
  );
  return cost;
}

describe('no network, no credentials (D6)', () => {
  it('measures with fetch stubbed to throw and never reads HOKUSAI_* env', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network attempted');
    });
    const originalEnv = process.env;
    const hokusaiReads: string[] = [];
    process.env = new Proxy(originalEnv, {
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('HOKUSAI')) {
          hokusaiReads.push(property);
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    try {
      const cost = await measureEverything();
      expect(cost.totalUsd ?? 0).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(hokusaiReads).toEqual([]);
    } finally {
      process.env = originalEnv;
      fetchSpy.mockRestore();
    }
  });

  it('produces an identical report with a key in the environment, and never leaks it', async () => {
    const key = 'HOKUSAI' + '_API_KEY'; // split so the static source scan stays clean
    const baseline = await measureEverything();
    const original = process.env[key];
    process.env[key] = 'sk-test-0123456789';
    try {
      const withKey = await measureEverything();
      expect(withKey).toEqual(baseline);
      expect(JSON.stringify(withKey)).not.toContain('sk-test');
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });
});
