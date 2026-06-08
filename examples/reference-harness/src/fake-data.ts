import type { HarnessTaskContext, HokusaiOutcome } from '@hokusai/core';

export const FAKE_TASK_CONTEXT: HarnessTaskContext = {
  task: {
    id: 'ref-task-001',
    prompt: 'Add a hello-world endpoint. Config token: fake-secret-DO-NOT-USE',
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
  summary: 'Added the endpoint at /hello. api_key=fake-secret-DO-NOT-USE',
};
