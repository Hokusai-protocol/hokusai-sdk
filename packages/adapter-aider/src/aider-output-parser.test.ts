import { describe, expect, it } from 'vitest';
import { parseAiderOutput } from './aider-output-parser.js';

describe('parseAiderOutput', () => {
  it('parses model, tokens, cache tokens, and cost when all are present', () => {
    const telemetry = parseAiderOutput(`
Model: gpt-5-codex
Tokens: input 12,345 output 678 cache write 900 cache read 1,234
Cost: $0.045600
`);

    expect(telemetry).toEqual({
      model: 'gpt-5-codex',
      inputTokens: 12_345,
      outputTokens: 678,
      cacheCreationTokens: 900,
      cacheReadTokens: 1_234,
      actualCostUsd: 0.0456,
      diagnostics: [],
    });
  });

  it('parses tokens when measured cost is absent', () => {
    const telemetry = parseAiderOutput(`
Main model: claude-sonnet-4-6
prompt_tokens: 200
completion_tokens: 40
`);

    expect(telemetry.model).toBe('claude-sonnet-4-6');
    expect(telemetry.inputTokens).toBe(200);
    expect(telemetry.outputTokens).toBe(40);
    expect(telemetry.actualCostUsd).toBeUndefined();
    expect(telemetry.diagnostics).toContain(
      'Aider did not report measured cost in its summary output.',
    );
  });

  it('parses measured cost when tokens are absent', () => {
    const telemetry = parseAiderOutput(`
Using model: openrouter/deepseek/deepseek-chat
Total cost: $0.0137
`);

    expect(telemetry.model).toBe('openrouter/deepseek/deepseek-chat');
    expect(telemetry.actualCostUsd).toBe(0.0137);
    expect(telemetry.inputTokens).toBeUndefined();
    expect(telemetry.outputTokens).toBeUndefined();
    expect(telemetry.diagnostics).toContain(
      'Aider did not report token usage in its summary output.',
    );
  });

  it('returns diagnostics when no usage data is present', () => {
    const telemetry = parseAiderOutput('plain task output only');

    expect(telemetry).toEqual({
      diagnostics: [
        'Aider did not report a model in its summary output.',
        'Aider did not report token usage in its summary output.',
        'Aider did not report measured cost in its summary output.',
      ],
    });
  });

  it('ignores malformed numeric values', () => {
    const telemetry = parseAiderOutput(`
Model: gpt-5-mini
prompt_tokens: 12x
completion_tokens: ???
Cost: $abc
`);

    expect(telemetry.model).toBe('gpt-5-mini');
    expect(telemetry.inputTokens).toBeUndefined();
    expect(telemetry.outputTokens).toBeUndefined();
    expect(telemetry.actualCostUsd).toBeUndefined();
  });
});
