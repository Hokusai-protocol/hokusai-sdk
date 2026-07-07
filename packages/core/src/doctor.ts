import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HokusaiPluginConfig, RedactedPluginConfig } from './config.js';
import { redactPluginConfig, summarizeAllowlist } from './config.js';
import {
  HokusaiClient,
  type FetchTransport,
  type FetchTransportResponse,
} from './client.js';
import {
  ANTHROPIC_MODELS,
  InMemoryModelRegistry,
  type ModelRegistry,
} from './model-registry.js';

const DEFAULT_REACHABILITY_PATH = '/v1/health';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_NODE_MIN_VERSION = '18.0.0';

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

export type DoctorCheckStatus = 'pass' | 'fail' | 'warn' | 'skipped';

export interface DoctorCheckResult {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
  nextAction?: string;
}

export interface PluginDoctorReport {
  checks: DoctorCheckResult[];
  ok: boolean;
  mode: 'network' | 'offline';
  checkedAt: string;
}

export interface RunPluginDoctorInput {
  config: HokusaiPluginConfig;
  mode?: 'network' | 'offline';
  transport?: FetchTransport;
  stateDir?: string;
  storageProber?: (dir: string) => Promise<void>;
  nodeVersion?: string;
  nodeMinVersion?: string;
  registry?: ModelRegistry;
  reachabilityPath?: string;
  reachabilityTimeoutMs?: number;
  clock?: () => Date;
  routeDryRunClient?: Pick<HokusaiClient, 'route'>;
}

