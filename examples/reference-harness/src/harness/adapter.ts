/**
 * The harness side of the integration. **This is the file you replace.**
 *
 * Four things are yours to implement. Everything else — descriptor derivation,
 * anonymization, routing, pricing, row construction, submission — is handled by
 * `../hokusai/loop.ts` and should not need editing.
 *
 *   1. collectTaskContext  — where does a task come from in your harness?
 *   2. discoverModels      — which models can you actually run?
 *   3. executeTask         — run the task; return token usage
 *   4. previewPayload      — show the operator what will be sent
 *
 * @module harness/adapter
 */

import type { HokusaiDispatchPayload, HokusaiTaskInput, ModelDefinition } from '@hokusai/core';
import { FAKE_EXECUTION, FAKE_TASK_CONTEXT } from './fake-data.js';

/**
 * Models this harness can run, and therefore the `allowed_models` the router is
 * allowed to choose from. Ids must be real provider model ids: `pricing.ts`
 * looks them up to derive `actual_cost_usd`, and returns nothing for a model it
 * does not recognize.
 */
export const REFERENCE_MODELS: ModelDefinition[] = [
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    family: 'claude-haiku',
    capabilities: ['tool-use'],
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    family: 'claude-sonnet',
    capabilities: ['reasoning', 'tool-use'],
    default: true,
  },
  {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    family: 'claude-opus',
    capabilities: ['reasoning', 'tool-use'],
  },
];

export interface HarnessTaskContext {
  task: HokusaiTaskInput;
}

/** What your harness knows after it has actually run the task. */
export interface HarnessExecutionResult {
  completionResult: 'success' | 'failure';
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache tokens, if your provider reports them. Priced below input. */
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  wallClockSeconds: number;
}

export interface PayloadPreview {
  promptPreview: string;
  redactionCount: number;
}

export interface ReferenceHarnessAdapter {
  collectTaskContext(): Promise<HarnessTaskContext>;
  discoverModels(): ModelDefinition[];
  executeTask(request: {
    task: HokusaiTaskInput;
    model: { id: string; provider: string };
  }): Promise<HarnessExecutionResult>;
  previewPayload(payload: HokusaiDispatchPayload): PayloadPreview;
}

export interface ReferenceHarnessAdapterOptions {
  /** Override the execution result to demonstrate a different fidelity tier. */
  execution?: Partial<HarnessExecutionResult>;
}

export function createReferenceHarnessAdapter(
  options: ReferenceHarnessAdapterOptions = {},
): ReferenceHarnessAdapter {
  return {
    // TODO(fork): read the task from your harness — a CLI arg, an issue body,
    // a queue message. `task.prompt` is used to derive the descriptor and is
    // then discarded; it never reaches Hokusai unredacted.
    collectTaskContext() {
      return Promise.resolve(FAKE_TASK_CONTEXT);
    },

    // TODO(fork): report the models your harness can actually invoke.
    discoverModels() {
      return REFERENCE_MODELS;
    },

    // TODO(fork): run the task and return real token usage. Neither Pi nor
    // OpenHands exposes a Claude Code-style statusline or transcript, so the
    // layered cost capture in `session-usage.ts` does not apply — return the
    // token counts your provider hands back and let `computeActualCostUsd`
    // price them.
    executeTask() {
      return Promise.resolve({ ...FAKE_EXECUTION, ...options.execution });
    },

    // TODO(fork): render this however your harness surfaces confirmations.
    // The payload is already redacted by the time it arrives here.
    previewPayload(payload: HokusaiDispatchPayload) {
      return {
        promptPreview: payload.prompt,
        redactionCount: payload.redactions.length,
      };
    },
  };
}
