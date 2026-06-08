import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { DEFAULT_HOKUSAI_BASE_URL } from './client.js';
import { ANTHROPIC_MODELS, type ModelRegistry } from './model-registry.js';
import type { HokusaiFieldError } from './schemas.js';
import type { LocalStore } from './storage.js';

const CONFIG_RECORD_ID = 'hokusai-plugin-config';
const DEFAULT_ALLOWLIST = ANTHROPIC_MODELS.map((model) => model.id);

export interface HokusaiPluginConfig {
  apiKey?: string;
  apiBaseUrl: string;
  routingConsentEnabled: boolean;
  outcomeSubmissionEnabled: boolean;
  modelAllowlist: string[];
}

export interface PluginConfigOverrides {
  apiKey?: string;
  apiBaseUrl?: string;
  routingConsentEnabled?: boolean;
  outcomeSubmissionEnabled?: boolean;
  modelAllowlist?: string[];
}

export interface PluginConfigStored {
  apiBaseUrl?: string;
  routingConsentEnabled?: boolean;
  outcomeSubmissionEnabled?: boolean;
  modelAllowlist?: string[];
}

export interface RedactedPluginConfig
  extends Omit<HokusaiPluginConfig, 'apiKey'> {
  apiKey: '<set>' | '<unset>';
  apiKeyFingerprint?: string;
}

export interface PluginConfigStore {
  read(): Promise<PluginConfigStored | undefined>;
  write(config: PluginConfigStored): Promise<void>;
  clear(): Promise<void>;
}

export interface LoadPluginConfigOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: PluginConfigOverrides;
  store?: PluginConfigStore;
  strictAllowlist?: boolean;
  registry?: ModelRegistry;
}

export class ConfigValidationError extends Error {
  readonly fieldErrors: HokusaiFieldError[];

