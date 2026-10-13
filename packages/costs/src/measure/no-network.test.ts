/**
 * REQ-F7 proof for the measure layer: no network modules in production
 * source, no `@hokusai/router` import anywhere root-reachable, no
 * `HOKUSAI_API_KEY` read at runtime, and byte-identical output with or
 * without a key in the environment. Also pins D5: `node:fs` stays out of
 * the measure layer's static graph except the dynamically imported
 * `node-read.ts`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  claudeAssistantLine,
  claudeUsage,
} from '../sources/test-support.js';
import { measureTask } from './measure-task.js';
import type { TaskCostReport } from './types.js';

function walkProductionSources(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkProductionSources(full));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      out.push(full);
  }
  return out;
}

let root: string;
let claudeFile: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hokusai-measure-offline-'));
  claudeFile = join(root, 'session.jsonl');
  await writeFile(
    claudeFile,
    claudeAssistantLine({
      sessionId: 'session-offline',
      uuid: 'off-1',
      timestamp: '2026-01-01T00:01:00Z',
      usage: claudeUsage(1000, 500, 0, 0, 0),
    }),
    'utf8',
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function measureFixture(): Promise<TaskCostReport> {
  const { cost } = await measureTask(
    { taskId: 'task-offline', harness: 'claude-code', sessionFile: claudeFile },
    () => undefined,
  );
  return cost;
}

describe('offline measure layer (REQ-F7)', () => {
  const measureRoot = new URL('.', import.meta.url).pathname;

  it('contains no networking calls in production source', () => {
    for (const file of walkProductionSources(measureRoot))
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /from ['"](node:)?(http|https|net|dgram|dns|undici)['"]|\bfetch\(|XMLHttpRequest/,
      );
  });

  it('never imports @hokusai/router from the measure layer or package root', () => {
    const files = [
      ...walkProductionSources(measureRoot),
      join(measureRoot, '..', 'index.ts'),
    ];
    for (const file of files)
      expect(readFileSync(file, 'utf8')).not.toMatch(/@hokusai\/router/);
  });

  it('keeps node:fs out of the static measure graph except node-read.ts (D5)', () => {
    for (const file of walkProductionSources(measureRoot)) {
      if (file.endsWith('node-read.ts')) continue;
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /from ['"]node:fs(\/promises)?['"]/,
      );
    }
  });

  it('measures a session file without fetch and without reading HOKUSAI_API_KEY', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network attempted');
    });
    const realEnv = process.env;
    const envReads: string[] = [];
    process.env = new Proxy(realEnv, {
      get(target, property) {
        if (typeof property === 'string') envReads.push(property);
        return Reflect.get(target, property) as string | undefined;
      },
    });
    try {
      const report = await measureFixture();
      expect(report.totalUsd).toBeCloseTo(0.0105, 9);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(envReads).not.toContain('HOKUSAI_API_KEY');
    } finally {
      process.env = realEnv;
      fetchSpy.mockRestore();
    }
  });

  it('output is identical with HOKUSAI_API_KEY set, and the key never appears in it', async () => {
    const previous = process.env.HOKUSAI_API_KEY;
    delete process.env.HOKUSAI_API_KEY;
    const without = await measureFixture();
    process.env.HOKUSAI_API_KEY = 'sk-test-sentinel-key';
    try {
      const withKey = await measureFixture();
      expect(withKey).toEqual(without);
      expect(JSON.stringify(withKey)).not.toContain('sk-test-sentinel-key');
    } finally {
      if (previous === undefined) delete process.env.HOKUSAI_API_KEY;
      else process.env.HOKUSAI_API_KEY = previous;
    }
  });
});
