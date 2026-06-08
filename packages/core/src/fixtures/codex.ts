import {
  TASK_PACKET_SCHEMA_VERSION,
  type TaskPacket,
} from '../task-packet.js';

export const codexTaskPacketFixture: TaskPacket = {
  schemaVersion: TASK_PACKET_SCHEMA_VERSION,
  userIntent: 'Refactor a codebase safely and validate behavior with targeted tests.',
  taskFamily: 'refactor',
  reasoningDepth: 'deep',
  repositoryScale: 'large',
  languageSignals: ['Python', 'TypeScript'],
  frameworkSignals: ['React', 'Node.js'],
  availableTools: ['filesystem', 'terminal', 'git'],
  constraints: ['No raw source payloads', 'Prefer additive API changes'],
  modelConstraints: ['Strong repository reasoning is required'],
  providerConstraints: ['Should tolerate long-running coding sessions'],
};
