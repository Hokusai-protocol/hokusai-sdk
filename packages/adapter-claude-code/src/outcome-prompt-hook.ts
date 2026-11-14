import {
  FilePluginConfigStore,
  buildOutcomeContributionPrompt,
  defaultPluginConfigPath,
  loadPluginConfig,
  type HokusaiPluginConfig,
  type StoredRoutingDecision,
} from '@hokusai/core';
import { claudeCodeHarnessProfile } from './profile.js';
import { findRoutingDecision } from './commands.js';

export interface OutcomePromptHookCliRunResult {
  exitCode: 0;
  stdout: string;
  stderr: string;
}

export interface OutcomePromptHookCliDeps {
  findRoutingDecisionImpl?: (input: {
    configDir: string;
    sessionId?: string | undefined;
  }) => Promise<StoredRoutingDecision | undefined>;
  loadConfig?: (input: {
    configPath?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<HokusaiPluginConfig>;
  readStdin?: () => Promise<string>;
}

interface ParsedArgs {
  configPath?: string;
  eventText: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const eventParts: string[] = [];
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--config' && next !== undefined) {
      configPath = next;
      index += 1;
      continue;
    }

    if (arg !== undefined) {
      eventParts.push(arg);
    }
  }

  return {
    ...(configPath ? { configPath } : {}),
    eventText: eventParts.join(' '),
  };
}

function toConfigFilePath(configPath?: string): string | undefined {
  if (!configPath) {
    return undefined;
  }

  return configPath.endsWith('.json')
    ? configPath
    : defaultPluginConfigPath(
        claudeCodeHarnessProfile.resolveConfigPath({ override: configPath })
          .dir,
      );
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

/** The Claude Code session the hook event belongs to (`session_id`), if any. */
function eventSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return undefined;
  }
  const sessionId = (event as Record<string, unknown>).session_id;
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : undefined;
}

function parseEvent(rawStdin: string, eventText: string): unknown {
  const raw = rawStdin.trim();
  if (raw.length > 0) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return eventText;
}

function renderPrompt(
  prompt: ReturnType<typeof buildOutcomeContributionPrompt>,
): string {
  if (!prompt.shouldPrompt) {
    return '';
  }

  const lines = [prompt.message];
  if (prompt.reportCommand) {
    lines.push(`Run: ${prompt.reportCommand}`);
    lines.push(
      'The report command previews the anonymized payload before submission.',
    );
  }
  if (prompt.remediation) {
    lines.push(prompt.remediation);
  }

  return `${lines.join('\n')}\n`;
}

export async function runOutcomePromptHookCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: OutcomePromptHookCliDeps = {},
): Promise<OutcomePromptHookCliRunResult> {
  const parsed = parseArgs(argv);
  const configDir = claudeCodeHarnessProfile.resolveConfigPath(
    parsed.configPath ? { override: parsed.configPath } : undefined,
  ).dir;
  const configPath = toConfigFilePath(parsed.configPath);
  const loadConfigImpl =
    deps.loadConfig ??
    ((input: { configPath?: string; env: NodeJS.ProcessEnv }) =>
      loadPluginConfig({
        env: input.env,
        registry: claudeCodeHarnessProfile.modelCatalog.registry,
        ...(input.configPath
          ? { store: new FilePluginConfigStore(input.configPath) }
          : {}),
      }));

  try {
    const [config, rawStdin] = await Promise.all([
      loadConfigImpl(configPath === undefined ? { env } : { configPath, env }),
      (deps.readStdin ?? defaultReadStdin)(),
    ]);
    const event = parseEvent(rawStdin, parsed.eventText);
    // Only a route recorded in this same session can be this task's. Without a
    // session id there is no exact match, and no route is offered (HOK-3364).
    const sessionId = eventSessionId(event);
    const latestRoute = sessionId
      ? await (deps.findRoutingDecisionImpl ?? findRoutingDecision)({ configDir, sessionId })
      : undefined;
    const actualModel = env.HOKUSAI_ACTUAL_MODEL;
    const prompt = buildOutcomeContributionPrompt({
      event,
      ...(latestRoute ? { latestRoute } : {}),
      outcomeOptIn: config.outcomeSubmissionEnabled,
      reportCommand: '/hokusai:report',
      ...(actualModel ? { actualModel } : {}),
    });

    return {
      exitCode: 0,
      stdout: renderPrompt(prompt),
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
