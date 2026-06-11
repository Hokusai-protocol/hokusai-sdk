import type { AdapterResult, SubmissionAuditEntry } from '../index.js';
import type { HarnessProfile } from './harness-profile.js';
import { CLI_EXIT_CODES } from './cli.js';
import type {
  ClearResult,
  DecisionPreview,
  PrivacyResultWarnings,
  PrivacyCliExitCodes,
  ReportingStatusResult,
  RouteInputBase,
  RoutingDecisionSummary,
  SharedCommandOptions,
} from './types.js';

export const PRIVACY_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7,
  PRIVACY_USAGE_ERROR: 8,
} as const satisfies PrivacyCliExitCodes;

export type PrivacyCliExitCode =
  (typeof PRIVACY_CLI_EXIT_CODES)[keyof typeof PRIVACY_CLI_EXIT_CODES];

export interface PrivacyCliRunResult {
  exitCode: PrivacyCliExitCode;
  stdout: string;
  stderr: string;
}

type ParsedArgs =
  | {
      subcommand: 'list';
      limit?: number;
      json: boolean;
      configPath?: string;
    }
  | {
      subcommand: 'preview';
      correlationId?: string;
      debug: boolean;
      json: boolean;
      configPath?: string;
    }
  | {
      subcommand: 'audit';
      limit?: number;
      json: boolean;
      configPath?: string;
    }
  | {
      subcommand: 'clear';
      scope?: 'all' | 'records' | 'audit';
      yes: boolean;
      json: boolean;
      configPath?: string;
    }
  | {
      subcommand: 'reporting';
      action?: 'on' | 'off' | 'status';
      json: boolean;
      configPath?: string;
    }
  | {
      subcommand: 'debug';
      action?: 'status' | 'off';
      json: boolean;
      configPath?: string;
    };

const FLAG_VALUE_OPTIONS = new Set(['--config', '--limit']);

