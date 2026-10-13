/**
 * Privacy proof for the measure layer: fixtures laced with SENTINEL values
 * in every leak-prone field (prompts, transcript text, paths, branches,
 * account identity — see `sources/test-support.ts`) must never surface in a
 * `TaskCostReport`, including the partial report attached to a failing
 * task's error.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRIVACY_SENTINEL,
  claudeAssistantLine,
  claudeUsage,
  claudeUserLine,
  codexSessionMetaLine,
  codexTokenCountLine,
  codexTurnContextLine,
  codexUsage,
} from '../sources/test-support.js';
import { measureTask } from './measure-task.js';
import type { TaskCostReport } from './types.js';

const T0 = '2026-01-01T00:01:00Z';

let root: string;
let claudeFile: string;
let codexFile: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hokusai-measure-privacy-'));
  claudeFile = join(root, 'claude.jsonl');
  await writeFile(
    claudeFile,
    [
      claudeUserLine('session-priv', T0),
      claudeAssistantLine({
        sessionId: 'session-priv',
        uuid: 'priv-1',
        timestamp: T0,
        usage: claudeUsage(1000, 500, 0, 0, 0),
      }),
    ].join('\n'),
    'utf8',
  );
  codexFile = join(root, 'codex.jsonl');
  await writeFile(
    codexFile,
    [
      codexSessionMetaLine({ id: 'session-priv-codex', timestamp: T0 }),
      codexTurnContextLine({
        turnId: 'turn-1',
        model: 'gpt-5-codex',
        timestamp: T0,
      }),
      codexTokenCountLine({
        timestamp: T0,
        last: codexUsage(100, 50, 0, 0, 0),
      }),
    ].join('\n'),
    'utf8',
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function assertSanitized(label: string, report: TaskCostReport): void {
  expect(JSON.stringify(report), `${label} leaked a sentinel`).not.toMatch(
    PRIVACY_SENTINEL,
  );
}

describe('measure reports never leak raw source fields', () => {
  it('claude-code session file', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-priv', harness: 'claude-code', sessionFile: claudeFile },
      () => undefined,
    );
    expect(cost.coverage.pricedRecords).toBe(1);
    assertSanitized('claude-code report', cost);
  });

  it('codex rollout', async () => {
    const { cost } = await measureTask(
      { taskId: 'task-priv', harness: 'codex', sessionFile: codexFile },
      () => undefined,
    );
    expect(cost.coverage.pricedRecords).toBe(1);
    assertSanitized('codex report', cost);
  });

  it('partial report attached to a failing fn', async () => {
    const boom = new Error('task failed');
    let caught: unknown;
    try {
      await measureTask(
        {
          taskId: 'task-priv',
          harness: 'claude-code',
          sessionFile: claudeFile,
        },
        () => {
          throw boom;
        },
      );
    } catch (error) {
      caught = error;
    }
    const attached = (caught as { taskCost?: TaskCostReport }).taskCost;
    expect(attached).toBeDefined();
    assertSanitized('error.taskCost', attached as TaskCostReport);
  });
});
