import {
  ANTHROPIC_MODELS,
  DEFAULT_REDACTION_CONFIG,
  InMemoryModelRegistry,
  buildHandoffInstructions,
  type HandoffInstructions,
  type HarnessProfile,
  type SharedCommandOptions,
} from '@hokusai/core';
import {
  getClaudeCodeStateFilePath,
  resolveClaudeCodeConfigPath,
} from './config-path.js';
import {
  buildClaudeCodeTaskPacket,
  previewClaudeCodeTaskPacket,
  type ClaudeCodeBuilderOptions,
  type ClaudeCodeTaskInput,
  type ClaudeCodeTaskPacketPreview,
} from './task-packet.js';

export interface RouteInput extends ClaudeCodeTaskInput {
  taskId?: string;
  modelId?: string;
  metadata?: Record<string, string>;
}

export interface ClaudeCodeCommandOptions extends SharedCommandOptions {
  redactionConfig?: ClaudeCodeBuilderOptions['redactionConfig'];
}

export const claudeCodeHarnessProfile: HarnessProfile<
  RouteInput,
  ClaudeCodeBuilderOptions,
  ClaudeCodeTaskPacketPreview,
  ClaudeCodeCommandOptions
> = {
  harness: 'claude-code',
  harnessLabel: 'Claude Code',
  defaultSubjectId: 'claude-code',
  resolveConfigPath: resolveClaudeCodeConfigPath,
  getStateFilePath: getClaudeCodeStateFilePath,
  createBuilderOptions(options) {
    return {
      redactionConfig: options?.redactionConfig ?? DEFAULT_REDACTION_CONFIG,
      ...(options?.clock ? { clock: options.clock } : {}),
    };
  },
  buildTaskPacket: buildClaudeCodeTaskPacket,
  previewTaskPacket: previewClaudeCodeTaskPacket,
  toTaskId(input, clock) {
    return input.taskId ?? `claude-code-${(clock ?? (() => new Date()))().getTime()}`;
  },
  toPrompt(packet) {
    return JSON.stringify(packet, null, 2);
  },
  modelCatalog: {
    registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
    allowedProviders: ['anthropic'],
    requireAvailable: true,
  },
  buildHandoff({ recommendation, currentModelId }) {
    return buildHandoffInstructions({
      recommendation,
      harness: 'claude-code',
      ...(currentModelId ? { currentModelId } : {}),
    });
  },
  renderHandoff(handoff: HandoffInstructions): string[] {
    if (handoff.instructions.length === 0) {
      return ['Switch in Claude Code: no switch needed.'];
    }

    return [
      `Switch in Claude Code: ${handoff.copyableCommand ?? handoff.slashCommand}`,
    ];
  },
  defaultRecommendationReason:
    'Claude Code routes through the shared Anthropic-backed SDK model registry.',
  routeRecommendationReason:
    'Recommended by the Hokusai router for this Claude Code task.',
  createFallbackConfig({ baseUrl, modelAllowlist }) {
    return {
      apiBaseUrl: baseUrl,
      routingConsentEnabled: false,
      outcomeSubmissionEnabled: false,
      modelAllowlist,
    };
  },
};
