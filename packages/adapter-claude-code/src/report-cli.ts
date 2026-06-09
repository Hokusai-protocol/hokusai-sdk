import {
  ANTHROPIC_MODELS,
  type BuildSummary,
  FilePluginConfigStore,
  HokusaiClient,
  HokusaiNetworkError,
  InMemoryModelRegistry,
  type TestSummary,
  defaultPluginConfigPath,
  loadPluginConfig,
  type CoarseBucket,
  type CompletionStatus,
  type HokusaiPluginConfig,
} from '@hokusai/core';
import {
  findLatestRoutingDecision,
  previewReportOutcome,
  reportTaskOutcome,
  type LatestRoutingDecision,
  type PreviewReportOutcomeResult,
  type ReportOutcomeInput,
  type ReportOutcomeResult,
} from './commands.js';
import { CLI_EXIT_CODES } from './cli.js';
import { resolveClaudeCodeConfigPath } from './config-path.js';

export const REPORT_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7,
} as const;

export type ReportCliExitCode =
  (typeof REPORT_CLI_EXIT_CODES)[keyof typeof REPORT_CLI_EXIT_CODES];

interface ParsedArgs {
  accepted?: boolean;
  actualModel?: string;
  buildFailures?: number;
  buildStatus?: BuildSummary['status'];
  configPath?: string;
  correlationId?: string;
  costBucket?: CoarseBucket;
  dryRun: boolean;
  json: boolean;
  latencyBucket?: CoarseBucket;
  notes?: string;
  preview: boolean;
  rating?: number;
  recommendedModel?: string;
  rejected?: boolean;
  send: boolean;
  status?: CompletionStatus;
  taskId?: string;
  testFailures?: number;
  testStatus?: TestSummary['status'];
  tokenBucket?: CoarseBucket;
  useLatest: boolean;
}

type ReportCommandResult =
  | {
      ok: true;
      value: PreviewReportOutcomeResult | ReportOutcomeResult;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, string | string[]>;
      };
    };

interface ReportCliDeps {
  createClient?: (config: HokusaiPluginConfig) => HokusaiClient;
  findLatestRoutingDecisionImpl?: (
    input: LatestRoutingDecisionInput,
  ) => Promise<LatestRoutingDecision | undefined>;
  loadConfig?: (input: {
    configPath?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<HokusaiPluginConfig>;
  previewReportOutcomeImpl?: (
    input: ReportOutcomeInput,
    options: Parameters<typeof previewReportOutcome>[1],
  ) => Promise<ReportCommandResult> | ReportCommandResult;
  readStdin?: () => Promise<string>;
  reportTaskOutcomeImpl?: (
    input: ReportOutcomeInput,
    options: Parameters<typeof reportTaskOutcome>[1],
  ) => Promise<ReportCommandResult>;
}

interface LatestRoutingDecisionInput {
  configDir: string;
}

type PipedInput = Partial<
  Pick<
    ReportOutcomeInput,
    | 'actualModel'
    | 'build'
    | 'completionStatus'
    | 'correlationId'
    | 'costBucket'
    | 'latencyBucket'
    | 'notes'
    | 'recommendedModel'
    | 'recommendationAccepted'
    | 'taskId'
    | 'test'
    | 'tokenBucket'
    | 'userRating'
  >
>;

export interface ReportCliRunResult {
  exitCode: ReportCliExitCode;
  stdout: string;
  stderr: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dryRun: false,
    json: false,
    preview: false,
    send: false,
    useLatest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      parsed.json = true;
      continue;
    }

    if (arg === '--correlation-id') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.correlationId = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--use-latest') {
      parsed.useLatest = true;
      continue;
    }

    if (arg === '--recommended-model') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.recommendedModel = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--actual-model') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.actualModel = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--accepted') {
      parsed.accepted = true;
      continue;
    }

    if (arg === '--rejected') {
      parsed.rejected = true;
      continue;
    }

    if (arg === '--status') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.status = value as CompletionStatus;
      }
      index += 1;
      continue;
    }

    if (arg === '--rating') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.rating = Number.parseInt(value, 10);
      }
      index += 1;
      continue;
    }

    if (arg === '--latency-bucket') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.latencyBucket = value as CoarseBucket;
      }
      index += 1;
      continue;
    }

    if (arg === '--cost-bucket') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.costBucket = value as CoarseBucket;
      }
      index += 1;
      continue;
    }

    if (arg === '--token-bucket') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.tokenBucket = value as CoarseBucket;
      }
      index += 1;
      continue;
    }

    if (arg === '--build-status') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.buildStatus = value as BuildSummary['status'];
      }
      index += 1;
      continue;
    }

    if (arg === '--build-failures') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.buildFailures = Number.parseInt(value, 10);
      }
      index += 1;
      continue;
    }

    if (arg === '--test-status') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.testStatus = value as TestSummary['status'];
      }
      index += 1;
      continue;
    }

    if (arg === '--test-failures') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.testFailures = Number.parseInt(value, 10);
      }
      index += 1;
      continue;
    }

    if (arg === '--notes') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.notes = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--preview' || arg === '--preview-only') {
      parsed.preview = true;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.preview = true;
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--send') {
      parsed.send = true;
      continue;
    }

    if (arg === '--config') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.configPath = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--task-id') {
      const value = argv[index + 1];
      if (value !== undefined) {
        parsed.taskId = value;
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
  code: ReportCliExitCode,
  details?: Record<string, string | string[]>,
): ReportCliRunResult {
  const detailText =
    !parsed.json && Array.isArray(details?.fieldErrors)
      ? `\n${details.fieldErrors.join('\n')}`
      : '';
  const body = parsed.json
    ? JSON.stringify(
        {
          error: {
            code,
            message,
            ...(details ? { details } : {}),
          },
        },
        null,
        2,
      )
    : `${message}${detailText}`;

  return {
    exitCode: code,
    stdout: '',
    stderr: `${body}\n`,
  };
}

