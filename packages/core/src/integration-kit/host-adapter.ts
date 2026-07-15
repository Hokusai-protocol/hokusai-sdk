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
