import { describe, expect, it } from 'vitest';
import {
  parseAiderModelLine,
  parseAiderTokenLine,
  summarizeAiderOutput,
} from './accounting.js';

describe('parseAiderModelLine', () => {
  it('parses the "Main model:" banner', () => {
    expect(parseAiderModelLine('Main model: openai/gpt-4o with diff edit format')).toBe(
      'openai/gpt-4o',
    );
  });

  it('parses the shorter "Model:" banner', () => {
    expect(
      parseAiderModelLine(
        'Model: gemini/gemini-2.5-pro-exp-03-25 with diff-fenced edit format',
      ),
    ).toBe('gemini/gemini-2.5-pro-exp-03-25');
  });

  it('preserves provider-prefixed ids untouched', () => {
    expect(
      parseAiderModelLine('Main model: openrouter/anthropic/claude-3.5-sonnet'),
    ).toBe('openrouter/anthropic/claude-3.5-sonnet');
  });

  it('returns undefined for unrelated lines', () => {
    expect(parseAiderModelLine('Applied edit to foo.ts')).toBeUndefined();
  });
});

describe('parseAiderTokenLine', () => {
  it('parses k-suffixed counts and session cost', () => {
    const parsed = parseAiderTokenLine(
      'Tokens: 14k sent, 1.1k received. Cost: $0.06 message, $0.21 session.',
    );
    expect(parsed).toEqual({
      inputTokens: 14_000,
      outputTokens: 1_100,
      messageCostUsd: 0.06,
      sessionCostUsd: 0.21,
    });
  });

  it('parses cache write/read variants', () => {
    const parsed = parseAiderTokenLine(
      'Tokens: 216k sent, 108k cache write, 1.4k received. Cost: $0.75 message, $0.79 session.',
    );
    expect(parsed).toEqual({
      inputTokens: 216_000,
      cacheWriteTokens: 108_000,
      outputTokens: 1_400,
      messageCostUsd: 0.75,
      sessionCostUsd: 0.79,
    });
  });

  it('parses comma-grouped integer counts', () => {
    const parsed = parseAiderTokenLine('Tokens: 11,740 sent, 2,012 received.');
    expect(parsed).toEqual({ inputTokens: 11_740, outputTokens: 2_012 });
  });

  it('returns undefined when neither field is present', () => {
    expect(parseAiderTokenLine('Everything is quiet')).toBeUndefined();
  });

  it('strips ANSI color codes before matching', () => {
    const clean = parseAiderTokenLine(
      '[32mTokens:[0m 100 sent, 50 received. Cost: $0.01 message, $0.02 session.',
    );
    expect(clean).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      messageCostUsd: 0.01,
      sessionCostUsd: 0.02,
    });
  });
});

describe('summarizeAiderOutput', () => {
  it('sums per-message tokens and keeps the last session cost', () => {
    const output = [
      'Main model: openai/gpt-4o with diff edit format',
      'Tokens: 1k sent, 200 received. Cost: $0.01 message, $0.01 session.',
      'Tokens: 800 sent, 300 received. Cost: $0.008 message, $0.018 session.',
    ].join('\n');

    const summary = summarizeAiderOutput(output);
    expect(summary).toEqual({
      reportedModel: 'openai/gpt-4o',
      inputTokens: 1_800,
      outputTokens: 500,
      sessionCostUsd: 0.018,
    });
  });

  it('emits an empty summary when nothing matches', () => {
    const summary = summarizeAiderOutput('nothing to see here\nstill nothing');
    expect(summary).toEqual({});
  });

  it('tolerates zero session cost', () => {
    const summary = summarizeAiderOutput(
      'Tokens: 100 sent, 50 received. Cost: $0.00 message, $0.00 session.',
    );
    expect(summary.sessionCostUsd).toBe(0);
  });
});
