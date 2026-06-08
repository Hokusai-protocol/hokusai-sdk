export {
  HokusaiClient,
  HokusaiClientError,
  type HokusaiClientOptions,
} from './client.js';
export {
  anonymizeText,
  type AnonymizationOptions,
  type AnonymizedText,
  type RedactionMatch,
  type RedactionPattern,
} from './anonymization.js';
export {
  isConsentGranted,
  type ConsentConfig,
  type ConsentScope,
  type ConsentSnapshot,
} from './consent.js';
export {
  InMemoryModelRegistry,
  type ModelCapability,
  type ModelDefinition,
  type ModelRegistry,
  type ModelSelection,
} from './model-registry.js';
export {
  type HokusaiDispatchPayload,
  type HokusaiOutcome,
  type HokusaiTaskInput,
  type OutcomeStatus,
} from './schemas.js';
export {
  TASK_PACKET_SCHEMA_VERSION,
  TaskPacketBuildError,
  buildTaskPacket,
  validateTaskPacket,
  type HarnessContext,
  type ReasoningDepth,
  type RepositoryScale,
  type TaskFamily,
  type TaskPacket,
  type ValidationError,
  type ValidationResult,
} from './task-packet.js';
export {
  claudeCodeTaskPacketFixture,
  codexTaskPacketFixture,
  genericTaskPacketFixture,
  wavemillTaskPacketFixture,
} from './fixtures/index.js';
export {
  InMemoryCorrelationStorage,
  type CorrelationRecord,
  type CorrelationStorage,
} from './storage.js';
