import type { StageCostInput } from '../contribution/builder.js';
import type { ModelEvidence } from '../contribution/schema.js';
import type { ModelDefinition } from '../model-registry.js';
import type { HokusaiDispatchPayload, HokusaiTaskInput } from '../schemas.js';

export interface HostTaskContext {
  task: HokusaiTaskInput;
}

export interface HostExecuteRequest {
  task: HokusaiTaskInput;
  model: ModelDefinition;
}

export interface HostExecutionResult {
  completionResult: 'success' | 'failure';
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  wallClockSeconds: number;
  /**
   * The run's `@hokusai/costs` report (`measureTask` / `tracker.summary()`),
   * which becomes the row's `task_cost` (HOK-3412). Without it the stage is
   * reported unmeasured.
   */
  cost?: StageCostInput;
  /** How the host knows which model ran. Default `requested_only`. */
  modelEvidence?: ModelEvidence;
}

export interface HostPayloadPreview {
  promptPreview: string;
  redactionCount: number;
}

export interface HostAdapter {
  collectTaskContext(): Promise<HostTaskContext>;
  discoverRunnableModels(
    context: HostTaskContext,
  ): Promise<ModelDefinition[]> | ModelDefinition[];
  executeWithModel(request: HostExecuteRequest): Promise<HostExecutionResult>;
  previewRedactedPayload(
    payload: HokusaiDispatchPayload,
  ): HostPayloadPreview | Promise<HostPayloadPreview>;
}
