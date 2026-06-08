import {
  TASK_PACKET_SCHEMA_VERSION,
  type TaskPacket,
} from '../task-packet.js';

export const claudeCodeTaskPacketFixture: TaskPacket = {
  schemaVersion: TASK_PACKET_SCHEMA_VERSION,
  userIntent: 'Add a new feature while preserving repository conventions.',
  taskFamily: 'feature',
  reasoningDepth: 'standard',
  repositoryScale: 'medium',
  languageSignals: ['TypeScript'],
  frameworkSignals: ['Node.js'],
  availableTools: ['filesystem', 'terminal', 'test runner'],
  constraints: ['Avoid sending full file trees'],
  modelConstraints: ['Should support multi-step editing workflows'],
  providerConstraints: ['Tool use must be available during execution'],
};
