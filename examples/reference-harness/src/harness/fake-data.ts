/**
 * Safe-to-publish fixtures. **Replace these when you fork** with real task
 * collection and real execution results.
 *
 * The fake secret is deliberately embedded in the prompt so the redaction step
 * has something to catch — a fork can watch it disappear from the preview.
 *
 * @module harness/fake-data
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskDescriptorSignals, TaskPacket } from '@hokusai/core';
import type { HarnessExecutionResult, HarnessTaskContext } from './adapter.js';

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'examples',
);

export const FAKE_SECRET = 'fake-secret-DO-NOT-USE';

function readExampleJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(examplesDir, name), 'utf8')) as T;
}

const EXAMPLE_TASK_PACKET = readExampleJson<TaskPacket>('task-packet.example.json');

export const FAKE_TASK_CONTEXT: HarnessTaskContext = {
  task: {
    id: 'ref-task-001',
    prompt: `${EXAMPLE_TASK_PACKET.userIntent} Config token: ${FAKE_SECRET}`,
    metadata: {
      source: 'reference-harness',
      issueId: 'FAKE-001',
    },
  },
};

/**
 * Categorical repository signals. Counts only — never paths or contents. These
 * drive `repo_size_bucket` and `language` in the derived descriptor.
 */
export const FAKE_REPOSITORY_SIGNALS: TaskDescriptorSignals = {
  fileCount: 420,
  extensionCounts: { ts: 180, tsx: 40, json: 12, md: 8 },
};

/** What a real harness would learn after running the task. */
export const FAKE_EXECUTION: HarnessExecutionResult = {
  completionResult: 'success',
  inputTokens: 18_400,
  outputTokens: 3_200,
  cacheCreationTokens: 12_000,
  cacheReadTokens: 96_000,
  wallClockSeconds: 74.5,
};
