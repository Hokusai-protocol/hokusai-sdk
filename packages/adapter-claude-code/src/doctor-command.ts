import {
  ANTHROPIC_MODELS,
  ConfigValidationError,
  DEFAULT_HOKUSAI_BASE_URL,
  FilePluginConfigStore,
  InMemoryModelRegistry,
  defaultPluginConfigPath,
  loadPluginConfig,
  runPluginDoctor,
  type DoctorCheckResult,
  type FetchTransport,
  type HokusaiPluginConfig,
  type PluginDoctorReport,
} from '@hokusai/core';
import { resolveClaudeCodeConfigPath } from './config-path.js';

export interface BootstrapDoctorOptions {
  configPath?: string;
  pluginConfigPath?: string;
  env?: NodeJS.ProcessEnv;
  transport?: FetchTransport;
}

export async function runBootstrapDoctor(
  options: BootstrapDoctorOptions = {},
): Promise<{ report: PluginDoctorReport; rendered: string }> {
  const configPath = resolveClaudeCodeConfigPath(
    options.configPath ? { override: options.configPath } : undefined,
  );
  const pluginConfigPath =
    options.pluginConfigPath ?? defaultPluginConfigPath(configPath.dir);

  let config = createFallbackConfig();
  let validationCheck: DoctorCheckResult | undefined;

  try {
    const loadOptions: Parameters<typeof loadPluginConfig>[0] = {
      store: new FilePluginConfigStore(pluginConfigPath),
      registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
    };
    if (options.env !== undefined) {
      loadOptions.env = options.env;
    }
    config = await loadPluginConfig(loadOptions);
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) {
      throw error;
    }

    validationCheck = {
      id: 'config-validation',
      label: 'config-validation',
      status: 'fail',
      summary: `Plugin configuration is invalid for: ${error.fieldErrors.map((fieldError) => fieldError.path).join(', ')}.`,
      nextAction:
        'Fix the invalid Hokusai plugin configuration values and rerun the doctor.',
    };
  }

  const mode =
    config.apiKey?.trim() && config.routingConsentEnabled && options.transport
      ? 'network'
      : 'offline';
  const doctorInput: Parameters<typeof runPluginDoctor>[0] = {
    config,
    mode,
    stateDir: configPath.dir,
    registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
  };
  if (options.transport !== undefined) {
    doctorInput.transport = options.transport;
  }
  const baseReport = await runPluginDoctor(doctorInput);
  const report = validationCheck
    ? {
        ...baseReport,
        checks: [validationCheck, ...baseReport.checks],
        ok: false,
      }
    : baseReport;

  return {
    report,
    rendered: renderPluginDoctorReport(report),
  };
}

export function renderPluginDoctorReport(report: PluginDoctorReport): string {
  const lines = [
    'Hokusai doctor',
    '==============',
    `checkedAt: ${report.checkedAt}`,
    `mode: ${report.mode}`,
    '',
    ...report.checks.flatMap((check) => renderCheck(check)),
    '',
    buildOverallLine(report),
  ];

  return lines.join('\n');
}

function renderCheck(check: DoctorCheckResult): string[] {
  return [
    `[${formatStatus(check.status)}] ${check.label.padEnd(18)} ${check.summary}`,
    ...(check.nextAction ? [`       -> ${check.nextAction}`] : []),
  ];
}

function buildOverallLine(report: PluginDoctorReport): string {
  const failingChecks = report.checks.filter(
    (check) => check.status === 'fail',
  );
  if (failingChecks.length === 0) {
    return 'Overall: all checks passed.';
  }

  const routingBlocked = report.checks.some(
    (check) =>
      (check.id === 'api-key' || check.id === 'routing-consent') &&
      check.status === 'fail',
  );

  return routingBlocked
    ? `Overall: ${failingChecks.length} failing checks - Hokusai routing is unavailable until configured.`
    : `Overall: ${failingChecks.length} failing checks.`;
}

function formatStatus(status: DoctorCheckResult['status']): string {
  return status.toUpperCase().slice(0, 4).padEnd(4);
}

function createFallbackConfig(): HokusaiPluginConfig {
  return {
    apiBaseUrl: DEFAULT_HOKUSAI_BASE_URL,
    routingConsentEnabled: false,
    outcomeSubmissionEnabled: false,
    modelAllowlist: ANTHROPIC_MODELS.map((model) => model.id),
  };
}