function firstPositional(argv: string[]): string | undefined {
  for (let i = 1; i < argv.length; i += 1) {
    const prev = argv[i - 1];
    if (prev && FLAG_VALUE_OPTIONS.has(prev)) continue;
    const token = argv[i];
    if (token && !token.startsWith('--')) return token;
  }
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const subcommand = argv[0];
  const json = argv.includes('--json');
  const configIndex = argv.indexOf('--config');
  const configPath = configIndex >= 0 ? argv[configIndex + 1] : undefined;

  if (subcommand === 'list' || subcommand === 'audit') {
    const limitIndex = argv.indexOf('--limit');
    const limit = limitIndex >= 0 ? parseNumber(argv[limitIndex + 1]) : undefined;
    return {
      subcommand,
      json,
      ...(configPath ? { configPath } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
  }

  if (subcommand === 'preview') {
    const correlationId = firstPositional(argv);
    return {
      subcommand,
      debug: argv.includes('--debug'),
      json,
      ...(correlationId ? { correlationId } : {}),
      ...(configPath ? { configPath } : {}),
    };
  }

  if (subcommand === 'clear') {
    const scope = argv.includes('--all')
      ? 'all'
      : argv.includes('--records')
        ? 'records'
        : argv.includes('--audit')
          ? 'audit'
          : undefined;
    return {
      subcommand,
      yes: argv.includes('--yes'),
      json,
      ...(scope ? { scope } : {}),
      ...(configPath ? { configPath } : {}),
    };
  }

  if (subcommand === 'reporting') {
    const action = firstPositional(argv) as 'on' | 'off' | 'status' | undefined;
    return {
      subcommand,
      json,
      ...(action ? { action } : {}),
      ...(configPath ? { configPath } : {}),
    };
  }

  if (subcommand === 'debug') {
    const action = firstPositional(argv) as 'status' | 'off' | undefined;
    return {
      subcommand,
      json,
      ...(action ? { action } : {}),
      ...(configPath ? { configPath } : {}),
    };
  }

  return { error: 'Usage: hokusai-privacy list|preview|audit|clear|reporting|debug' };
}

function ok(body: string, json: boolean, payload: unknown): PrivacyCliRunResult {
  return {
    exitCode: PRIVACY_CLI_EXIT_CODES.OK,
    stdout: json ? `${JSON.stringify(payload ?? {}, null, 2)}\n` : body,
    stderr: '',
  };
}

function fail(
  message: string,
  code: PrivacyCliExitCode,
  json: boolean,
): PrivacyCliRunResult {
  const body = json
    ? JSON.stringify({ error: { code, message } }, null, 2)
    : message;

  return {
    exitCode: code,
    stdout: '',
    stderr: `${body}\n`,
  };
}

function renderWarnings(warnings?: string[]): string {
  return warnings && warnings.length > 0 ? `${warnings.join('\n')}\n` : '';
}

export function createRunPrivacyCli<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(
  _profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>,
  impls: {
    listRoutingDecisions: (
      input: { limit?: number },
      options?: TOptions,
    ) => Promise<AdapterResult<{ decisions: RoutingDecisionSummary[] } & PrivacyResultWarnings>>;
    previewStoredDecision: (
      input: { correlationId: string; debug?: boolean },
      options?: TOptions,
    ) => Promise<AdapterResult<DecisionPreview & PrivacyResultWarnings>>;
    listSubmissionAudit: (
      input: { limit?: number },
      options?: TOptions,
    ) => Promise<AdapterResult<{ entries: SubmissionAuditEntry[] } & PrivacyResultWarnings>>;
    clearPrivacyState: (
      input: { scope: 'all' | 'records' | 'audit' },
      options?: TOptions,
    ) => Promise<AdapterResult<ClearResult>>;
    getReportingStatus: (
      options?: TOptions,
    ) => Promise<AdapterResult<ReportingStatusResult>>;
    setReportingEnabled: (
      input: { enabled: boolean },
      options?: TOptions,
    ) => Promise<AdapterResult<{ enabled: boolean }>>;
  },
) {
  return async function runPrivacyCli(
    argv: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<PrivacyCliRunResult> {
    const parsed = parseArgs(argv);
    if ('error' in parsed) {
      return fail(
        parsed.error,
        PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
        argv.includes('--json'),
      );
    }

    if (
      ('limit' in parsed && parsed.limit !== undefined && parsed.limit < 0) ||
      ('limit' in parsed && argv.includes('--limit') && parsed.limit === undefined)
    ) {
      return fail(
        'Expected --limit to be a non-negative integer.',
        PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
        parsed.json,
      );
    }

    if (parsed.subcommand === 'list') {
      const result = await impls.listRoutingDecisions(
        { ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}) },
        {
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          env,
        } as TOptions,
      );
      if (!result.ok) {
        return fail(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }

      if (result.value.decisions.length === 0) {
        return ok(
          `${renderWarnings(result.value.warnings)}No records found.\n`,
          parsed.json,
          {
            subcommand: 'list',
            result: result.value.decisions,
            ...(result.value.warnings ? { warnings: result.value.warnings } : {}),
          },
        );
      }

      const lines = result.value.decisions.map(
        (entry) =>
          `${entry.createdAt} ${entry.correlationId} ${entry.recommendedModelId ?? 'unknown-model'} ${entry.status ?? 'unknown-status'}`,
      );

      return ok(
        `${renderWarnings(result.value.warnings)}${lines.join('\n')}\n`,
        parsed.json,
        {
          subcommand: 'list',
          result: result.value.decisions,
          ...(result.value.warnings ? { warnings: result.value.warnings } : {}),
        },
      );
    }

    if (parsed.subcommand === 'preview') {
      if (!parsed.correlationId) {
        return fail(
          'Provide a correlation id to preview.',
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json,
        );
      }

      const result = await impls.previewStoredDecision(
        { correlationId: parsed.correlationId, debug: parsed.debug },
        {
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          env,
        } as TOptions,
      );
      if (!result.ok) {
        return fail(
          result.error.message,
          PRIVACY_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
          parsed.json,
        );
      }

      return ok(
        `${renderWarnings(result.value.warnings)}${JSON.stringify(result.value, null, 2)}\n`,
        parsed.json,
        {
          subcommand: 'preview',
          result: result.value,
          ...(result.value.warnings ? { warnings: result.value.warnings } : {}),
        },
      );
    }

    if (parsed.subcommand === 'audit') {
      const result = await impls.listSubmissionAudit(
        { ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}) },
        {
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          env,
        } as TOptions,
      );
      if (!result.ok) {
        return fail(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }

      if (result.value.entries.length === 0) {
        return ok(
          `${renderWarnings(result.value.warnings)}No audit entries found.\n`,
          parsed.json,
          {
            subcommand: 'audit',
            result: result.value.entries,
            ...(result.value.warnings ? { warnings: result.value.warnings } : {}),
          },
        );
      }

      const lines = result.value.entries.map(
        (entry) =>
          `${new Date(entry.timestamp).toISOString()} ${entry.kind} ${entry.status} ${entry.correlationId}${entry.error ? ` ${entry.error}` : ''}`,
      );

      return ok(
        `${renderWarnings(result.value.warnings)}${lines.join('\n')}\n`,
        parsed.json,
        {
          subcommand: 'audit',
          result: result.value.entries,
          ...(result.value.warnings ? { warnings: result.value.warnings } : {}),
        },
      );
    }

    if (parsed.subcommand === 'clear') {
      if (!parsed.scope) {
        return fail(
          'Specify one of --all, --records, or --audit.',
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json,
        );
      }

      if (!parsed.yes) {
        return fail(
          'Re-run with --yes to confirm.',
          PRIVACY_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
          parsed.json,
        );
      }

      const result = await impls.clearPrivacyState(
        { scope: parsed.scope },
        {
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          env,
        } as TOptions,
      );
      if (!result.ok) {
        return fail(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }

      return ok(`Cleared ${parsed.scope} privacy state.\n`, parsed.json, {
        subcommand: 'clear',
        result: result.value,
      });
    }

    if (parsed.subcommand === 'reporting') {
      if (!parsed.action) {
        return fail(
          'Specify reporting on, off, or status.',
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json,
        );
      }

      if (parsed.action === 'status') {
        const result = await impls.getReportingStatus({
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          env,
        } as TOptions);
        if (!result.ok) {
          return fail(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
        }

        return ok(
          `Outcome reporting is ${result.value.enabled ? 'enabled' : 'disabled'} (${result.value.source}).\n`,
          parsed.json,
          { subcommand: 'reporting', result: result.value },
        );
      }

      const result = await impls.setReportingEnabled(
        { enabled: parsed.action === 'on' },
        {
          ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
          env,
        } as TOptions,
      );
      if (!result.ok) {
        return fail(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }

      return ok(
        `Outcome reporting ${result.value.enabled ? 'enabled' : 'disabled'}.\n`,
        parsed.json,
        { subcommand: 'reporting', result: result.value },
      );
    }

    if (parsed.subcommand === 'debug') {
      if (!parsed.action) {
        return fail(
          'Specify debug status or off.',
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json,
        );
      }

      if (parsed.action === 'off') {
        const currentlyEnabled = env.HOKUSAI_DEBUG === '1';
        return ok('Unset HOKUSAI_DEBUG to disable debug previews.\n', parsed.json, {
          subcommand: 'debug',
          result: {
            enabled: currentlyEnabled,
            source: 'env',
            message: 'Unset HOKUSAI_DEBUG to disable debug previews.',
          },
        });
      }

      const enabled = env.HOKUSAI_DEBUG === '1';
      return ok(
        `Debug previews are ${enabled ? 'enabled' : 'disabled'}.\n`,
        parsed.json,
        {
          subcommand: 'debug',
          result: {
            enabled,
            source: 'env',
          },
        },
      );
    }

    void (parsed satisfies never);
    return fail(
      'Usage: hokusai-privacy list|preview|audit|clear|reporting|debug',
      PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
      argv.includes('--json'),
    );
  };
}
