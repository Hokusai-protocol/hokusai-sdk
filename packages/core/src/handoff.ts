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
  harness: 'claude-code';
}

export function buildHandoffInstructions(
  input: BuildHandoffInstructionsInput,
): HandoffInstructions {
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
