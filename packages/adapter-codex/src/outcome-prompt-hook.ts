import {
  promptOutcomeContributionWithCodex,
  type CodexPluginCommandOptions,
} from './plugin-commands.js';

export interface CodexOutcomePromptHookCliRunResult {
  exitCode: 0;
  stdout: string;
  stderr: string;
}

export interface CodexOutcomePromptHookCliDeps {
  promptOutcomeContributionImpl?: typeof promptOutcomeContributionWithCodex;
  readStdin?: () => Promise<string>;
}

function parseEvent(rawStdin: string, argv: string[]): unknown {
  const raw = rawStdin.trim();
  if (raw.length > 0) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return argv.join(' ');
}

async function defaultReadStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
    );
  }
  return chunks.join('');
}

export async function runCodexOutcomePromptHookCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: CodexOutcomePromptHookCliDeps = {},
): Promise<CodexOutcomePromptHookCliRunResult> {
  const promptOutcomeContributionImpl =
    deps.promptOutcomeContributionImpl ?? promptOutcomeContributionWithCodex;

  try {
    const event = parseEvent(
      await (deps.readStdin ?? defaultReadStdin)(),
      argv,
    );
    const actualModel = env.HOKUSAI_ACTUAL_MODEL;
    const result = await promptOutcomeContributionImpl(
      {
        event,
        ...(actualModel ? { actualModel } : {}),
      },
      { env } satisfies CodexPluginCommandOptions,
    );

    if (!result.ok || !result.value.shouldPrompt) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    const lines = [result.value.message];
    if (result.value.reportCommand) {
      lines.push(`Run: ${result.value.reportCommand}`);
      lines.push(
        'The report skill previews the anonymized payload before submission.',
      );
    }
    if (result.value.remediation) {
      lines.push(result.value.remediation);
    }

    return {
      exitCode: 0,
      stdout: `${lines.join('\n')}\n`,
      stderr: '',
    };
  } catch (error) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `Hokusai outcome prompt skipped: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}
