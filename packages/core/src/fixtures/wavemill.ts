import {
  TASK_PACKET_SCHEMA_VERSION,
  type TaskPacket,
} from '../task-packet.js';

export const wavemillTaskPacketFixture: TaskPacket = {
  schemaVersion: TASK_PACKET_SCHEMA_VERSION,
  userIntent: 'Implement a planned SDK change and verify it with repo checks.',
  taskFamily: 'feature',
  reasoningDepth: 'deep',
  repositoryScale: 'medium',
  languageSignals: ['TypeScript'],
  frameworkSignals: ['Node.js', 'pnpm workspace'],
  availableTools: ['shell', 'git', 'test runner'],
  constraints: ['Do not include raw code in the packet'],
  modelConstraints: ['Prefer strong code synthesis and refactoring support'],
  providerConstraints: ['Must work in a CI-compatible non-interactive harness'],
};
