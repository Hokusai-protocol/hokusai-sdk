import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsLocalStore } from '@hokusai/core';
import { runPrivacyCli, PRIVACY_CLI_EXIT_CODES } from './privacy-cli.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runPrivacyCli', () => {
  it('prints an empty state for list', async () => {
    const configPath = await createTempDir('hokusai-privacy-empty-');
    const result = await runPrivacyCli(['list', '--config', configPath], {});

    expect(result.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);
    expect(result.stdout).toContain('No records found.');
  });

  it('lists decisions and returns JSON output', async () => {
    const configPath = await createTempDir('hokusai-privacy-list-');
    const store = new FsLocalStore(configPath);
    await store.putPayloadHash({
      hash: 'hash-1',
      algorithm: 'sha-256-hmac',
      createdAt: Date.now(),
    });
    await store.putCorrelation({
      correlationId: 'corr-1',
      packetHash: 'task-1',
      createdAt: Date.now(),
      metadata: {
        taskId: 'task-1',
        originalCorrelationId: 'route:1',
        recommendedModelId: 'claude-sonnet-4-6',
        recommendedAlternativeIds: '[]',
        reasonPreview: 'short reason',
        status: 'pending',
        payloadHash: 'hash-1',
      },
    });

    const result = await runPrivacyCli(
      ['list', '--json', '--config', configPath],
      {},
    );

    expect(result.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);
    const payload = JSON.parse(result.stdout);
    expect(payload.subcommand).toBe('list');
    expect(payload.result[0]).toMatchObject({
      correlationId: 'route:1',
      recommendedModelId: 'claude-sonnet-4-6',
    });
  });

  it('fails preview for unknown ids', async () => {
    const configPath = await createTempDir('hokusai-privacy-missing-');
    const result = await runPrivacyCli(
      ['preview', 'missing', '--config', configPath],
      {},
    );

    expect(result.exitCode).toBe(
      PRIVACY_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
    );
    expect(result.stderr).toContain('No record found for correlation id: missing');
  });

  it('prints audit empty state and prunes by default retention', async () => {
    const configPath = await createTempDir('hokusai-privacy-audit-');
    const store = new FsLocalStore(configPath);
    const now = Date.UTC(2026, 5, 8);
    await store.appendAudit({
      id: 'audit-old',
      kind: 'routing',
      correlationId: 'old',
      status: 'submitted',
      timestamp: now - 10 * 24 * 60 * 60 * 1000,
    });

    const result = await runPrivacyCli(['audit', '--config', configPath], {});

    expect(result.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);
    expect(result.stdout).toContain('No audit entries found.');
  });

  it('requires --yes for clear and clears all state when confirmed', async () => {
    const configPath = await createTempDir('hokusai-privacy-clear-');
    const store = new FsLocalStore(configPath);
    await store.putCorrelation({
      correlationId: 'corr-clear',
      packetHash: 'task-clear',
      createdAt: Date.now(),
    });

    const rejected = await runPrivacyCli(
      ['clear', '--all', '--config', configPath],
      {},
    );
    expect(rejected.exitCode).toBe(
      PRIVACY_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
    );
    expect(rejected.stderr).toContain('Re-run with --yes to confirm.');

    const accepted = await runPrivacyCli(
      ['clear', '--all', '--yes', '--config', configPath],
      {},
    );
    expect(accepted.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);
    expect(await store.listCorrelations()).toHaveLength(0);
  });

  it('toggles reporting and reports effective status', async () => {
    const configPath = await createTempDir('hokusai-privacy-reporting-');

    const off = await runPrivacyCli(
      ['reporting', 'off', '--config', configPath],
      {},
    );
    expect(off.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);

    const status = await runPrivacyCli(
      ['reporting', 'status', '--json', '--config', configPath],
      {},
    );
    const payload = JSON.parse(status.stdout);
    expect(payload.result).toEqual({
      enabled: false,
      source: 'stored',
    });
  });

  it('reports debug status and off guidance', async () => {
    const status = await runPrivacyCli(['debug', 'status'], {
      HOKUSAI_DEBUG: '1',
    });
    expect(status.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);
    expect(status.stdout).toContain('Debug previews are enabled.');

    const off = await runPrivacyCli(['debug', 'off'], {});
    expect(off.stdout).toContain('Unset HOKUSAI_DEBUG');
  });

  it('validates limit arguments', async () => {
    const configPath = await createTempDir('hokusai-privacy-limit-');
    const result = await runPrivacyCli(
      ['list', '--limit', '-1', '--config', configPath],
      {},
    );

    expect(result.exitCode).toBe(
      PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
    );
    expect(result.stderr).toContain('Expected --limit to be a non-negative integer.');
  });

  it('surfaces retention warnings in JSON output', async () => {
    const configPath = await createTempDir('hokusai-privacy-retention-');
    const store = new FsLocalStore(configPath);
    await store.putCorrelation({
      correlationId: 'corr-retention',
      packetHash: 'task-retention',
      createdAt: Date.now(),
    });

    const result = await runPrivacyCli(
      ['list', '--json', '--config', configPath],
      {
        HOKUSAI_RETENTION_DAYS: 'invalid',
      },
    );

    expect(result.exitCode).toBe(PRIVACY_CLI_EXIT_CODES.OK);
    const payload = JSON.parse(result.stdout);
    expect(payload.warnings).toEqual([
      'Ignoring invalid HOKUSAI_RETENTION_DAYS value: invalid. Using default 7 day retention.',
    ]);
  });
});
