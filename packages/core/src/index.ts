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
export type {
  AdapterError,
  AdapterResult,
  HarnessAdapter,
  HarnessConsentDecision,
  HarnessConsentDecisionState,
  HarnessConsentPromptRequest,
  HarnessConsentPrompter,
  HarnessDiscoveredModel,
  HarnessLocalStorage,
  HarnessModelDiscoveryRequest,
  HarnessModelHandoff,
  HarnessModelHandoffRequest,
  HarnessModelHandoffResult,
  HarnessModelMappingRequest,
  HarnessModelProvider,
  HarnessOutcomeCollectionRequest,
  HarnessOutcomeCollector,
  HarnessPayloadPreview,
  HarnessPayloadPreviewRequest,
  HarnessPayloadPreviewer,
  HarnessRecommendation,
  HarnessRecommendationDisplayRequest,
  HarnessRecommendationRenderer,
  HarnessTaskContext,
  HarnessTaskContextProvider,
  HarnessTaskContextRequest,
} from './adapter.js';
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
  InMemoryCorrelationStorage,
  type CorrelationRecord,
  type CorrelationStorage,
} from './storage.js';
