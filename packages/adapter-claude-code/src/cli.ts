import {
  ANTHROPIC_MODELS,
  FilePluginConfigStore,
  HokusaiClient,
  InMemoryModelRegistry,
  defaultPluginConfigPath,
  loadPluginConfig,
  type HokusaiPluginConfig,
} from '@hokusai/core';
import {
  displayTaskRecommendation,
  routeTask,
  type RouteResult,
} from './commands.js';

export const CLI_EXIT_CODES = {
  OK: 0,
  AUTH_REQUIRED: 2,
  CONSENT_REQUIRED: 3,
  NETWORK_ERROR: 4,
  UNSUPPORTED_MODEL: 5,
  EMPTY_TASK: 6,
  UNKNOWN_ERROR: 1,
} as const;

export type CliExitCode =
  (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];

export interface CliRunResult {
  exitCode: CliExitCode;
  stdout: string;
  stderr: string;
}

interface ParsedArgs {
  configPath?: string;
  json: boolean;
  task?: string;
}

interface CliDeps {
  createClient?: (config: HokusaiPluginConfig) => HokusaiClient;
  loadConfig?: (input: {
    configPath?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<HokusaiPluginConfig>;
  readStdin?: () => Promise<string>;
  routeTaskImpl?: (
    input: { taskText: string },
    options: Parameters<typeof routeTask>[1],
  ) => Promise<RouteResult>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      parsed.json = true;
      continue;
    }

    if (arg === '--task') {
      parsed.task = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--config') {
      const configPath = argv[index + 1];
      if (configPath !== undefined) {
        parsed.configPath = configPath;
      }
      index += 1;
    }
  }

  return parsed;
}

function toConfigFilePath(configPath?: string): string | undefined {
  if (!configPath) {
    return undefined;
  }

  return configPath.endsWith('.json')
    ? configPath
    : defaultPluginConfigPath(configPath);
}

function toMessage(
  parsed: ParsedArgs,
  message: string,
  code: CliExitCode,
): CliRunResult {
  const body = parsed.json
    ? JSON.stringify(
        {
          error: {
            code,
            message,
          },
        },
        null,
        2,
      )
    : message;

  return {
    exitCode: code,
    stdout: '',
    stderr: `${body}\n`,
  };
}

export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: CliDeps = {},
): Promise<CliRunResult> {
  const parsed = parseArgs(argv);
  const registry = new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const loadConfigImpl =
    deps.loadConfig ??
    ((input: { configPath?: string; env: NodeJS.ProcessEnv }) =>
      loadPluginConfig({
        env: input.env,
        registry,
        ...(input.configPath
          ? { store: new FilePluginConfigStore(input.configPath) }
          : {}),
      }));
  const routeTaskImpl = deps.routeTaskImpl ?? routeTask;

  let config: HokusaiPluginConfig;
  try {
    const configPath = toConfigFilePath(parsed.configPath);
    config = await loadConfigImpl(
      configPath === undefined
        ? { env }
        : {
            configPath,
            env,
          },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to load Hokusai configuration.';
    return toMessage(parsed, message, CLI_EXIT_CODES.UNKNOWN_ERROR);
  }

  if (!config.apiKey) {
    return toMessage(
      parsed,
      'Hokusai routing needs an API key. Set HOKUSAI_API_KEY and re-run.',
      CLI_EXIT_CODES.AUTH_REQUIRED,
    );
  }

  if (!config.routingConsentEnabled) {
    return toMessage(
      parsed,
      'Routing consent is required. Run `export HOKUSAI_ROUTING_CONSENT=true` to opt in.',
      CLI_EXIT_CODES.CONSENT_REQUIRED,
    );
  }

  const taskText = (parsed.task ?? (await (deps.readStdin?.() ?? readStdin()))).trim();
  if (taskText.length === 0) {
    return toMessage(
      parsed,
      'Provide a task description after the slash command, e.g. `/hokusai:route refactor the auth middleware`.',
      CLI_EXIT_CODES.EMPTY_TASK,
    );
  }

  const client =
    deps.createClient?.(config) ??
    new HokusaiClient({
      apiKey: config.apiKey,
      baseUrl: config.apiBaseUrl,
    });

  const result = await routeTaskImpl(
    { taskText },
    {
      apiClient: client,
      registry,
      settings: {
        routingEnabled: true,
        outcomeReportingEnabled: config.outcomeSubmissionEnabled,
      },
      ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
    },
  );

  if (!result.ok) {
    if (result.error.code === 'NETWORK_ERROR') {
      return toMessage(
        parsed,
        `Could not reach Hokusai (${config.apiBaseUrl}). Check connectivity and retry. Use /hokusai:doctor for details.`,
        CLI_EXIT_CODES.NETWORK_ERROR,
      );
    }

    if (
      result.error.code === 'PROVIDER_NOT_ALLOWED' ||
      result.error.code === 'MODEL_NOT_ALLOWED' ||
      result.error.code === 'MODEL_UNAVAILABLE' ||
      result.error.code === 'UNKNOWN_MODEL'
    ) {
      const suggestions = Array.isArray(result.error.details?.suggestions)
        ? result.error.details.suggestions.join(', ')
        : 'none available';
      const recommendedModel = extractModelId(result.error.message);

      return toMessage(
        parsed,
        `Hokusai recommended a model not available in Claude Code (${recommendedModel}). Suggested fallbacks: ${suggestions}.`,
        CLI_EXIT_CODES.UNSUPPORTED_MODEL,
      );
    }

    return toMessage(parsed, result.error.message, CLI_EXIT_CODES.UNKNOWN_ERROR);
  }

  const recommendation = result.value.recommendation;
  if (parsed.json) {
    return {
      exitCode: CLI_EXIT_CODES.OK,
      stdout: `${JSON.stringify(
        {
          model: recommendation.model.id,
          provider: recommendation.model.provider,
          reason: recommendation.reason,
          ...(recommendation.confidence === undefined
            ? {}
            : { confidence: recommendation.confidence }),
          ...(recommendation.alternatives?.length
            ? {
                alternatives: recommendation.alternatives.map((alternative) => ({
                  model: alternative.model.id,
                  provider: alternative.model.provider,
                  ...(alternative.reason === undefined
                    ? {}
                    : { reason: alternative.reason }),
                  ...(alternative.confidence === undefined
                    ? {}
                    : { confidence: alternative.confidence }),
                })),
              }
            : {}),
          ...(result.value.route?.requestId
            ? { requestId: result.value.route.requestId }
            : {}),
        },
        null,
        2,
      )}\n`,
      stderr: '',
    };
  }

  const display = displayTaskRecommendation(recommendation);
  const lines = [...display.lines];
  if (result.value.route?.requestId) {
    lines.push(`Request ID: ${result.value.route.requestId}`);
  }

  return {
    exitCode: CLI_EXIT_CODES.OK,
    stdout: `${lines.join('\n')}\n`,
    stderr: '',
  };
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
    );
  }

  return chunks.join('');
}

function extractModelId(message: string): string {
  const match = message.match(/model recommendation: ([^.\s]+)/i);
  if (match?.[1]) {
    return match[1];
  }

  const fallbackMatch = message.match(/Model ([^ ]+)/);
  return fallbackMatch?.[1] ?? 'unknown';
}
