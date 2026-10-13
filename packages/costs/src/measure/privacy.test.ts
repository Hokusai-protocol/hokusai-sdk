/**
 * Privacy proof for the drop-in API: SENTINEL-laced session fixtures and
 * extra keys on friendly records must never reach the report, the stored
 * events, or the ledger records — and neither may file paths or prompt text.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openTaskCostLedger } from '../ledger/ledger.js';
import { createMemoryLedgerStorage } from '../ledger/storage.js';
import { hash } from '../ledger/test-support.js';
import { PRIVACY_SENTINEL } from '../sources/test-support.js';
import { measureTask } from './measure-task.js';
import { createTaskCostTracker } from './tracker.js';
import {
  EXAMPLE_SESSION_ID,
  EXAMPLE_TASK_ID,
  EXAMPLE_WINDOW,
  buildExampleClaudeSessionJsonl,
} from './test-support.js';

const fixedNow = (): Date => new Date('2026-01-01T00:30:00Z');

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('measure privacy', () => {
  it('keeps session-file sentinels, paths, and prompts out of every output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hokusai-measure-privacy-'));
    tempDirs.push(dir);
    const fixturePath = join(dir, `${EXAMPLE_SESSION_ID}.jsonl`);
    const fixture = buildExampleClaudeSessionJsonl();
    expect(fixture).toMatch(PRIVACY_SENTINEL); // the fixture is laced on purpose
    await writeFile(fixturePath, fixture);

    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    const { cost } = await measureTask(
      {
        taskId: EXAMPLE_TASK_ID,
        now: fixedNow,
        ledger,
        sessionFiles: {
          harness: 'claude-code',
          sessionIds: [EXAMPLE_SESSION_ID],
          roots: [dir],
          window: EXAMPLE_WINDOW,
        },
      },
      (tracker) => tracker.events(),
    );

    const outputs = [
      JSON.stringify(cost),
      JSON.stringify(ledger.records()),
      storage.contents() ?? '',
    ];
    for (const output of outputs) {
      expect(output).not.toMatch(PRIVACY_SENTINEL);
      expect(output).not.toContain(dir);
      expect(output).not.toContain('do the task');
    }
    expect(cost.totalUsd ?? 0).toBeGreaterThan(0); // the usage itself survived
  });

  it('drops extra keys on recordUsage records via the allow-list', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-privacy', now: fixedNow });
    tracker.recordUsage({
      model: 'claude-sonnet-5',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        // Extra usage keys are dropped too.
        promptText: 'SENTINEL_PROMPT',
      } as never,
      prompt: 'SENTINEL_PROMPT content',
      cwd: '/Users/sentinel-user/SENTINEL_PATH',
      apiKey: 'sk-SENTINEL',
    } as never);
    const serialized = JSON.stringify({
      report: tracker.summary(),
      events: tracker.events(),
    });
    expect(serialized).not.toMatch(PRIVACY_SENTINEL);
  });

  it('drops extra keys on record() inputs via the allow-list', () => {
    const tracker = createTaskCostTracker({ taskId: 'task-privacy', now: fixedNow });
    const result = tracker.record({
      eventId: 'e1',
      taskId: 'task-privacy',
      sessionId: 's1',
      turnId: 't1',
      sequence: 1,
      harness: 'native',
      providerContractVersion: 'native/1',
      observedModel: 'claude-sonnet-5',
      usage: { input_tokens: 10, output_tokens: 5 },
      observedAt: '2026-01-01T00:00:00Z',
      transcript: 'SENTINEL_TRANSCRIPT',
      email: 'sentinel@example.com',
    } as never);
    expect(result.status).toBe('accepted');
    const serialized = JSON.stringify({
      report: tracker.summary(),
      events: tracker.events(),
    });
    expect(serialized).not.toMatch(PRIVACY_SENTINEL);
    expect(serialized).not.toContain('@example.com');
  });
});
