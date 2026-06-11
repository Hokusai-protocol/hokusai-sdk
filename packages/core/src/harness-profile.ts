import type { HandoffInstructions } from './handoff.js';
import type { ModelRegistry } from './model-registry.js';
import type { OutcomeReport, OutcomeReportInput } from './outcome.js';
import type {
  HokusaiDispatchPayload,
  HokusaiTaskInput,
  RouteResponse,
} from './schemas.js';
import type { LocalStore } from './storage.js';
import type {
  HarnessPayloadPreview,
  HarnessRecommendation,
} from './adapter.js';

export interface HarnessRoutingProfile {
  harnessName: string;
  subjectId: string;
  registry: ModelRegistry;
  allowedProviders: string[];
  defaultModelId?: string | undefined;
  buildTask(input: {
    taskText: string;
    taskId: string;
    metadata?: Record<string, string> | undefined;
    currentModelId?: string | undefined;
  }): HokusaiTaskInput;
  buildPreview(payload: HokusaiDispatchPayload): HarnessPayloadPreview;
  buildOutcomeReport(input: OutcomeReportInput): OutcomeReport;
  buildHandoff(input: {
    recommendation: HarnessRecommendation;
    currentModelId?: string | undefined;
  }): HandoffInstructions;
  mapRouteResponse?(input: {
    route: RouteResponse;
    recommendation: HarnessRecommendation;
  }): HarnessRecommendation;
  storeCorrelationMetadata?(input: {
    payload: HokusaiDispatchPayload;
    recommendation: HarnessRecommendation;
    payloadHash: string;
    now: string;
    store: LocalStore;
  }): Promise<void>;
}

export interface HarnessCommandError {
  code:
    | 'E_INVALID_INPUT'
    | 'E_MISSING_API_KEY'
    | 'E_MISSING_CONSENT'
    | 'E_UNSUPPORTED_MODEL'
    | 'E_NETWORK'
    | 'E_VALIDATION'
    | 'E_NOT_FOUND';
  message: string;
  remediation: string;
  details?: Record<string, string | string[] | number | boolean>;
}

export type HarnessCommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: HarnessCommandError };
