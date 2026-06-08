import {
  TASK_PACKET_SCHEMA_VERSION,
  type TaskPacket,
} from '../task-packet.js';

export const genericTaskPacketFixture: TaskPacket = {
  schemaVersion: TASK_PACKET_SCHEMA_VERSION,
  userIntent: 'Complete the requested engineering task.',
  taskFamily: 'chore',
  reasoningDepth: 'standard',
};
