import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS, InMemoryModelRegistry } from './model-registry.js';
import { renderDoctorReport, runDoctor } from './doctor.js';
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
        apiBaseUrl: 'https://api.hokusai.app',
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
        apiBaseUrl: 'https://api.hokusai.app',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () => Promise.resolve({
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
        apiBaseUrl: 'https://api.hokusai.app',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () => Promise.resolve({
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
        apiBaseUrl: 'https://api.hokusai.app',
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
      await new Promise<void>((resolve, reject) => {
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
        apiBaseUrl: 'https://api.hokusai.app',
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
        apiBaseUrl: 'https://api.hokusai.app',
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
        apiBaseUrl: 'https://api.hokusai.app',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
        modelAllowlist: ['claude-sonnet-4-6'],
      },
      transport: () => Promise.resolve({
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