export async function runDoctor(input: RunDoctorInput): Promise<DoctorReport> {
  const registry =
    input.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
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

export function checkNodeRuntime(
  current: string,
  minimum: string,
): DoctorCheckResult {
  const parsedCurrent = parseSemver(current);
  const parsedMinimum = parseSemver(minimum);

  if (!parsedCurrent || !parsedMinimum) {
    return {
      id: 'node-runtime',
      label: 'node-runtime',
      status: 'warn',
      summary: `Unable to verify Node.js runtime (${current}) against minimum (${minimum}).`,
      nextAction: `Use Node.js ${minimum} or newer.`,
    };
  }

  return compareSemver(parsedCurrent, parsedMinimum) >= 0
    ? {
        id: 'node-runtime',
        label: 'node-runtime',
        status: 'pass',
        summary: `Node.js v${current} meets minimum v${minimum}.`,
      }
    : {
        id: 'node-runtime',
        label: 'node-runtime',
        status: 'fail',
        summary: `Node.js v${current} is below minimum v${minimum}.`,
        nextAction: `Upgrade Node.js to ${minimum} or newer.`,
      };
}

export function checkApiKey(
  config: Pick<HokusaiPluginConfig, 'apiKey'>,
): DoctorCheckResult {
  return config.apiKey?.trim()
    ? {
        id: 'api-key',
        label: 'api-key',
        status: 'pass',
        summary: 'API key is configured.',
      }
    : {
        id: 'api-key',
        label: 'api-key',
        status: 'fail',
        summary: 'API key is not configured.',
        nextAction: 'Set HOKUSAI_API_KEY=hk_live_... to enable routing.',
      };
}

export function checkRoutingConsent(
  config: Pick<HokusaiPluginConfig, 'routingConsentEnabled'>,
): DoctorCheckResult {
  return config.routingConsentEnabled
    ? {
        id: 'routing-consent',
        label: 'routing-consent',
        status: 'pass',
        summary: 'Routing consent is enabled.',
      }
    : {
        id: 'routing-consent',
        label: 'routing-consent',
        status: 'fail',
        summary: 'Routing consent is not enabled.',
        nextAction: 'Set HOKUSAI_ROUTING_CONSENT=1 to allow routing.',
      };
}

export function checkOutcomeConsent(
  config: Pick<HokusaiPluginConfig, 'outcomeSubmissionEnabled'>,
): DoctorCheckResult {
  return config.outcomeSubmissionEnabled
    ? {
        id: 'outcome-consent',
        label: 'outcome-consent',
        status: 'pass',
        summary: 'Outcome submission consent is enabled.',
      }
    : {
        id: 'outcome-consent',
        label: 'outcome-consent',
        status: 'warn',
        summary: 'Outcome submission consent is not enabled.',
        nextAction:
          'Set HOKUSAI_OUTCOME_OPT_IN=1 to opt into outcome submission.',
      };
}

export function checkModelAllowlist(
  config: Pick<HokusaiPluginConfig, 'modelAllowlist'>,
  registry: ModelRegistry,
): DoctorCheckResult {
  const summary = summarizeAllowlist(config, registry);
  const validCount = summary.validModelIds.length;

  if (validCount > 0) {
    return {
      id: 'model-allowlist',
      label: 'model-allowlist',
      status: 'pass',
      summary: `${validCount} Anthropic model${validCount === 1 ? '' : 's'} configured in allowlist.`,
    };
  }

  return {
    id: 'model-allowlist',
    label: 'model-allowlist',
    status: 'fail',
    summary:
      summary.unknownEntries.length > 0
        ? `No valid Anthropic models found in allowlist: ${summary.unknownEntries.join(', ')}.`
        : 'No Anthropic models configured in allowlist.',
    nextAction:
      'Configure at least one supported Anthropic model in the Hokusai allowlist.',
  };
}

export async function checkDryRunRoute(
  config: HokusaiPluginConfig,
  registry: ModelRegistry,
  options?: {
    client?: Pick<HokusaiClient, 'route'>;
    clock?: () => Date;
  },
): Promise<DoctorCheckResult> {
  if (!config.apiKey?.trim() || !config.routingConsentEnabled) {
    return {
      id: 'dry-run-route',
      label: 'dry-run-route',
      status: 'skipped',
      summary:
        'Skipped dry-run route because API key or routing consent is not configured.',
      nextAction:
        'Configure HOKUSAI_API_KEY and HOKUSAI_ROUTING_CONSENT=1, then rerun the doctor.',
    };
  }

  const allowlistSummary = summarizeAllowlist(config, registry);
  const modelId = allowlistSummary.validModelIds[0];
  const model = modelId ? registry.get(modelId) : undefined;

  if (!model) {
    return {
      id: 'dry-run-route',
      label: 'dry-run-route',
      status: 'fail',
      summary: 'Dry-run route failed because no supported model is configured.',
      nextAction:
        'Configure at least one supported model in the Hokusai allowlist.',
    };
  }

  const checkedAt = (options?.clock ?? (() => new Date()))().toISOString();
  const client =
    options?.client ??
    new HokusaiClient({
      apiKey: config.apiKey,
      baseUrl: config.apiBaseUrl,
      transport: () =>
        Promise.reject(
          new Error('dry-run route must not use network transport'),
        ),
    });

  try {
    await client.route(
      {
        task: {
          id: 'hokusai-doctor-dry-run',
          prompt: 'Hokusai doctor dry-run route verification.',
        },
        prompt: 'Hokusai doctor dry-run route verification.',
        consent: {
          subjectId: 'hokusai-doctor',
          grantedScopes: ['task-execution'],
        },
        model: {
          id: model.id,
          provider: model.provider,
          capabilities: [...model.capabilities],
        },
        correlation: {
          taskId: 'hokusai-doctor-dry-run',
          correlationId: `hokusai-doctor-dry-run:${checkedAt}`,
          createdAt: checkedAt,
        },
        redactions: [],
        createdAt: checkedAt,
      },
      { dryRun: true, requestId: checkedAt },
    );

    return {
      id: 'dry-run-route',
      label: 'dry-run-route',
      status: 'pass',
      summary: 'Dry-run route payload validated successfully.',
    };
  } catch (error) {
    return {
      id: 'dry-run-route',
      label: 'dry-run-route',
      status: 'fail',
      summary: `Dry-run route failed (${sanitizeDryRunError(error)}).`,
      nextAction:
        'Fix the routing configuration and rerun the doctor before sending tasks.',
    };
  }
}

export async function checkStateDirWritable(
  stateDir: string,
  probe: (dir: string) => Promise<void>,
): Promise<DoctorCheckResult> {
  try {
    await probe(stateDir);
    return {
      id: 'state-dir-writable',
      label: 'state-dir-writable',
      status: 'pass',
      summary: 'State directory is writable.',
    };
  } catch (error) {
    return {
      id: 'state-dir-writable',
      label: 'state-dir-writable',
      status: 'fail',
      summary: `State directory is not writable (${sanitizeStateDirError(error, stateDir)}).`,
      nextAction:
        'Ensure the Hokusai state directory exists and is writable by the current user.',
    };
  }
}

export async function checkApiReachability(
  config: HokusaiPluginConfig,
  transport: FetchTransport,
  options?: {
    path?: string;
    timeoutMs?: number;
    requestId?: string;
  },
): Promise<DoctorCheckResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await transport(
      buildReachabilityUrl(
        config.apiBaseUrl,
        options?.path ?? DEFAULT_REACHABILITY_PATH,
      ),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.apiKey ?? ''}`,
          'X-Hokusai-Request-Id':
            options?.requestId ?? new Date().toISOString(),
        },
        signal: controller.signal,
      },
    );

    if (response.status >= 200 && response.status < 300) {
      return {
        id: 'api-reachability',
        label: 'api-reachability',
        status: 'pass',
        summary: `API reachability check succeeded (HTTP ${response.status}).`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        id: 'api-reachability',
        label: 'api-reachability',
        status: 'fail',
        summary: `API reachability check failed with auth error (HTTP ${response.status}).`,
        nextAction:
          'Verify HOKUSAI_API_KEY and retry the doctor in network mode.',
      };
    }

    return {
      id: 'api-reachability',
      label: 'api-reachability',
      status: 'fail',
      summary: `API reachability check failed (HTTP ${response.status}).`,
      nextAction:
        'Confirm network access to the Hokusai API and retry in network mode.',
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'timeout'
          : error.name
        : 'network-error';

    return {
      id: 'api-reachability',
      label: 'api-reachability',
      status: 'fail',
      summary: `API reachability check failed (${reason}).`,
      nextAction:
        'Confirm network access to the Hokusai API and retry in network mode.',
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function runPluginDoctor(
  input: RunPluginDoctorInput,
): Promise<PluginDoctorReport> {
  const registry =
    input.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const checkedAt = (input.clock ?? (() => new Date()))().toISOString();
  const mode =
    input.mode ??
    (input.config.apiKey?.trim() && input.config.routingConsentEnabled
      ? 'network'
      : 'offline');

  const checks: DoctorCheckResult[] = [
    checkNodeRuntime(
      input.nodeVersion ?? process.versions.node,
      input.nodeMinVersion ?? DEFAULT_NODE_MIN_VERSION,
    ),
    checkApiKey(input.config),
    checkRoutingConsent(input.config),
    checkOutcomeConsent(input.config),
    checkModelAllowlist(input.config, registry),
    await checkDryRunRoute(input.config, registry, {
      ...(input.routeDryRunClient ? { client: input.routeDryRunClient } : {}),
      ...(input.clock ? { clock: input.clock } : {}),
    }),
    await checkStateDirWritable(
      input.stateDir ?? '.',
      input.storageProber ?? probeStateDirWritable,
    ),
  ];

  if (mode === 'network' && input.transport) {
    const reachabilityOptions: {
      path?: string;
      timeoutMs?: number;
      requestId: string;
    } = { requestId: checkedAt };
    if (input.reachabilityPath !== undefined) {
      reachabilityOptions.path = input.reachabilityPath;
    }
    if (input.reachabilityTimeoutMs !== undefined) {
      reachabilityOptions.timeoutMs = input.reachabilityTimeoutMs;
    }
    checks.push(
      await checkApiReachability(
        input.config,
        input.transport,
        reachabilityOptions,
      ),
    );
  } else {
    checks.push({
      id: 'api-reachability',
      label: 'api-reachability',
      status: 'skipped',
      summary: 'Skipped API reachability check (offline mode).',
      ...(mode === 'network' && !input.transport
        ? {
            nextAction:
              'Provide a network transport to run the API reachability check.',
          }
        : {}),
    });
  }

  return {
    checks,
    ok: checks.every((check) => check.status !== 'fail'),
    mode,
    checkedAt,
  };
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

function parseSemver(value: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  return [
    Number.parseInt(match[1] ?? '', 10),
    Number.parseInt(match[2] ?? '', 10),
    Number.parseInt(match[3] ?? '', 10),
  ];
}

function compareSemver(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }

  return 0;
}

async function probeStateDirWritable(dir: string): Promise<void> {
  const probePath = join(dir, `.hokusai-doctor-${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });

  try {
    await writeFile(probePath, 'ok', 'utf8');
  } finally {
    await rm(probePath, { force: true }).catch(() => undefined);
  }
}

function sanitizeStateDirError(error: unknown, stateDir: string): string {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === 'string'
        ? error
        : 'unknown error';

  const escapedStateDir = escapeRegExp(stateDir);
  const withoutStateDir = raw.replace(
    new RegExp(escapedStateDir, 'g'),
    '<state-dir>',
  );
  const withoutAbsolutePaths = withoutStateDir.replace(
    /(?:[A-Za-z]:)?\/[^\s:'"]+/g,
    '<path>',
  );

  return withoutAbsolutePaths.trim() || 'unknown error';
}

function sanitizeDryRunError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === 'string'
        ? error
        : 'unknown error';

  return raw.replace(/hk_[A-Za-z0-9_/-]+/g, '<api-key>');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
