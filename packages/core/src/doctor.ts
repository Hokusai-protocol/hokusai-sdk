import type { HokusaiPluginConfig, RedactedPluginConfig } from './config.js';
import { redactPluginConfig, summarizeAllowlist } from './config.js';
import type {
  FetchTransport,
  FetchTransportResponse,
} from './client.js';
import { ANTHROPIC_MODELS, InMemoryModelRegistry, type ModelRegistry } from './model-registry.js';

const DEFAULT_REACHABILITY_PATH = '/v1/health';
const DEFAULT_TIMEOUT_MS = 5_000;

export interface DoctorReport {
  auth: 'configured' | 'missing';
  routingConsent: boolean;
  outcomeConsent: boolean;
  apiReachable: 'ok' | 'unauthorized' | 'unreachable' | 'skipped';
  allowlistCount: number;
  allowlistValid: boolean;
  unknownAllowlistEntries: string[];
  redactedConfig: RedactedPluginConfig;
  checkedAt: string;
}

export interface RunDoctorInput {
  config: HokusaiPluginConfig;
  transport?: FetchTransport;
  reachabilityPath?: string;
  reachabilityTimeoutMs?: number;
  clock?: () => Date;
  registry?: ModelRegistry;
}

export async function runDoctor(
  input: RunDoctorInput,
): Promise<DoctorReport> {
  const registry = input.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const allowlistSummary = summarizeAllowlist(input.config, registry);
  const checkedAt = (input.clock ?? (() => new Date()))().toISOString();

  return {
    auth: input.config.apiKey ? 'configured' : 'missing',
    routingConsent: input.config.routingConsentEnabled,
    outcomeConsent: input.config.outcomeSubmissionEnabled,
    apiReachable: await checkReachability(input, checkedAt),
    allowlistCount: allowlistSummary.validModelIds.length,
    allowlistValid: allowlistSummary.unknownEntries.length === 0,
    unknownAllowlistEntries: allowlistSummary.unknownEntries,
    redactedConfig: redactPluginConfig(input.config),
    checkedAt,
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const unknownEntries =
    report.unknownAllowlistEntries.length > 0
      ? report.unknownAllowlistEntries.join(', ')
      : 'none';

  return [
    'Hokusai doctor',
    `checkedAt: ${report.checkedAt}`,
    `auth: ${report.auth}`,
    `routingConsent: ${report.routingConsent ? 'enabled' : 'disabled'}`,
    `outcomeConsent: ${report.outcomeConsent ? 'enabled' : 'disabled'}`,
    `apiReachable: ${report.apiReachable}`,
    `allowlistCount: ${report.allowlistCount}`,
    `allowlistValid: ${report.allowlistValid ? 'yes' : 'no'}`,
    `unknownAllowlistEntries: ${unknownEntries}`,
    `apiKey: ${report.redactedConfig.apiKey}`,
    ...(report.redactedConfig.apiKeyFingerprint
      ? [`apiKeyFingerprint: ${report.redactedConfig.apiKeyFingerprint}`]
      : []),
    `apiBaseUrl: ${report.redactedConfig.apiBaseUrl}`,
  ].join('\n');
}

async function checkReachability(
  input: RunDoctorInput,
  requestId: string,
): Promise<DoctorReport['apiReachable']> {
  if (!input.config.apiKey || !input.transport) {
    return 'skipped';
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    input.reachabilityTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await input.transport(
      buildReachabilityUrl(
        input.config.apiBaseUrl,
        input.reachabilityPath ?? DEFAULT_REACHABILITY_PATH,
      ),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          'X-Hokusai-Request-Id': requestId,
        },
        signal: controller.signal,
      },
    );

    return mapReachabilityStatus(response);
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function buildReachabilityUrl(baseUrl: string, path: string): string {
  const normalizedBase = new URL(baseUrl);
  if (!normalizedBase.pathname.endsWith('/')) {
    normalizedBase.pathname = `${normalizedBase.pathname}/`;
  }

  return new URL(path.replace(/^\/+/, ''), normalizedBase).toString();
}

function mapReachabilityStatus(
  response: FetchTransportResponse,
): DoctorReport['apiReachable'] {
  if (response.status === 401 || response.status === 403) {
    return 'unauthorized';
  }

  if (response.status >= 200 && response.status < 300) {
    return 'ok';
  }

  return 'unreachable';
}