function parsePipedInput(raw: string): PipedInput {
  if (raw.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Could not parse piped JSON outcome input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Piped JSON outcome input must be an object.');
  }

  return parsed;
}

function buildSummary(
  status: BuildSummary['status'] | undefined,
  failures: number | undefined,
): BuildSummary | TestSummary | undefined {
  if (status === undefined) {
    return undefined;
  }

  return failures === undefined ? { status } : { status, failures };
}

function resolveRecommendationAccepted(
  parsed: ParsedArgs,
  piped: PipedInput,
): boolean | undefined {
  if (parsed.accepted) {
    return true;
  }

  if (parsed.rejected) {
    return false;
  }

  return piped.recommendationAccepted;
}

function withDefaultBucket(
  value: CoarseBucket | undefined,
  label: string,
  notes: string[],
): CoarseBucket {
  if (value !== undefined) {
    return value;
  }

  notes.push(`Defaulted ${label} to "medium".`);
  return 'medium';
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

function renderSuccess(
  parsed: ParsedArgs,
  result: PreviewReportOutcomeResult | ReportOutcomeResult,
  stderrNotes: string[],
): ReportCliRunResult {
  const preview =
    'preview' in result ? result.preview : { lines: [], payload: result.report };
  const isSubmitted = !('preview' in result) && result.submitted;
  const mode = isSubmitted ? 'submitted' : 'preview';

  if (parsed.json) {
    return {
      exitCode: REPORT_CLI_EXIT_CODES.OK,
      stdout: `${JSON.stringify(
        {
          mode,
          submitted: isSubmitted,
          report: result.report,
          preview,
          ...(!('preview' in result) && result.response
            ? { response: result.response }
            : {}),
        },
        null,
        2,
      )}\n`,
      stderr: stderrNotes.length > 0 ? `${stderrNotes.join('\n')}\n` : '',
    };
  }

  const lines =
    'preview' in result ? [...result.preview.lines] : [...buildHumanSendLines(result)];
  if (!parsed.send) {
    lines.push('Preview only. Re-run with --send to submit this report.');
  }

  return {
    exitCode: REPORT_CLI_EXIT_CODES.OK,
    stdout: `${lines.join('\n')}\n`,
    stderr: stderrNotes.length > 0 ? `${stderrNotes.join('\n')}\n` : '',
  };
}

function buildHumanSendLines(result: ReportOutcomeResult): string[] {
  const lines = [
    'Outcome report submitted.',
    `Correlation id: ${result.report.correlationId}`,
    `Completion status: ${result.report.completionStatus}`,
  ];

  if (result.response?.status) {
    lines.push(`Server status: ${result.response.status}`);
  }

  return lines;
}

export async function runReportCli(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: ReportCliDeps = {},
): Promise<ReportCliRunResult> {
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
  const previewReportOutcomeImpl = deps.previewReportOutcomeImpl
    ? deps.previewReportOutcomeImpl
    : (input: ReportOutcomeInput, options: Parameters<typeof previewReportOutcome>[1]) =>
        previewReportOutcome(input, options);
  const reportTaskOutcomeImpl =
    deps.reportTaskOutcomeImpl ?? reportTaskOutcome;
  const findLatestRoutingDecisionImpl =
    deps.findLatestRoutingDecisionImpl ?? findLatestRoutingDecision;

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
    return toMessage(
      parsed,
      error instanceof Error
        ? error.message
        : 'Failed to load Hokusai configuration.',
      REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR,
    );
  }

  if (!config.routingConsentEnabled || !config.outcomeSubmissionEnabled) {
    return toMessage(
      parsed,
      'Outcome submission consent is required. Run `export HOKUSAI_ROUTING_CONSENT=true` and `export HOKUSAI_OUTCOME_OPT_IN=true` to opt in.',
      REPORT_CLI_EXIT_CODES.CONSENT_REQUIRED,
    );
  }

  const apiKey = config.apiKey;
  if (parsed.send && !apiKey) {
    return toMessage(
      parsed,
      'Hokusai outcome submission needs an API key. Set HOKUSAI_API_KEY and re-run.',
      REPORT_CLI_EXIT_CODES.AUTH_REQUIRED,
    );
  }

  const rawStdin = await (deps.readStdin ?? defaultReadStdin)();
  let pipedInput: PipedInput;
  try {
    pipedInput = parsePipedInput(rawStdin);
  } catch (error) {
    return toMessage(
      parsed,
      error instanceof Error ? error.message : 'Invalid piped JSON outcome input.',
      REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
    );
  }

  const configDir = resolveClaudeCodeConfigPath(
    parsed.configPath ? { override: parsed.configPath } : undefined,
  ).dir;
  const latest =
    parsed.useLatest || (parsed.correlationId === undefined && pipedInput.correlationId === undefined)
      ? await findLatestRoutingDecisionImpl({ configDir })
      : undefined;

  if (!parsed.send) {
    parsed.preview = true;
  }

  if (
    (parsed.useLatest || parsed.correlationId === undefined) &&
    pipedInput.correlationId === undefined &&
    !latest
  ) {
    return toMessage(
      parsed,
      'No local routing decision was found. Pass --correlation-id or route a task first.',
      REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
      {
        fieldErrors: ['correlationId: Provide --correlation-id or use --use-latest after routing a task.'],
      },
    );
  }

  const stderrNotes: string[] = [];
  const recommendationAccepted = resolveRecommendationAccepted(parsed, pipedInput);
  const reportInput = {
    taskId:
      parsed.taskId ??
      pipedInput.taskId ??
      latest?.taskId ??
      parsed.correlationId ??
      pipedInput.correlationId ??
      'outcome-report',
    correlationId:
      parsed.correlationId ??
      pipedInput.correlationId ??
      latest?.correlationId ??
      '',
    recommendedModel:
      parsed.recommendedModel ?? pipedInput.recommendedModel ?? '',
    actualModel: parsed.actualModel ?? pipedInput.actualModel ?? '',
    recommendationAccepted,
    completionStatus: (parsed.status ?? pipedInput.completionStatus ?? '') as CompletionStatus,
    latencyBucket: withDefaultBucket(
      parsed.latencyBucket ?? pipedInput.latencyBucket,
      'latency bucket',
      stderrNotes,
    ),
    costBucket: withDefaultBucket(
      parsed.costBucket ?? pipedInput.costBucket,
      'cost bucket',
      stderrNotes,
    ),
    tokenBucket: withDefaultBucket(
      parsed.tokenBucket ?? pipedInput.tokenBucket,
      'token bucket',
      stderrNotes,
    ),
    ...(parsed.rating !== undefined || pipedInput.userRating !== undefined
      ? { userRating: parsed.rating ?? pipedInput.userRating }
      : {}),
    ...(parsed.notes !== undefined || pipedInput.notes !== undefined
      ? { notes: parsed.notes ?? pipedInput.notes }
      : {}),
    ...(parsed.buildStatus !== undefined || pipedInput.build !== undefined
      ? {
          build:
            buildSummary(
              parsed.buildStatus ?? pipedInput.build?.status,
              parsed.buildFailures ?? pipedInput.build?.failures,
            ) ?? { status: 'skipped' },
        }
      : {}),
    ...(parsed.testStatus !== undefined || pipedInput.test !== undefined
      ? {
          test:
            buildSummary(
              parsed.testStatus ?? pipedInput.test?.status,
              parsed.testFailures ?? pipedInput.test?.failures,
            ) ?? { status: 'skipped' },
        }
      : {}),
  } as ReportOutcomeInput;

  let client: HokusaiClient | undefined;
  if (parsed.send) {
    if (!apiKey) {
      throw new Error('Missing Hokusai API key for outcome submission.');
    }

    client =
      deps.createClient?.(config) ??
      new HokusaiClient({
        apiKey,
        baseUrl: config.apiBaseUrl,
      });
  }

  try {
    const result = parsed.send
      ? await reportTaskOutcomeImpl(reportInput, {
          ...(client ? { apiClient: client } : {}),
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
        })
      : await Promise.resolve(
          previewReportOutcomeImpl(reportInput, {
            ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          }),
        );

    if (!result.ok) {
      const fieldErrors = result.error.details?.fieldErrors;
      return toMessage(
        parsed,
        fieldErrors && Array.isArray(fieldErrors)
          ? `${result.error.message}\n${fieldErrors.join('\n')}`
          : result.error.message,
        result.error.code === 'OUTCOME_VALIDATION_FAILED'
          ? REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR
          : REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR,
        result.error.details,
      );
    }

    return renderSuccess(parsed, result.value, stderrNotes);
  } catch (error) {
    if (error instanceof HokusaiNetworkError) {
      return toMessage(
        parsed,
        `Could not reach Hokusai (${config.apiBaseUrl}). Check connectivity and retry. Use /hokusai:doctor for details.`,
        REPORT_CLI_EXIT_CODES.NETWORK_ERROR,
      );
    }

    return toMessage(
      parsed,
      error instanceof Error ? error.message : 'Failed to process outcome report.',
      REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR,
    );
  }
}