  constructor(message: string, fieldErrors: HokusaiFieldError[]) {
    super(message);
    this.name = 'ConfigValidationError';
    this.fieldErrors = [...fieldErrors];
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LocalStorePluginConfigStore implements PluginConfigStore {
  readonly #store: LocalStore;

  constructor(store: LocalStore) {
    this.#store = store;
  }

  async read(): Promise<PluginConfigStored | undefined> {
    const record = await this.#store.getConfigRecord(CONFIG_RECORD_ID);
    return record;
  }

  write(config: PluginConfigStored): Promise<void> {
    if ('apiKey' in config) {
      return Promise.reject(
        new Error('apiKey must not be persisted in plugin config storage.'),
      );
    }

    return this.#store.putConfigRecord(
      CONFIG_RECORD_ID,
      config as Record<string, unknown>,
    );
  }

  clear(): Promise<void> {
    return this.#store.deleteConfigRecord(CONFIG_RECORD_ID);
  }
}

export class FilePluginConfigStore implements PluginConfigStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<PluginConfigStored | undefined> {
    try {
      return JSON.parse(await readFile(this.#filePath, 'utf8')) as PluginConfigStored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw error;
    }
  }

  async write(config: PluginConfigStored): Promise<void> {
    if ('apiKey' in config) {
      throw new Error('apiKey must not be persisted in plugin config storage.');
    }

    await mkdir(dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(config, null, 2), 'utf8');
  }

  async clear(): Promise<void> {
    await rm(this.#filePath, { force: true });
  }
}

export async function loadPluginConfig(
  options: LoadPluginConfigOptions = {},
): Promise<HokusaiPluginConfig> {
  const storeConfig = (await options.store?.read()) ?? {};
  const envConfig = readEnvConfig(options.env);
  const overrideConfig = options.overrides ?? {};
  const merged = {
    ...storeConfig,
    ...envConfig,
    ...overrideConfig,
  };
  const fieldErrors: HokusaiFieldError[] = [];

  const apiBaseUrl = normalizeBaseUrl(
    merged.apiBaseUrl ?? DEFAULT_HOKUSAI_BASE_URL,
    fieldErrors,
  );
  const routingConsentEnabled = normalizeBoolean(
    merged.routingConsentEnabled,
    'routingConsentEnabled',
    fieldErrors,
    false,
  );
  const outcomeSubmissionEnabled = normalizeBoolean(
    merged.outcomeSubmissionEnabled,
    'outcomeSubmissionEnabled',
    fieldErrors,
    false,
  );
  const modelAllowlist = normalizeAllowlist(
    merged.modelAllowlist,
    {
      fieldErrors,
      strict: options.strictAllowlist ?? false,
      ...(options.registry ? { registry: options.registry } : {}),
    },
  );
  const apiKey = normalizeApiKey(merged.apiKey, fieldErrors);

  if (fieldErrors.length > 0) {
    throw new ConfigValidationError(
      'Plugin configuration validation failed.',
      fieldErrors,
    );
  }

  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    apiBaseUrl,
    routingConsentEnabled,
    outcomeSubmissionEnabled,
    modelAllowlist,
  };
}

export function redactPluginConfig(
  config: HokusaiPluginConfig,
): RedactedPluginConfig {
  if (!config.apiKey) {
    return {
      apiKey: '<unset>',
      apiBaseUrl: config.apiBaseUrl,
      routingConsentEnabled: config.routingConsentEnabled,
      outcomeSubmissionEnabled: config.outcomeSubmissionEnabled,
      modelAllowlist: [...config.modelAllowlist],
    };
  }

  return {
    apiKey: '<set>',
    apiKeyFingerprint: `...${config.apiKey.slice(-4)}`,
    apiBaseUrl: config.apiBaseUrl,
    routingConsentEnabled: config.routingConsentEnabled,
    outcomeSubmissionEnabled: config.outcomeSubmissionEnabled,
    modelAllowlist: [...config.modelAllowlist],
  };
}

export function summarizeAllowlist(
  config: Pick<HokusaiPluginConfig, 'modelAllowlist'>,
  registry?: ModelRegistry,
): {
  validModelIds: string[];
  unknownEntries: string[];
} {
  const resolvedRegistry =
    registry ?? {
      get() {
        return undefined;
      },
      getDefault() {
        return undefined;
      },
      list() {
        return ANTHROPIC_MODELS;
      },
      listAvailable() {
        return ANTHROPIC_MODELS.filter((model) => model.available !== false);
      },
      resolve(idOrAlias) {
        const normalized = idOrAlias.trim().toLowerCase();
        return ANTHROPIC_MODELS.find(
          (model) =>
            model.id.toLowerCase() === normalized ||
            model.aliases?.some((alias) => alias.toLowerCase() === normalized),
        );
      },
    };

  const validModelIds = new Set<string>();
  const unknownEntries: string[] = [];

  for (const entry of config.modelAllowlist) {
    const descriptor = resolvedRegistry.resolve(entry);
    if (!descriptor || descriptor.provider !== 'anthropic') {
      unknownEntries.push(entry);
      continue;
    }

    validModelIds.add(descriptor.id);
  }

  return {
    validModelIds: [...validModelIds],
    unknownEntries,
  };
}

export function defaultPluginConfigPath(baseDir: string): string {
  return join(baseDir, `${CONFIG_RECORD_ID}.json`);
}

function normalizeApiKey(
  value: unknown,
  fieldErrors: HokusaiFieldError[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    fieldErrors.push({
      path: 'apiKey',
      code: 'invalid_type',
      message: 'Expected apiKey to be a string when provided.',
    });
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(
  value: unknown,
  fieldErrors: HokusaiFieldError[],
): string {
  if (typeof value !== 'string') {
    fieldErrors.push({
      path: 'apiBaseUrl',
      code: 'invalid_type',
      message: 'Expected apiBaseUrl to be a string.',
    });
    return DEFAULT_HOKUSAI_BASE_URL;
  }

  try {
    return new URL(value).toString().replace(/\/+$/, '');
  } catch {
    fieldErrors.push({
      path: 'apiBaseUrl',
      code: 'invalid_value',
      message: `Invalid Hokusai base URL "${String(value)}".`,
    });
    return DEFAULT_HOKUSAI_BASE_URL;
  }
}

function normalizeBoolean(
  value: unknown,
  path: 'routingConsentEnabled' | 'outcomeSubmissionEnabled',
  fieldErrors: HokusaiFieldError[],
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    fieldErrors.push({
      path,
      code: 'invalid_type',
      message: `Expected ${path} to be a boolean.`,
    });
    return defaultValue;
  }

  return value;
}

function normalizeAllowlist(
  value: unknown,
  options: {
    fieldErrors: HokusaiFieldError[];
    strict: boolean;
    registry?: ModelRegistry;
  },
): string[] {
  const rawEntries = value === undefined ? DEFAULT_ALLOWLIST : value;
  if (!Array.isArray(rawEntries)) {
    options.fieldErrors.push({
      path: 'modelAllowlist',
      code: 'invalid_type',
      message: 'Expected modelAllowlist to be an array of strings.',
    });
    return [...DEFAULT_ALLOWLIST];
  }

  const allowlist: string[] = [];

  for (const [index, entry] of rawEntries.entries()) {
    if (typeof entry !== 'string') {
      options.fieldErrors.push({
        path: `modelAllowlist[${index}]`,
        code: 'invalid_type',
        message: 'Expected allowlist entries to be strings.',
      });
      continue;
    }

    const normalized = entry.trim();
    if (normalized.length === 0) {
      continue;
    }

    const descriptor = options.registry?.resolve(normalized);
    if (!descriptor) {
      if (options.strict) {
        options.fieldErrors.push({
          path: `modelAllowlist[${index}]`,
          code: 'invalid_value',
          message: `Unknown model allowlist entry "${normalized}".`,
        });
      }
      allowlist.push(normalized);
      continue;
    }

    if (descriptor.provider !== 'anthropic') {
      if (options.strict) {
        options.fieldErrors.push({
          path: `modelAllowlist[${index}]`,
          code: 'invalid_value',
          message: `Model "${normalized}" is not an Anthropic model.`,
        });
      }
      allowlist.push(normalized);
      continue;
    }

    allowlist.push(descriptor.id);
  }

  return allowlist.length > 0 ? allowlist : [...DEFAULT_ALLOWLIST];
}

function readEnvConfig(env: NodeJS.ProcessEnv | undefined): PluginConfigOverrides {
  if (!env) {
    return {};
  }

  return {
    ...(env.HOKUSAI_API_KEY !== undefined
      ? { apiKey: env.HOKUSAI_API_KEY }
      : {}),
    ...(env.HOKUSAI_API_BASE_URL !== undefined
      ? { apiBaseUrl: env.HOKUSAI_API_BASE_URL }
      : {}),
    ...(env.HOKUSAI_ROUTING_CONSENT !== undefined
      ? {
          routingConsentEnabled: parseBooleanEnv(
            env.HOKUSAI_ROUTING_CONSENT,
          ),
        }
      : {}),
    ...(env.HOKUSAI_OUTCOME_OPT_IN !== undefined
      ? {
          outcomeSubmissionEnabled: parseBooleanEnv(
            env.HOKUSAI_OUTCOME_OPT_IN,
          ),
        }
      : {}),
    ...(env.HOKUSAI_MODEL_ALLOWLIST !== undefined
      ? {
          modelAllowlist: env.HOKUSAI_MODEL_ALLOWLIST.split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        }
      : {}),
  };
}

function parseBooleanEnv(value: string): boolean {
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}
