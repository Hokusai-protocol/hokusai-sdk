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
import type { RouteContextProjection } from './plugin-commands/types.js';

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
    modelConstraints?: string[] | undefined;
    providerConstraints?: string[] | undefined;
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
    /**
     * The routing decision's server id, and the categorical context it was made
     * from. A harness that does not persist these cannot later build a
     * contribution row: the row is attributed to its decision through
     * `inference_log_id`, and needs the allowed models and task descriptor the
     * route actually used.
     */
    routeContext: RouteContextProjection;
    inferenceLogId?: string | undefined;
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
