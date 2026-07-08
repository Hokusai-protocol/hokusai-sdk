import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginDoctorReport } from '@hokusai/core';
import {
  renderPluginDoctorReport,
  runBootstrapDoctor,
} from './doctor-command.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('renderPluginDoctorReport', () => {
  it('renders statuses and a blocking summary without secrets', () => {
    const report: PluginDoctorReport = {
      checkedAt: '2026-06-08T12:00:00.000Z',
      mode: 'offline',
      ok: false,
      checks: [
        {
          id: 'node-runtime',
          label: 'node-runtime',
          status: 'pass',
          summary: 'Node.js v22.0.0 meets minimum v18.0.0.',
        },
        {
          id: 'api-key',
          label: 'api-key',
          status: 'fail',
          summary: 'API key is not configured.',
          nextAction: 'Set HOKUSAI_API_KEY=hk_live_... to enable routing.',
        },
        {
          id: 'outcome-consent',
          label: 'outcome-consent',
          status: 'warn',
          summary: 'Outcome submission consent is not enabled.',
          nextAction:
            'Run "hokusai-privacy reporting on" to opt into outcome submission persistently, or set HOKUSAI_OUTCOME_OPT_IN=1 for the current shell only.',
        },
        {
          id: 'api-reachability',
          label: 'api-reachability',
          status: 'skipped',
          summary: 'Skipped API reachability check (offline mode).',
        },
      ],
    };

    const rendered = renderPluginDoctorReport(report);
    expect(rendered).toContain('[PASS]');
    expect(rendered).toContain('[FAIL]');
    expect(rendered).toContain('[WARN]');
    expect(rendered).toContain('[SKIP]');
    expect(rendered).toContain(
      'Hokusai routing is unavailable until configured',
    );
    expect(rendered).toContain('Ready to use: no');
    expect(rendered).not.toContain('hk_live_secret');
  });
});

describe('runBootstrapDoctor', () => {
  it('does not require routing consent', async () => {
    const configPath = await createTempDir('hokusai-doctor-default-consent-');
    const result = await runBootstrapDoctor({
      configPath,
      env: {
        HOKUSAI_API_KEY: 'hk_live_secret_abcd',
      },
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
    });

    expect(result.report.mode).toBe('network');
    expect(
      result.report.checks.find((check) => check.id === 'routing-consent'),
    ).toBeUndefined();
    expect(result.rendered).not.toContain('HOKUSAI_ROUTING_CONSENT');
  });

  it('loads config from env and checks the resolved state directory', async () => {
    const configPath = await createTempDir('hokusai-doctor-');
    const result = await runBootstrapDoctor({
      configPath,
      env: {
        HOKUSAI_API_KEY: 'hk_live_secret_abcd',
      },
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        }),
    });

    expect(result.report.mode).toBe('network');
    expect(result.report.ok).toBe(true);
    expect(
      result.report.checks.find((check) => check.id === 'state-dir-writable'),
    ).toMatchObject({
      status: 'pass',
    });
    expect(
      result.report.checks.find((check) => check.id === 'api-reachability'),
    ).toMatchObject({
      status: 'pass',
    });
    expect(result.rendered).not.toContain('hk_live_secret_abcd');
  });

  it('falls back to actionable output when config validation fails', async () => {
    const configPath = await createTempDir('hokusai-doctor-invalid-');
    await writeFile(
      path.join(configPath, 'hokusai-plugin-config.json'),
      JSON.stringify({ outcomeSubmissionEnabled: 'definitely' }),
      'utf8',
    );
    const result = await runBootstrapDoctor({
      configPath,
    });

    expect(result.report.ok).toBe(false);
    expect(result.report.mode).toBe('offline');
    expect(result.report.checks[0]).toMatchObject({
      id: 'config-validation',
      status: 'fail',
      summary: expect.stringContaining('outcomeSubmissionEnabled'),
    });
    expect(result.rendered).toContain('config-validation');
  });
});
