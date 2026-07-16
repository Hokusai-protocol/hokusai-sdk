import type {
  HostAdapter,
  HostExecuteRequest,
  HostExecutionResult,
  HostPayloadPreview,
  HostTaskContext,
  HokusaiDispatchPayload,
  ModelDefinition,
} from '@hokusai/core';
import {
  parseAiderOutput,
  type AiderUsageTelemetry,
} from './aider-output-parser.js';
import {
  runAiderProcess,
  type AiderProcessResult,
  type RunAiderProcessOptions,
} from './aider-runner.js';

export interface AiderProcessRunner {
  (options: RunAiderProcessOptions): Promise<AiderProcessResult>;
}

export interface AiderHostAdapterOptions {
  taskId: string;
  taskText: string;
  repoPath: string;
  runnableModels: ModelDefinition[];
  aiderPath?: string;
  aiderArgs?: string[];
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onStatus?: (line: string) => void;
  runProcess?: AiderProcessRunner;
}

function toExecutionResult(
  processResult: AiderProcessResult,
  telemetry: AiderUsageTelemetry,
): HostExecutionResult {
  return {
    completionResult: processResult.completionResult,
    ...(telemetry.inputTokens !== undefined
      ? { inputTokens: telemetry.inputTokens }
      : {}),
    ...(telemetry.outputTokens !== undefined
      ? { outputTokens: telemetry.outputTokens }
      : {}),
    ...(telemetry.cacheCreationTokens !== undefined
      ? { cacheCreationTokens: telemetry.cacheCreationTokens }
      : {}),
    ...(telemetry.cacheReadTokens !== undefined
      ? { cacheReadTokens: telemetry.cacheReadTokens }
      : {}),
    ...(telemetry.actualCostUsd !== undefined
      ? { actualCostUsd: telemetry.actualCostUsd }
      : {}),
    wallClockSeconds: processResult.wallClockSeconds,
  };
}

function createTaskContext(taskId: string, taskText: string): HostTaskContext {
  return {
    task: {
      id: taskId,
      prompt: taskText,
    },
  };
}

function previewPayload(payload: HokusaiDispatchPayload): HostPayloadPreview {
  return {
    promptPreview: payload.prompt,
    redactionCount: payload.redactions.length,
  };
}

export function createAiderHostAdapter(
  options: AiderHostAdapterOptions,
): HostAdapter {
  const runProcess = options.runProcess ?? runAiderProcess;

  return {
    collectTaskContext(): Promise<HostTaskContext> {
      return Promise.resolve(createTaskContext(options.taskId, options.taskText));
    },

    discoverRunnableModels(): Promise<ModelDefinition[]> {
      return Promise.resolve(options.runnableModels);
    },

    async executeWithModel(
      request: HostExecuteRequest,
    ): Promise<HostExecutionResult> {
      options.onStatus?.(`Resolved model: ${request.model.id}`);

      const processResult = await runProcess({
        task: request.task.prompt,
        model: request.model.id,
        cwd: options.repoPath,
        ...(options.aiderPath ? { aiderPath: options.aiderPath } : {}),
        ...(options.aiderArgs ? { extraArgs: options.aiderArgs } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.onStdout ? { onStdout: options.onStdout } : {}),
        ...(options.onStderr ? { onStderr: options.onStderr } : {}),
      });

      const telemetry = parseAiderOutput(processResult.combinedOutput);
      if (
        telemetry.model &&
        telemetry.model.trim().toLowerCase() !== request.model.id.toLowerCase()
      ) {
        options.onStatus?.(
          `Aider reported model "${telemetry.model}" but wrapper launched "${request.model.id}". Using the launched model for accounting.`,
        );
      }

      if (telemetry.diagnostics.length > 0) {
        options.onStatus?.(`Telemetry notes: ${telemetry.diagnostics.join(' ')}`);
      }

      return toExecutionResult(processResult, telemetry);
    },

    previewRedactedPayload(payload: HokusaiDispatchPayload): HostPayloadPreview {
      return previewPayload(payload);
    },
  };
}
