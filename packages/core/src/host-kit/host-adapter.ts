import type { ModelDefinition } from '../model-registry.js';
import type { HokusaiDispatchPayload, HokusaiTaskInput } from '../schemas.js';

export interface HostTaskContext {
  task: HokusaiTaskInput;
}

export interface HostExecutionRequest {
  task: HokusaiTaskInput;
  model: { id: string; provider: string };
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

/**
 * The four host-owned pieces of a Hokusai integration. Everything else is
 * handled by runHokusaiLoop and must not be reimplemented per host.
 */
export interface HostAdapter {
  collectTaskContext(): Promise<HostTaskContext>;
  discoverModels(): ModelDefinition[];
  executeTask(request: HostExecutionRequest): Promise<HostExecutionResult>;
  previewPayload(payload: HokusaiDispatchPayload): HostPayloadPreview;
}
