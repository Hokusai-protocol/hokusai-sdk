import type { ConsentScope } from './consent.js';
import type { ModelDefinition, ModelSelection } from './model-registry.js';
import type {
  HokusaiDispatchPayload,
  HokusaiOutcome,
  HokusaiTaskInput,
} from './schemas.js';

/**
 * Public harness adapter contracts for integrating Hokusai with local coding
 * harnesses.
 *
 * Core owns Hokusai schemas, anonymization, routing, outcome reporting,
 * validation, and persistence abstractions.
 *
 * Adapters own harness command surfaces, local config paths, model names,
 * execution telemetry, and UX rendering.
 *
 * Adapter I/O uses `AdapterResult<T>` so core can handle harness failures
 * without importing harness-specific error types.
 */

export interface AdapterError {
  code: string;
  message: string;
  details?: Record<string, string>;
}

export type AdapterResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: AdapterError;
    };

export interface HarnessTaskContextRequest {
  taskId?: string;
}

export interface HarnessTaskContext {
  task: HokusaiTaskInput;
  harness: {
    name: string;
    version?: string;
  };
  cwd?: string;
  command?: string;
  configPath?: string;
  metadata?: Record<string, string>;
}

export interface HarnessTaskContextProvider {
  collectTaskContext(
    request: HarnessTaskContextRequest,
  ): Promise<AdapterResult<HarnessTaskContext>>;
}

export interface HarnessDiscoveredModel {
  id: string;
  label: string;
  metadata?: Record<string, string>;
}

export interface HarnessModelDiscoveryRequest {
  task: HokusaiTaskInput;
}

export interface HarnessModelMappingRequest {
  harnessModelId: string;
  discoveredModels: HarnessDiscoveredModel[];
  availableModels: ModelDefinition[];
}

export interface HarnessModelProvider {
  discoverModels(
    request: HarnessModelDiscoveryRequest,
  ): Promise<AdapterResult<HarnessDiscoveredModel[]>>;
  mapModel(
    request: HarnessModelMappingRequest,
  ): Promise<AdapterResult<ModelSelection>>;
}

export interface HarnessRecommendation {
  model: ModelSelection;
  reason: string;
  alternatives?: ModelSelection[];
}

export interface HarnessRecommendationDisplayRequest {
  task: HokusaiTaskInput;
  recommendation: HarnessRecommendation;
}

export interface HarnessRecommendationRenderer {
  displayRecommendation(
    request: HarnessRecommendationDisplayRequest,
  ): Promise<AdapterResult<void>> | AdapterResult<void>;
}

export interface HarnessModelHandoffRequest {
  context: HarnessTaskContext;
  payload: HokusaiDispatchPayload;
  model: ModelSelection;
}

export interface HarnessModelHandoffResult {
  handoffId: string;
}

export interface HarnessModelHandoff {
  handoff(
    request: HarnessModelHandoffRequest,
  ): Promise<AdapterResult<HarnessModelHandoffResult>>;
}

export interface HarnessOutcomeCollectionRequest {
  task: HokusaiTaskInput;
  model: ModelSelection;
}

export interface HarnessOutcomeCollector {
  collectOutcome(
    request: HarnessOutcomeCollectionRequest,
  ): Promise<AdapterResult<HokusaiOutcome>>;
}

export interface HarnessPayloadPreview {
  summary: string;
  promptPreview: string;
  redactionCount: number;
}

export interface HarnessPayloadPreviewRequest {
  payload: HokusaiDispatchPayload;
}

export interface HarnessPayloadPreviewer {
  previewPayload(
    request: HarnessPayloadPreviewRequest,
  ):
    | Promise<AdapterResult<HarnessPayloadPreview>>
    | AdapterResult<HarnessPayloadPreview>;
}

export type HarnessConsentDecisionState = 'granted' | 'denied' | 'dismissed';

export interface HarnessConsentPromptRequest {
  scope: ConsentScope;
  reason: string;
}

export interface HarnessConsentDecision {
  outcome: HarnessConsentDecisionState;
  scope: ConsentScope;
}

export interface HarnessConsentPrompter {
  promptConsent(
    request: HarnessConsentPromptRequest,
  ): Promise<AdapterResult<HarnessConsentDecision>>;
}

export interface HarnessLocalStorage {
  get(key: string): Promise<AdapterResult<string | undefined>>;
  set(key: string, value: string): Promise<AdapterResult<void>>;
  delete(key: string): Promise<AdapterResult<void>>;
}

export interface HarnessAdapter {
  context: HarnessTaskContextProvider;
  models: HarnessModelProvider;
  recommendations: HarnessRecommendationRenderer;
  handoff?: HarnessModelHandoff;
  outcomes: HarnessOutcomeCollector;
  payloads: HarnessPayloadPreviewer;
  consent: HarnessConsentPrompter;
  storage: HarnessLocalStorage;
}
