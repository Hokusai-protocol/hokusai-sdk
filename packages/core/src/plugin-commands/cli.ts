import {
  FilePluginConfigStore,
  HokusaiClient,
  defaultPluginConfigPath,
  loadPluginConfig,
  type AdapterResult,
  type HokusaiPluginConfig,
} from '../index.js';
import {
  DEFAULT_ROUTING_OBJECTIVE,
  parseRoutingObjective,
  routingObjectiveToApiValue,
  type RoutingObjective,
} from '../routing-objective.js';
import { displayTaskRecommendation } from './commands.js';
import type { HarnessProfile } from './harness-profile.js';
import type {
  DeclineRecommendationInput,
  DeclineRecommendationResult,
  PluginCliExitCodes,
  RouteInputBase,
  RouteResult,
  SharedCommandOptions,
} from './types.js';

export const CLI_EXIT_CODES = {
  OK: 0,
  AUTH_REQUIRED: 2,
  CONSENT_REQUIRED: 3,
  NETWORK_ERROR: 4,
  UNSUPPORTED_MODEL: 5,
  EMPTY_TASK: 6,
  UNKNOWN_ERROR: 1,
} as const satisfies PluginCliExitCodes;

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];

export interface CliRunResult {
  exitCode: CliExitCode;
  stdout: string;
  stderr: string;
}

interface ParsedArgs {
  correlationId?: string;
  configPath?: string;
  decline: boolean;
  json: boolean;
  objective?: string;
  reason?: string;
  task?: string;
}

export interface PluginCliDeps<
  TRouteInput extends RouteInputBase,
  TOptions extends SharedCommandOptions,
