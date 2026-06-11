import type { HarnessRecommendation } from './adapter.js';

export interface HandoffInstructions {
  mechanism: 'manual';
  slashCommand: string;
  copyableCommand?: string;
  instructions: string[];
}

export interface BuildHandoffInstructionsInput {
  recommendation: HarnessRecommendation;
  currentModelId?: string;
  harness: 'claude-code' | 'codex';
}

export function buildHandoffInstructions(
  input: BuildHandoffInstructionsInput,
): HandoffInstructions {
  if (input.harness === 'codex') {
    const recommendedModelId = input.recommendation.model.id.trim();
    const currentModelId = input.currentModelId?.trim();

    return {
      mechanism: 'manual',
      slashCommand: recommendedModelId,
      copyableCommand: recommendedModelId,
      instructions:
        currentModelId && currentModelId === recommendedModelId
          ? []
          : [
              `Switch Codex to ${recommendedModelId} before continuing this task.`,
            ],
    };
  }

  const slashCommand = `/model ${input.recommendation.model.id}`;
  const currentModelId = input.currentModelId?.trim();
  const recommendedModelId = input.recommendation.model.id.trim();

  if (
    input.harness === 'claude-code' &&
    currentModelId &&
    currentModelId === recommendedModelId
  ) {
    return {
      mechanism: 'manual',
      slashCommand,
      copyableCommand: slashCommand,
      instructions: [],
    };
  }

  return {
    mechanism: 'manual',
    slashCommand,
    copyableCommand: slashCommand,
    instructions: [
      `Run ${slashCommand} in Claude Code to switch to the recommended model.`,
    ],
  };
}
