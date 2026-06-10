import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS, InMemoryModelRegistry } from './model-registry.js';
import { InMemoryLocalStore } from './storage.js';
import {
  ConfigValidationError,
  FilePluginConfigStore,
  LocalStorePluginConfigStore,
  loadPluginConfig,
  redactPluginConfig,
} from './config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dirPath) =>
      rm(dirPath, { recursive: true, force: true }),
    ),
  );
});

describe('loadPluginConfig', () => {
  it('applies precedence in the order overrides, env, store, defaults', async () => {
    const store = new LocalStorePluginConfigStore(new InMemoryLocalStore());
    await store.write({
      apiBaseUrl: 'https://store.example.test',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist: ['claude-opus-4-8'],
    });

    const config = await loadPluginConfig({
      store,
      env: {
        HOKUSAI_API_KEY: 'hk_env_1234',
        HOKUSAI_API_BASE_URL: 'https://env.example.test',
        HOKUSAI_ROUTING_CONSENT: 'false',
        HOKUSAI_OUTCOME_OPT_IN: 'yes',
        HOKUSAI_MODEL_ALLOWLIST: 'sonnet',
      },
      overrides: {
        apiKey: 'hk_override_9999',
        apiBaseUrl: 'https://override.example.test',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: true,
        modelAllowlist: ['claude-haiku-4-5-20251001'],
      },
      registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
    });

    expect(config).toEqual({
      apiKey: 'hk_override_9999',
      apiBaseUrl: 'https://override.example.test',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: true,
      modelAllowlist: ['claude-haiku-4-5-20251001'],
    });
  });

  it('loads all fields independently from the environment', async () => {
    const config = await loadPluginConfig({
      env: {
        HOKUSAI_API_KEY: 'hk_env_abcd',
        HOKUSAI_API_BASE_URL: 'https://env.example.test/root/',
        HOKUSAI_ROUTING_CONSENT: '1',
        HOKUSAI_OUTCOME_OPT_IN: 'true',
        HOKUSAI_MODEL_ALLOWLIST: 'sonnet,claude-opus-4-8',
      },
      registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
    });

    expect(config).toEqual({
      apiKey: 'hk_env_abcd',
      apiBaseUrl: 'https://env.example.test/root',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: true,
      modelAllowlist: ['claude-sonnet-4-6', 'claude-opus-4-8'],
    });
  });

  it('falls back to defaults when config sources are empty', async () => {
    const config = await loadPluginConfig({});

    expect(config.apiKey).toBeUndefined();
    expect(config.apiBaseUrl).toBe('https://api.hokus.ai');
    expect(config.routingConsentEnabled).toBe(false);
    expect(config.outcomeSubmissionEnabled).toBe(false);
    expect(config.modelAllowlist).toEqual(
      ANTHROPIC_MODELS.map((model) => model.id),
    );
  });

  it('throws ConfigValidationError for invalid base URLs', async () => {
    await expect(
      loadPluginConfig({
        env: {
          HOKUSAI_API_BASE_URL: 'not-a-url',
        },
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('can enforce a strict allowlist', async () => {
    await expect(
      loadPluginConfig({
        overrides: {
          modelAllowlist: ['gpt-5-codex'],
        },
        strictAllowlist: true,
        registry: new InMemoryModelRegistry([
          ...ANTHROPIC_MODELS,
          {
            id: 'gpt-5-codex',
            provider: 'openai',
            family: 'gpt',
            capabilities: ['reasoning'],
          },
        ]),
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
  });
});

describe('redactPluginConfig', () => {
  it('never includes the raw API key in the redacted shape or JSON', () => {
    const redacted = redactPluginConfig({
      apiKey: 'hk_live_secret_abcd',
      apiBaseUrl: 'https://api.hokus.ai',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist: ['claude-sonnet-4-6'],
    });

    expect(redacted.apiKey).toBe('<set>');
    expect(redacted.apiKeyFingerprint).toBe('...abcd');
    expect(JSON.stringify(redacted)).not.toContain('hk_live_secret_abcd');
  });
});

describe('plugin config stores', () => {
  it('rejects payloads containing apiKey fields', async () => {
    const store = new LocalStorePluginConfigStore(new InMemoryLocalStore());

    await expect(
      store.write({
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
        ...(JSON.parse('{"apiKey":"forbidden"}') as { apiKey: string }),
      }),
    ).rejects.toThrow(/apiKey/i);
  });

  it('writes local config files without persisting secrets', async () => {
    const dirPath = await mkdtemp(join(tmpdir(), 'hokusai-plugin-config-'));
    tempDirs.push(dirPath);
    const filePath = join(dirPath, 'plugin-config.json');
    const store = new FilePluginConfigStore(filePath);

    await store.write({
      apiBaseUrl: 'https://api.hokus.ai',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist: ['claude-sonnet-4-6'],
    });

    const fileContents = await readFile(filePath, 'utf8');
    expect(fileContents).not.toContain('apiKey');
  });
});
