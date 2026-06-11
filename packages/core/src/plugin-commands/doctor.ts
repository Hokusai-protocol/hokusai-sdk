import {
  ConfigValidationError,
  DEFAULT_HOKUSAI_BASE_URL,
  FilePluginConfigStore,
  defaultPluginConfigPath,
  loadPluginConfig,
  runPluginDoctor,
  type DoctorCheckResult,
  type PluginDoctorReport,
} from '../index.js';
import type { HarnessProfile } from './harness-profile.js';
import type {
  BootstrapDoctorOptions,
  RouteInputBase,
  SharedCommandOptions,
} from './types.js';

function buildFallbackAllowlist(
  profile: Pick<
    HarnessProfile<RouteInputBase, unknown, unknown, SharedCommandOptions>,
    'modelCatalog'
  >,
): string[] {
  const allowedProviders = profile.modelCatalog.allowedProviders;
  return profile.modelCatalog.registry
    .list()
    .filter((model) => allowedProviders?.includes(model.provider) ?? true)
    .map((model) => model.id);
}

function renderCheck(check: DoctorCheckResult): string[] {
  return [
    `[${check.status.toUpperCase().slice(0, 4).padEnd(4)}] ${check.label.padEnd(18)} ${check.summary}`,
    ...(check.nextAction ? [`       -> ${check.nextAction}`] : []),
  ];
}

function buildOverallLine(report: PluginDoctorReport): string {
  const failingChecks = report.checks.filter((check) => check.status === 'fail');
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

export function renderPluginDoctorReport(report: PluginDoctorReport): string {
  return [
    'Hokusai doctor',
    '==============',
    `checkedAt: ${report.checkedAt}`,
    `mode: ${report.mode}`,
    '',
    ...report.checks.flatMap((check) => renderCheck(check)),
    '',
    buildOverallLine(report),
  ].join('\n');
}

export function createRunBootstrapDoctor<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions,
>(
  profile: HarnessProfile<TRouteInput, TBuilderOptions, TPreview, TOptions>,
) {
  return async function runBootstrapDoctor(
    options: BootstrapDoctorOptions = {},
  ): Promise<{ report: PluginDoctorReport; rendered: string }> {
    const configPath = profile.resolveConfigPath(
      options.configPath ? { override: options.configPath } : undefined,
    );
    const pluginConfigPath =
      options.pluginConfigPath ?? defaultPluginConfigPath(configPath.dir);

    const modelAllowlist = buildFallbackAllowlist(profile);
    let config =
      profile.createFallbackConfig?.({
        baseUrl: DEFAULT_HOKUSAI_BASE_URL,
        modelAllowlist,
      }) ?? {
        apiBaseUrl: DEFAULT_HOKUSAI_BASE_URL,
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
        modelAllowlist,
      };
    let validationCheck: DoctorCheckResult | undefined;

    try {
      config = await loadPluginConfig({
        store: new FilePluginConfigStore(pluginConfigPath),
        registry: profile.modelCatalog.registry,
        ...(options.env !== undefined ? { env: options.env } : {}),
      });
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
    const baseReport = await runPluginDoctor({
      config,
      mode,
      stateDir: configPath.dir,
      registry: profile.modelCatalog.registry,
      ...(options.transport !== undefined ? { transport: options.transport } : {}),
    });
    const report = validationCheck
      ? { ...baseReport, checks: [validationCheck, ...baseReport.checks], ok: false }
      : baseReport;

    return {
      report,
      rendered: (profile.renderDoctorReport ?? renderPluginDoctorReport)(report),
    };
  };
}
