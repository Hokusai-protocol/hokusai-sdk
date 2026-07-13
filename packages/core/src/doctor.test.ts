import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS, InMemoryModelRegistry } from './model-registry.js';
import {
  checkApiKey,
  checkApiKeyAccepted,
  checkApiReachability,
  checkDryRunRoute,
  checkModelAllowlist,
  checkNodeRuntime,
  checkOutcomeConsent,
  checkStateDirWritable,
  renderDoctorReport,
  runDoctor,
  runPluginDoctor,
} from './doctor.js';
import type { FetchTransport } from './client.js';

function createTransport(
  implementation: Parameters<FetchTransport>[0] extends never
    ? never
    : FetchTransport,
): FetchTransport {
  return implementation;
}

describe('runDoctor', () => {
  it('skips reachability without an API key', async () => {
    const transportCalls: string[] = [];
    const report = await runDoctor({
      config: {
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: (input) => {
        transportCalls.push(input);
        return Promise.reject(new Error('should not be called'));
      },
      clock: () => new Date('2026-06-08T12:00:00.000Z'),
    });

    expect(report.auth).toBe('missing');
    expect(report.apiReachable).toBe('skipped');
    expect(transportCalls).toEqual([]);
  });

  it('reports reachable APIs', async () => {
    const report = await runDoctor({
      config: {
        apiKey: 'hk_live_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
    });

    expect(report.apiReachable).toBe('ok');
  });

  it('reports unauthorized APIs', async () => {
    const report = await runDoctor({
      config: {
        apiKey: 'hk_live_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () =>
        Promise.resolve({
          status: 401,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
    });

    expect(report.apiReachable).toBe('unauthorized');
  });

  it('reports unreachable network failures', async () => {
    const report = await runDoctor({
      config: {
        apiKey: 'hk_live_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () => Promise.reject(new Error('offline')),
    });

    expect(report.apiReachable).toBe('unreachable');
  });

  it('aborts slow reachability checks', async () => {
    let aborted = false;
    const transport = createTransport(async (_input, init) => {
      await new Promise<void>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });

      return {
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      };
    });

    const report = await runDoctor({
      config: {
        apiKey: 'hk_live_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport,
      reachabilityTimeoutMs: 10,
    });

    expect(report.apiReachable).toBe('unreachable');
    expect(aborted).toBe(true);
  });

  it('surfaces unknown allowlist entries', async () => {
    const report = await runDoctor({
      config: {
        apiKey: 'hk_live_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6', 'mystery-model'],
      },
      registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
    });

    expect(report.allowlistValid).toBe(false);
    expect(report.unknownAllowlistEntries).toEqual(['mystery-model']);
  });

  it('renders a report without the raw API key', async () => {
    const report = await runDoctor({
      config: {
        apiKey: 'hk_live_secret_abcd',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
    });

    const rendered = renderDoctorReport(report);
    expect(rendered).toContain('apiKey: <set>');
    expect(rendered).not.toContain('hk_live_secret_abcd');
  });
});

describe('plugin doctor checks', () => {
  it('checks node runtime versions', () => {
    expect(checkNodeRuntime('22.3.1', '18.0.0')).toMatchObject({
      status: 'pass',
    });
    expect(checkNodeRuntime('16.9.0', '18.0.0')).toMatchObject({
      status: 'fail',
    });
    expect(checkNodeRuntime('latest', '18.0.0')).toMatchObject({
      status: 'warn',
    });
  });

  it('checks API key presence without leaking the key', () => {
    expect(checkApiKey({ apiKey: 'hk_live_secret' })).toMatchObject({
      status: 'pass',
    });
    expect(checkApiKey({ apiKey: '   ' })).toMatchObject({
      status: 'fail',
      nextAction: expect.stringContaining('HOKUSAI_API_KEY'),
    });
  });

  it('checks outcome consent as a warning', () => {
    expect(
      checkOutcomeConsent({ outcomeSubmissionEnabled: true }),
    ).toMatchObject({
      status: 'pass',
    });
    expect(
      checkOutcomeConsent({ outcomeSubmissionEnabled: false }),
    ).toMatchObject({
      status: 'warn',
      nextAction: expect.stringContaining('hokusai-privacy reporting on'),
    });
  });

  it('checks the Anthropic model allowlist', () => {
    const registry = new InMemoryModelRegistry(ANTHROPIC_MODELS);
    expect(
      checkModelAllowlist(
        { modelAllowlist: ['claude-sonnet-4-6', 'claude-sonnet-4-6'] },
        registry,
      ),
    ).toMatchObject({
      status: 'pass',
      summary: '1 Anthropic model configured in allowlist.',
    });

    expect(
      checkModelAllowlist({ modelAllowlist: ['mystery-model'] }, registry),
    ).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('mystery-model'),
    });
  });

  it('checks dry-run route payload validation', async () => {
    const registry = new InMemoryModelRegistry(ANTHROPIC_MODELS);
    await expect(
      checkDryRunRoute(
        {
          apiKey: 'hk_live_secret',
          apiBaseUrl: 'https://api.hokus.ai',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        },
        registry,
        {
          clock: () => new Date('2026-06-08T12:00:00.000Z'),
        },
      ),
    ).resolves.toMatchObject({
      id: 'dry-run-route',
      status: 'pass',
    });

    await expect(
      checkDryRunRoute(
        {
          apiBaseUrl: 'https://api.hokus.ai',
          routingConsentEnabled: false,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        },
        registry,
      ),
    ).resolves.toMatchObject({
      status: 'skipped',
      nextAction: expect.stringContaining('HOKUSAI_API_KEY'),
    });

    await expect(
      checkDryRunRoute(
        {
          apiKey: 'hk_live_secret',
          apiBaseUrl: 'https://api.hokus.ai',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['mystery-model'],
        },
        registry,
      ),
    ).resolves.toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('no supported model'),
    });
  });

  it('checks state directory writability with sanitized failures', async () => {
    const passResult = await checkStateDirWritable('/tmp/hokusai', () =>
      Promise.resolve(),
    );
    expect(passResult).toMatchObject({ status: 'pass' });

    const failResult = await checkStateDirWritable('/tmp/hokusai', () =>
      Promise.reject(new Error('EACCES: denied /private/secret/path')),
    );
    expect(failResult).toMatchObject({ status: 'fail' });
    expect(failResult.summary).not.toContain('/private/secret/path');
  });

  /**
   * An expired key used to sail through: `api-key` only proves the variable is
   * set, and `api-reachability` probes an unauthenticated path where 401 means
   * "the API is up". Doctor reported "ready to use" while every route failed.
   */
  it('fails when the API rejects the key, and passes when it accepts it', async () => {
    const config = {
      apiKey: 'hk_live_secret',
      apiBaseUrl: 'https://api.hokus.ai',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist: ['claude-sonnet-4-6'],
    };

    const respondWith = (status: number) => () =>
      Promise.resolve({
        status,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      });

    const rejected = await checkApiKeyAccepted(config, respondWith(401));
    expect(rejected.status).toBe('fail');
    expect(rejected.summary).toMatch(/invalid or expired/i);
    expect(rejected.nextAction).toMatch(/HOKUSAI_API_KEY/);

    // Auth runs before method dispatch, so a live key answers the GET probe
    // with 405 Method Not Allowed. Anything that is not 401/403 means the key
    // was accepted.
    await expect(
      checkApiKeyAccepted(config, respondWith(405)),
    ).resolves.toMatchObject({ status: 'pass' });

    await expect(
      checkApiKeyAccepted(config, respondWith(403)),
    ).resolves.toMatchObject({ status: 'fail' });

    await expect(
      checkApiKeyAccepted(config, respondWith(503)),
    ).resolves.toMatchObject({ status: 'warn' });
  });

  it('sends the key as a bearer token to the route path', async () => {
    let seenUrl = '';
    let seenAuth: string | undefined;

    await checkApiKeyAccepted(
      {
        apiKey: 'hk_live_secret',
        apiBaseUrl: 'https://api.hokus.ai',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      (input, init) => {
        seenUrl = String(input);
        seenAuth = (init.headers as Record<string, string>).Authorization;
        return Promise.resolve({
          status: 405,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        });
      },
    );

    expect(seenUrl).toBe('https://api.hokus.ai/api/v1/models/30/predict');
    expect(seenAuth).toBe('Bearer hk_live_secret');
  });

  it('skips verification when no key is configured', async () => {
    await expect(
      checkApiKeyAccepted(
        {
          apiBaseUrl: 'https://api.hokus.ai',
          routingConsentEnabled: true,
          outcomeSubmissionEnabled: false,
          modelAllowlist: ['claude-sonnet-4-6'],
        },
        () => {
          throw new Error('must not call the API without a key');
        },
      ),
    ).resolves.toMatchObject({ status: 'skipped' });
  });

  it('checks API reachability outcomes', async () => {
    const config = {
      apiKey: 'hk_live_secret',
      apiBaseUrl: 'https://api.hokus.ai',
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist: ['claude-sonnet-4-6'],
    };

    await expect(
      checkApiReachability(config, () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
      ),
    ).resolves.toMatchObject({ status: 'pass' });

    await expect(
      checkApiReachability(config, () =>
        Promise.resolve({
          status: 401,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
      ),
    ).resolves.toMatchObject({
      status: 'pass',
      summary: expect.stringContaining('HTTP 401'),
    });

    await expect(
      checkApiReachability(
        config,
        () =>
          Promise.resolve({
            status: 401,
            headers: { get: () => null },
            text: () => Promise.resolve(''),
          }),
        { path: '/api/protected' },
      ),
    ).resolves.toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('HTTP 401'),
    });

    await expect(
      checkApiReachability(config, () =>
        Promise.reject(new TypeError('offline')),
      ),
    ).resolves.toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('TypeError'),
    });

    const abortingTransport = createTransport(async (_input, init) => {
      await new Promise<void>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('timeout', 'AbortError'));
        });
      });

      return {
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      };
    });

    await expect(
      checkApiReachability(config, abortingTransport, { timeoutMs: 10 }),
    ).resolves.toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('timeout'),
    });
  });
});