> {
  createClient?: (config: HokusaiPluginConfig) => HokusaiClient;
  loadConfig?: (input: {
    configPath?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<HokusaiPluginConfig>;
  readStdin?: () => Promise<string>;
  routeTaskImpl?: (
    input: TRouteInput,
    options: TOptions,
  ) => Promise<RouteResult>;
  declineRecommendationImpl?: (
    input: DeclineRecommendationInput,
    options: TOptions,
  ) => Promise<AdapterResult<DeclineRecommendationResult>>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    decline: false,
    json: false,
  };

  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--json') {
      parsed.json = true;
      continue;
    }

    if (arg === '--task') {
      parsed.task = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--decline') {
      parsed.decline = true;
      continue;
    }

    if (arg === '--correlation-id') {
      parsed.correlationId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--reason') {
      parsed.reason = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--objective') {
      parsed.objective = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--config') {
      const configPath = argv[index + 1];
      if (configPath !== undefined) {
        parsed.configPath = configPath;
      }
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  // Fall back to a positional task so `hokusai-route "the task"` works even
  // when the caller omits `--task`. An explicit `--task ""` is left untouched.
  if (parsed.task === undefined && positional.length > 0) {
    parsed.task = positional.join(' ');
  }

  return parsed;
}

function toConfigFilePath(
  profile: Pick<
    HarnessProfile<RouteInputBase, unknown, unknown, SharedCommandOptions>,
    'resolveConfigPath'
  >,
  configPath?: string,
): string | undefined {
  if (!configPath) {
    return undefined;
  }

  return configPath.endsWith('.json')
    ? configPath
    : defaultPluginConfigPath(profile.resolveConfigPath({ override: configPath }).dir);
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

function extractModelId(message: string): string {
  const match = message.match(/model recommendation: ([^.\s]+)/i);
  if (match?.[1]) {
    return match[1];
  }

  const fallbackMatch = message.match(/Model ([^ ]+)/);
  return fallbackMatch?.[1] ?? 'unknown';
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

export function createRunCli<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(
  profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>,
  impls: {
    routeTask: (input: TRouteInput, options?: TOptions) => Promise<RouteResult>;
    declineRecommendation: (
      input: DeclineRecommendationInput,
      options?: TOptions,
    ) => Promise<AdapterResult<DeclineRecommendationResult>>;
    buildRouteInput(taskText: string): TRouteInput;
  },
) {
  return async function runCli(
    argv: string[],
    env: NodeJS.ProcessEnv,
    deps: PluginCliDeps<TRouteInput, TOptions> = {},
  ): Promise<CliRunResult> {
    const parsed = parseArgs(argv);

    // Resolve the routing objective flag early so a typo fails fast, before any
    // stdin read or network call. Precedence: flag > env/config > default.
    let flagObjective: RoutingObjective | undefined;
    if (parsed.objective !== undefined) {
      flagObjective = parseRoutingObjective(parsed.objective);
      if (!flagObjective) {
        return toMessage(
          parsed,
          `Unknown routing objective "${parsed.objective}". Choose speed, cost, or reliability.`,
          CLI_EXIT_CODES.UNKNOWN_ERROR,
        );
      }
    }

    const registry = profile.modelCatalog.registry;
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
    const routeTaskImpl = deps.routeTaskImpl ?? impls.routeTask;
    const declineRecommendationImpl =
      deps.declineRecommendationImpl ?? impls.declineRecommendation;

    let config: HokusaiPluginConfig;
    try {
      const configPath = toConfigFilePath(profile, parsed.configPath);
      config = await loadConfigImpl(
        configPath === undefined ? { env } : { configPath, env },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to load Hokusai configuration.';
      return toMessage(parsed, message, CLI_EXIT_CODES.UNKNOWN_ERROR);
    }

    if (parsed.decline) {
      if (!parsed.correlationId?.trim()) {
        return toMessage(
          parsed,
          'Provide --correlation-id when declining a routing recommendation.',
          CLI_EXIT_CODES.UNKNOWN_ERROR,
        );
      }

      const result = await declineRecommendationImpl(
        {
          correlationId: parsed.correlationId.trim(),
          ...(parsed.reason?.trim() ? { reason: parsed.reason.trim() } : {}),
        },
        {
          registry,
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
        } as TOptions,
      );

      if (!result.ok) {
        return toMessage(parsed, result.error.message, CLI_EXIT_CODES.UNKNOWN_ERROR);
      }

      const body = parsed.json
        ? JSON.stringify(result.value, null, 2)
        : `Declined recommendation for correlation ${result.value.correlationId}.\n`;

      return {
        exitCode: CLI_EXIT_CODES.OK,
        stdout: parsed.json ? `${body}\n` : body,
        stderr: '',
      };
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

    // Always send an objective; reliability is the default unless overridden by
    // the --objective flag, HOKUSAI_OBJECTIVE, or persisted config.
    const objective =
      flagObjective ?? config.routingObjective ?? DEFAULT_ROUTING_OBJECTIVE;
    const routeInput = impls.buildRouteInput(taskText);
    const routeInputWithObjective = {
      ...routeInput,
      metadata: {
        ...routeInput.metadata,
        objective: routingObjectiveToApiValue(objective),
      },
    } as TRouteInput;

    const result = await routeTaskImpl(routeInputWithObjective, {
      apiClient: client,
      registry,
      settings: {
        routingEnabled: true,
        outcomeReportingEnabled: config.outcomeSubmissionEnabled,
      },
      ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
    } as TOptions);

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
          `Hokusai recommended a model not available in ${profile.harnessLabel} (${recommendedModel}). Suggested fallbacks: ${suggestions}.`,
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
            correlationId: result.value.correlationId,
            routingDecisionId: result.value.routingDecisionId,
            handoff: result.value.handoff,
            ...(result.value.route?.requestId
              ? { requestId: result.value.route.requestId }
              : {}),
            ...(result.value.route?.routeId
              ? { routeId: result.value.route.routeId }
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
    lines.push(`Correlation ID: ${result.value.correlationId}`);
    lines.push('');
    lines.push(...profile.renderHandoff(result.value.handoff));
    if (result.value.route?.requestId) {
      lines.push(`Request ID: ${result.value.route.requestId}`);
    }

    return {
      exitCode: CLI_EXIT_CODES.OK,
      stdout: `${lines.join('\n')}\n`,
      stderr: '',
    };
  };
}
