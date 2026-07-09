import {
  FilePluginConfigStore,
  HokusaiClient,
  HokusaiNetworkError,
  defaultPluginConfigPath,
  loadPluginConfig,
  resolveActualCostUsd,
  type BuildSummary,
  type CoarseBucket,
  type CompletionStatus,
  type HokusaiPluginConfig,
  type TestSummary,
} from '../index.js';
import { CLI_EXIT_CODES } from './cli.js';
import type { HarnessProfile } from './harness-profile.js';
import type {
  LatestRoutingDecision,
  PreviewReportOutcomeResult,
  ReportCliExitCodes,
  ReportOutcomeInputWithTaskId,
  ReportOutcomeResult,
  RouteInputBase,
  SharedCommandOptions,
} from './types.js';

export const REPORT_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7,
} as const satisfies ReportCliExitCodes;

export type ReportCliExitCode =
  (typeof REPORT_CLI_EXIT_CODES)[keyof typeof REPORT_CLI_EXIT_CODES];

interface ParsedArgs {
  accepted?: boolean;
  actualCostUsd?: number;
  actualModel?: string;
  buildFailures?: number;
  buildStatus?: BuildSummary['status'];
  configPath?: string;
  correlationId?: string;
  costBucket?: CoarseBucket;
  dryRun: boolean;
  inferenceLogId?: string;
  inputTokens?: number;
  json: boolean;
  latencyBucket?: CoarseBucket;
  notes?: string;
  outputTokens?: number;
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
  wallClockSeconds?: number;
}

type ReportCommandResult =
  | { ok: true; value: PreviewReportOutcomeResult | ReportOutcomeResult }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, string | string[]>;
      };
    };

export interface ReportCliDeps<TOptions extends SharedCommandOptions> {
  createClient?: (config: HokusaiPluginConfig) => HokusaiClient;
  findLatestRoutingDecisionImpl?: (input: {
    configDir: string;
  }) => Promise<LatestRoutingDecision | undefined>;
  loadConfig?: (input: {
    configPath?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<HokusaiPluginConfig>;
  previewReportOutcomeImpl?: (
    input: ReportOutcomeInputWithTaskId,
    options: TOptions,
  ) => Promise<ReportCommandResult> | ReportCommandResult;
  readStdin?: () => Promise<string>;
  reportTaskOutcomeImpl?: (
    input: ReportOutcomeInputWithTaskId,
    options: TOptions,
  ) => Promise<ReportCommandResult>;
}

type PipedInput = Partial<
  Pick<
    ReportOutcomeInputWithTaskId,
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
    const next = argv[index + 1];

    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--correlation-id' && next !== undefined) {
      parsed.correlationId = next;
      index += 1;
    } else if (arg === '--use-latest') {
      parsed.useLatest = true;
    } else if (arg === '--recommended-model' && next !== undefined) {
      parsed.recommendedModel = next;
      index += 1;
    } else if (arg === '--actual-model' && next !== undefined) {
      parsed.actualModel = next;
      index += 1;
    } else if (arg === '--accepted') {
      parsed.accepted = true;
    } else if (arg === '--rejected') {
      parsed.rejected = true;
    } else if (arg === '--status' && next !== undefined) {
      parsed.status = next as CompletionStatus;
      index += 1;
    } else if (arg === '--rating' && next !== undefined) {
      parsed.rating = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--latency-bucket' && next !== undefined) {
      parsed.latencyBucket = next as CoarseBucket;
      index += 1;
    } else if (arg === '--cost-bucket' && next !== undefined) {
      parsed.costBucket = next as CoarseBucket;
      index += 1;
    } else if (arg === '--token-bucket' && next !== undefined) {
      parsed.tokenBucket = next as CoarseBucket;
      index += 1;
    } else if (arg === '--build-status' && next !== undefined) {
      parsed.buildStatus = next as BuildSummary['status'];
      index += 1;
    } else if (arg === '--build-failures' && next !== undefined) {
      parsed.buildFailures = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--test-status' && next !== undefined) {
      parsed.testStatus = next as TestSummary['status'];
      index += 1;
    } else if (arg === '--test-failures' && next !== undefined) {
      parsed.testFailures = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === '--notes' && next !== undefined) {
      parsed.notes = next;
      index += 1;
    } else if (arg === '--preview' || arg === '--preview-only') {
      parsed.preview = true;
    } else if (arg === '--dry-run') {
      parsed.preview = true;
      parsed.dryRun = true;
    } else if (arg === '--send') {
      parsed.send = true;
    } else if (arg === '--config' && next !== undefined) {
      parsed.configPath = next;
      index += 1;
    } else if (arg === '--task-id' && next !== undefined) {
      parsed.taskId = next;
      index += 1;
    } else if (arg === '--inference-log-id' && next !== undefined) {
      parsed.inferenceLogId = next;
      index += 1;
    } else if (arg === '--actual-cost-usd' && next !== undefined) {
      const value = Number(next);
      if (Number.isFinite(value)) {
        parsed.actualCostUsd = value;
      }
      index += 1;
    } else if (arg === '--wall-clock-seconds' && next !== undefined) {
      const value = Number(next);
      if (Number.isFinite(value)) {
        parsed.wallClockSeconds = value;
      }
      index += 1;
    } else if (arg === '--input-tokens' && next !== undefined) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 0) {
        parsed.inputTokens = value;
      }
      index += 1;
    } else if (arg === '--output-tokens' && next !== undefined) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 0) {
        parsed.outputTokens = value;
      }
      index += 1;
    }
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
  if (parsed.accepted) return true;
  if (parsed.rejected) return false;
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
    lines.push(
      parsed.dryRun
        ? 'Dry run: no outcome was submitted.'
        : 'Preview only. Re-run with --send to submit this report.',
    );
  }

  return {
    exitCode: REPORT_CLI_EXIT_CODES.OK,
    stdout: `${lines.join('\n')}\n`,
    stderr: stderrNotes.length > 0 ? `${stderrNotes.join('\n')}\n` : '',
  };
}

