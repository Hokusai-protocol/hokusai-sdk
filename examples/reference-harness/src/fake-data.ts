import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HarnessTaskContext,
  HokusaiOutcome,
  OutcomeReport,
  TaskPacket,
} from '@hokusai/core';

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'examples',
);
const FAKE_SECRET = 'fake-secret-DO-NOT-USE';

function readExampleJson<T>(name: string): T {
  const filePath = resolve(examplesDir, name);
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

const EXAMPLE_TASK_PACKET = readExampleJson<TaskPacket>(
  'task-packet.example.json',
);
const EXAMPLE_OUTCOME_REPORT = readExampleJson<OutcomeReport>(
  'outcome-report.example.json',
);

export const FAKE_TASK_CONTEXT: HarnessTaskContext = {
  task: {
    id: 'ref-task-001',
    prompt: `${EXAMPLE_TASK_PACKET.userIntent} Config token: ${FAKE_SECRET}`,
    metadata: {
      source: 'reference-harness',
      issueId: 'FAKE-001',
    },
  },
  harness: {
    name: 'reference-harness',
    version: '0.0.0',
  },
  cwd: '/fake/project/hello-world',
  command: 'hokusai:run',
};

export const FAKE_OUTCOME: HokusaiOutcome = {
  taskId: 'ref-task-001',
  status: 'completed',
  summary: `${EXAMPLE_OUTCOME_REPORT.notes ?? 'Completed the example task.'} api_key=${FAKE_SECRET}`,
};
