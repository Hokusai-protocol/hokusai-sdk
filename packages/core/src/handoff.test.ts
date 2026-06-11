import { describe, expect, it } from 'vitest';
import { buildHandoffInstructions } from './handoff.js';

describe('buildHandoffInstructions', () => {
  it('returns a manual Claude Code model switch command', () => {
    const handoff = buildHandoffInstructions({
      recommendation: {
        model: {
          id: 'claude-opus-4-8',
          provider: 'anthropic',
          capabilities: ['reasoning'],
        },
        reason: 'Need more reasoning depth.',
      },
      currentModelId: 'claude-sonnet-4-6',
      harness: 'claude-code',
    });

    expect(handoff).toEqual({
      mechanism: 'manual',
      slashCommand: '/model claude-opus-4-8',
      copyableCommand: '/model claude-opus-4-8',
      instructions: [
        'Run /model claude-opus-4-8 in Claude Code to switch to the recommended model.',
      ],
    });
  });

  it('returns an empty instruction list when no switch is needed', () => {
    const handoff = buildHandoffInstructions({
      recommendation: {
        model: {
          id: 'claude-sonnet-4-6',
          provider: 'anthropic',
          capabilities: ['reasoning'],
        },
        reason: 'Already on the recommended model.',
      },
      currentModelId: 'claude-sonnet-4-6',
      harness: 'claude-code',
    });

    expect(handoff.instructions).toEqual([]);
    expect(handoff.slashCommand).toBe('/model claude-sonnet-4-6');
  });

  it('returns a Codex handoff without Claude slash commands', () => {
    const handoff = buildHandoffInstructions({
      recommendation: {
        model: {
          id: 'gpt-5-codex',
          provider: 'openai',
          capabilities: ['reasoning', 'tool-use'],
        },
        reason: 'Codex needs stronger tool-using reasoning.',
      },
      currentModelId: 'gpt-5',
      harness: 'codex',
    });

    expect(handoff).toEqual({
      mechanism: 'manual',
      slashCommand: 'gpt-5-codex',
      copyableCommand: 'gpt-5-codex',
      instructions: ['Switch Codex to gpt-5-codex before continuing this task.'],
    });
  });

  it('returns no Codex instructions when the current model already matches', () => {
    const handoff = buildHandoffInstructions({
      recommendation: {
        model: {
          id: 'gpt-5-codex',
          provider: 'openai',
          capabilities: ['reasoning', 'tool-use'],
        },
        reason: 'Already on the recommended model.',
      },
      currentModelId: 'gpt-5-codex',
      harness: 'codex',
    });

    expect(handoff).toEqual({
      mechanism: 'manual',
      slashCommand: 'gpt-5-codex',
      copyableCommand: 'gpt-5-codex',
      instructions: [],
    });
  });
});
