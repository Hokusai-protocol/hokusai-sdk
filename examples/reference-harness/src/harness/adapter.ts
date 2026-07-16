/**
 * The harness side of the integration. **This is the file you replace.**
 *
 * Four things are yours to implement. Everything else — descriptor derivation,
 * anonymization, routing, pricing, row construction, submission — is handled by
 * `@hokusai/core`'s reusable integration kit and should not need editing.
 *
 *   1. collectTaskContext  — where does a task come from in your harness?
 *   2. discoverRunnableModels — which models can you actually run?
 *   3. executeWithModel       — run the task; return token usage
 *   4. previewRedactedPayload — show the operator what will be sent
 *
 * @module harness/adapter
 */

import type {
  HostAdapter,
  HostExecutionResult,
  HostPayloadPreview,
  HostTaskContext,
  HokusaiDispatchPayload,
  ModelDefinition,
} from '@hokusai/core';
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

export type HarnessTaskContext = HostTaskContext;

/** What your harness knows after it has actually run the task. */
export type HarnessExecutionResult = HostExecutionResult;

export type PayloadPreview = HostPayloadPreview;

export type ReferenceHarnessAdapter = HostAdapter;

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
    discoverRunnableModels() {
      return REFERENCE_MODELS;
    },

    // TODO(fork): run the task and return real token usage. Neither Pi nor
    // OpenHands exposes a Claude Code-style statusline or transcript, so the
    // layered cost capture in `session-usage.ts` does not apply. OpenHands
    // exposes `RouterLLM` plus LLM/conversation token-cost metrics — feed
    // those into `computeActualCostUsd`. For Pi and simpler harnesses,
    // return the token counts your provider hands back and let
    // `computeActualCostUsd` price them.
    executeWithModel() {
      return Promise.resolve({ ...FAKE_EXECUTION, ...options.execution });
    },

    // TODO(fork): render this however your harness surfaces confirmations.
    // The payload is already redacted by the time it arrives here.
    previewRedactedPayload(payload: HokusaiDispatchPayload) {
      return {
        promptPreview: payload.prompt,
        redactionCount: payload.redactions.length,
      };
    },
  };
}