describe('runPluginDoctor', () => {
  const config = {
    apiKey: 'hk_live_secret',
    apiBaseUrl: 'https://api.hokus.ai',
    routingConsentEnabled: true,
    outcomeSubmissionEnabled: false,
    modelAllowlist: ['claude-sonnet-4-6'],
  };

  it('defaults to network mode when only the API key is configured', async () => {
    const transportCalls: string[] = [];
    const report = await runPluginDoctor({
      config: {
        ...config,
        routingConsentEnabled: false,
      },
      transport: (input) => {
        transportCalls.push(input);
        return Promise.reject(new Error('should not be called'));
      },
      nodeVersion: '22.0.0',
      stateDir: '/tmp/hokusai',
      storageProber: () => Promise.resolve(),
      clock: () => new Date('2026-06-08T12:00:00.000Z'),
    });

    expect(report.mode).toBe('network');
    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === 'dry-run-route'),
    ).toMatchObject({
      status: 'pass',
    });
    expect(
      report.checks.find((check) => check.id === 'api-reachability'),
    ).toMatchObject({
      status: 'fail',
    });
    // Network mode now probes twice: reachability, then whether the API
    // actually accepts the key.
    expect(
      report.checks.find((check) => check.id === 'api-key-accepted'),
    ).toMatchObject({
      status: 'warn',
    });
    expect(transportCalls).toEqual([
      'https://api.hokus.ai/api/health',
      'https://api.hokus.ai/api/v1/models/30/predict',
    ]);
  });

  it('runs network mode when routing is configured and transport is available', async () => {
    const report = await runPluginDoctor({
      config,
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
      nodeVersion: '22.0.0',
      stateDir: '/tmp/hokusai',
      storageProber: () => Promise.resolve(),
      clock: () => new Date('2026-06-08T12:00:00.000Z'),
    });

    expect(report.mode).toBe('network');
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === 'dry-run-route'),
    ).toMatchObject({
      status: 'pass',
    });
    expect(
      report.checks.find((check) => check.id === 'api-reachability'),
    ).toMatchObject({
      status: 'pass',
    });
  });

  it('stays safe when network mode is requested without transport', async () => {
    const report = await runPluginDoctor({
      config,
      mode: 'network',
      nodeVersion: '22.0.0',
      stateDir: '/tmp/hokusai',
      storageProber: () => Promise.resolve(),
    });

    expect(report.mode).toBe('network');
    expect(
      report.checks.find((check) => check.id === 'api-reachability'),
    ).toMatchObject({
      status: 'skipped',
    });
  });

  it('reports dry-run route failures', async () => {
    const report = await runPluginDoctor({
      config,
      nodeVersion: '22.0.0',
      stateDir: '/tmp/hokusai',
      storageProber: () => Promise.resolve(),
      routeDryRunClient: {
        route: () => Promise.reject(new Error('bad hk_live_secret')),
      },
    });

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === 'dry-run-route'),
    ).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('<api-key>'),
    });
  });

  it('never includes raw secrets in summaries or next actions', async () => {
    const report = await runPluginDoctor({
      config,
      nodeVersion: '22.0.0',
      stateDir: '/tmp/hokusai',
      storageProber: () => Promise.resolve(),
    });

    const renderedChecks = report.checks
      .flatMap((check) => [check.summary, check.nextAction ?? ''])
      .join('\n');
    expect(renderedChecks).not.toContain('hk_live_secret');
  });
});
