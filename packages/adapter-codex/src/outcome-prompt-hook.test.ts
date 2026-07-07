import { describe, expect, it } from 'vitest';
import { runCodexOutcomePromptHookCli } from './outcome-prompt-hook.js';

describe('runCodexOutcomePromptHookCli', () => {
  it('prints a contribution prompt returned by the adapter helper', async () => {
    const result = await runCodexOutcomePromptHookCli(
      [],
      {},
      {
        readStdin: () => Promise.resolve(JSON.stringify({ status: 'success' })),
        promptOutcomeContributionImpl: () =>
          Promise.resolve({
            ok: true,
            value: {
              shouldPrompt: true,
              status: 'ready',
              message:
                'Looks like this task succeeded - contribute this outcome to improve routing?',
              signals: ['task_completed'],
              reportCommand:
                '$hokusai-report --use-latest --recommended-model gpt-5-codex --actual-model gpt-5-codex --accepted --status succeeded',
              reportArgs: [],
            },
          }),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        'Looks like this task succeeded - contribute this outcome to improve routing?\nRun: $hokusai-report --use-latest --recommended-model gpt-5-codex --actual-model gpt-5-codex --accepted --status succeeded\nThe report skill previews the anonymized payload before submission.\n',
      stderr: '',
    });
  });

  it('stays quiet when no prompt is needed', async () => {
    const result = await runCodexOutcomePromptHookCli(
      [],
      {},
      {
        readStdin: () => Promise.resolve(JSON.stringify({ status: 'running' })),
        promptOutcomeContributionImpl: () =>
          Promise.resolve({
            ok: true,
            value: {
              shouldPrompt: false,
              status: 'no_completion_signal',
              message: 'No successful completion signal detected.',
              signals: [],
            },
          }),
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  });
});