export function createRunReportCli<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(
  profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>,
  impls: {
    findLatestRoutingDecision: (input: {
      configDir: string;
    }) => Promise<LatestRoutingDecision | undefined>;
    previewReportOutcome: (
      input: ReportOutcomeInputWithTaskId,
      options?: TOptions,
    ) => ReportCommandResult | Promise<ReportCommandResult>;
    reportTaskOutcome: (
      input: ReportOutcomeInputWithTaskId,
      options?: TOptions,
    ) => Promise<ReportCommandResult>;
  },
) {
  return async function runReportCli(
    argv: string[],
    env: NodeJS.ProcessEnv,
    deps: ReportCliDeps<TOptions> = {},
  ): Promise<ReportCliRunResult> {
    const parsed = parseArgs(argv);
    const registry = profile.modelCatalog.registry;
    const loadConfigImpl =
      deps.loadConfig ??
      ((input: { configPath?: string; env: NodeJS.ProcessEnv }) =>
        loadPluginConfig({
          env: input.env,
          registry,
          // Always read the persisted plugin config so consent set via
          // `hokusai-privacy reporting on` is honored, not just the
          // HOKUSAI_OUTCOME_OPT_IN env var. Mirrors getReportingStatus.
          store: new FilePluginConfigStore(
            input.configPath ??
              defaultPluginConfigPath(profile.resolveConfigPath().dir),
          ),
        }));
    const previewReportOutcomeImpl =
      deps.previewReportOutcomeImpl ?? impls.previewReportOutcome;
    const reportTaskOutcomeImpl =
      deps.reportTaskOutcomeImpl ?? impls.reportTaskOutcome;
    const findLatestRoutingDecisionImpl =
      deps.findLatestRoutingDecisionImpl ?? impls.findLatestRoutingDecision;

    let config: HokusaiPluginConfig;
    try {
      const configPath = toConfigFilePath(profile, parsed.configPath);
      config = await loadConfigImpl(
        configPath === undefined ? { env } : { configPath, env },
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

    if (!config.outcomeSubmissionEnabled) {
      return toMessage(
        parsed,
        'Outcome submission consent is required. Run `export HOKUSAI_OUTCOME_OPT_IN=true` to opt in.',
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

    const configDir = profile.resolveConfigPath(
      parsed.configPath ? { override: parsed.configPath } : undefined,
    ).dir;
    let latest: LatestRoutingDecision | undefined;
    if (
      parsed.useLatest ||
      (parsed.correlationId === undefined && pipedInput.correlationId === undefined)
    ) {
      try {
        latest = await findLatestRoutingDecisionImpl({ configDir });
      } catch (error) {
        return toMessage(
          parsed,
          `Could not read local routing correlations: ${error instanceof Error ? error.message : String(error)}`,
          REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR,
        );
      }
    }

    if (parsed.dryRun) {
      parsed.send = false;
    }

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
    const resolvedInferenceLogId = parsed.inferenceLogId ?? latest?.inferenceLogId;
    // When the recommendation was accepted, the actual model is the recommended
    // one, so --use-latest can fill it from the stored decision. If it was not
    // accepted, leave it empty so validation forces the caller to state which
    // model they actually ran.
    const resolvedActualModel =
      parsed.actualModel ??
      pipedInput.actualModel ??
      (recommendationAccepted === true ? latest?.recommendedModelId : undefined) ??
      '';
    // Resolve actual cost with layered fallback (first finite value wins):
    //  1. explicit --actual-cost-usd, 2. --input/--output-tokens via the price
    //  table, 3. statusline sidecar diff vs the route baseline, 4. best-effort
    //  transcript usage priced by the resolved model, 5. omitted (partial row).
    // Tiers 3/4 engage only when the stored routeContext carries a cost/time
    // baseline, so they never touch the filesystem for a bare report.
    const resolvedActualCostUsd = resolveActualCostUsd({
      model: resolvedActualModel,
      env,
      ...(parsed.actualCostUsd !== undefined
        ? { explicitActualCostUsd: parsed.actualCostUsd }
        : {}),
      ...(parsed.inputTokens !== undefined ? { inputTokens: parsed.inputTokens } : {}),
      ...(parsed.outputTokens !== undefined ? { outputTokens: parsed.outputTokens } : {}),
      ...(latest?.routeContext ? { routeContext: latest.routeContext } : {}),
    });
    const reportInput: ReportOutcomeInputWithTaskId = {
      taskId:
        parsed.taskId ??
        pipedInput.taskId ??
        latest?.taskId ??
        parsed.correlationId ??
        pipedInput.correlationId ??
        'outcome-report',
      correlationId:
        parsed.correlationId ?? pipedInput.correlationId ?? latest?.correlationId ?? '',
      recommendedModel:
        parsed.recommendedModel ??
        pipedInput.recommendedModel ??
        latest?.recommendedModelId ??
        '',
      actualModel: resolvedActualModel,
      recommendationAccepted: recommendationAccepted ?? false,
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
      ...(parsed.rating !== undefined
        ? { userRating: parsed.rating }
        : pipedInput.userRating !== undefined
          ? { userRating: pipedInput.userRating }
          : {}),
      ...(buildSummary(parsed.buildStatus, parsed.buildFailures) ??
      pipedInput.build
        ? {
            build:
              buildSummary(parsed.buildStatus, parsed.buildFailures) ??
              pipedInput.build,
          }
        : {}),
      ...(buildSummary(parsed.testStatus, parsed.testFailures) ?? pipedInput.test
        ? {
            test:
              buildSummary(parsed.testStatus, parsed.testFailures) ?? pipedInput.test,
          }
        : {}),
      ...(parsed.notes ?? pipedInput.notes
        ? { notes: parsed.notes ?? pipedInput.notes }
        : {}),
      ...(resolvedInferenceLogId ? { inferenceLogId: resolvedInferenceLogId } : {}),
      ...(latest?.routeContext ? { routeContext: latest.routeContext } : {}),
      ...(resolvedActualCostUsd !== undefined
        ? { actualCostUsd: resolvedActualCostUsd }
        : {}),
      ...(parsed.wallClockSeconds !== undefined
        ? { wallClockSeconds: parsed.wallClockSeconds }
        : {}),
    };

    try {
      const result = parsed.send
        ? await reportTaskOutcomeImpl(reportInput, {
            apiClient:
              deps.createClient?.(config) ??
              new HokusaiClient({
                apiKey: config.apiKey!,
                baseUrl: config.apiBaseUrl,
              }),
            registry,
            ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          } as TOptions)
        : await previewReportOutcomeImpl(reportInput, {
            registry,
            dryRun: parsed.dryRun,
            ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          } as TOptions);

      if (!result.ok) {
        const code =
          result.error.code === 'OUTCOME_VALIDATION_FAILED' ||
          result.error.code === 'CONTRIBUTION_UNAVAILABLE' ||
          result.error.code === 'CONTRIBUTION_VALIDATION_FAILED'
            ? REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR
            : result.error.code === 'NETWORK_ERROR'
              ? REPORT_CLI_EXIT_CODES.NETWORK_ERROR
              : REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR;
        return toMessage(parsed, result.error.message, code, result.error.details);
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
  };
}
