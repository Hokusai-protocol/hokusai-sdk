import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiderBinaryNotFoundError } from './aider-runner.js';
import {
  CLI_EXIT_CODES,
  runAider,
  runCli,
  type RunCliOptions,
} from './cli.js';
import type { AiderProcessResult } from './aider-runner.js';

interface MemoryStream {
  write(chunk: string): void;
  toString(): string;
}

function createMemoryStream(): MemoryStream {
  let value = '';

  return {
    write(chunk: string) {
      value += chunk;
    },
    toString() {
      return value;
    },
  };
}

function createClient() {
  const route = vi.fn(() =>
    Promise.resolve({
      routeId: 'route_123',
      taskId: 'ignored',
      status: 'accepted' as const,
      recommendation: { model: 'gpt-5-codex' },
    }),
  );
  const submitContribution = vi.fn((request: { rows: unknown[] }) =>
    Promise.resolve({
      accepted: true,
      rowsAccepted: request.rows.length,
      rowFidelityTiers: ['training_eligible'],
    }),
  );

  return {
    client: {
      route,
      submitContribution,
    },
    route,
    submitContribution,
  };
}

function createProcessResult(
  output: string,
  overrides: Partial<AiderProcessResult> = {},
): AiderProcessResult {
  return {
    completionResult: 'success',
    stdout: output,
    stderr: '',
    combinedOutput: output,
    wallClockSeconds: 1.5,
    exitCode: 0,
    signal: null,
    argv: ['--model', 'gpt-5-codex'],
    binary: 'aider',
    cwd: '/tmp/repo',
    ...overrides,
  };
}

async function createRepo(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'hokusai-aider-'));
}

async function runCliWithRepo(
  repoPath: string,
  overrides: Partial<RunCliOptions> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const exitCode = await runCli({
    argv: ['ship it', '--repo', repoPath],
    env: {
      HOKUSAI_API_KEY: 'hk_test',
      ...overrides.env,
    },
    stdout,
    stderr,
    ...(overrides.clock ? { clock: overrides.clock } : {}),
    ...(overrides.client ? { client: overrides.client } : {}),
    ...(overrides.runProcess ? { runProcess: overrides.runProcess } : {}),
  });

  return {
    exitCode,
    stdout: stdout.toString(),
    stderr: stderr.toString(),
  };
}

const reposToDelete: string[] = [];

afterEach(async () => {
  while (reposToDelete.length > 0) {
    const repo = reposToDelete.pop();
    if (repo) {
      await rm(repo, { recursive: true, force: true });
    }
  }
});

describe('runCli', () => {
  it('routes, launches aider, and submits one contribution row', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { client, submitContribution } = createClient();
    const runProcess = vi.fn(() =>
      Promise.resolve(
        createProcessResult(`
Model: gpt-5-codex
Tokens: input 1000 output 250
Cost: $0.009500
`),
      ),
    );

    const result = await runAider({
      taskText: 'ship it',
      repoPath: repo,
      env: { HOKUSAI_API_KEY: 'hk_test' },
      client,
      runProcess,
      clock: () => new Date('2026-07-16T12:00:00.000Z'),
      stdout: createMemoryStream(),
      stderr: createMemoryStream(),
    });

    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(submitContribution).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(CLI_EXIT_CODES.success);
    expect(result.resolvedModel).toBe('gpt-5-codex');
  });

  it('falls back to the user model when the router returns no recommendation', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { submitContribution } = createClient();
    const client = {
      route: vi.fn(() =>
        Promise.resolve({
          routeId: 'route_123',
          taskId: 'ignored',
          status: 'accepted' as const,
        }),
      ),
      submitContribution,
    };
    const runProcess = vi.fn((input: { model: string }) =>
      Promise.resolve(
        createProcessResult(
          `
Model: ${input.model}
Tokens: input 100 output 20
`,
          { argv: ['--model', input.model] },
        ),
      ),
    );

    const result = await runAider({
      taskText: 'ship it',
      repoPath: repo,
      model: 'gpt-5-mini',
      env: { HOKUSAI_API_KEY: 'hk_test' },
      client,
      runProcess,
      clock: () => new Date('2026-07-16T12:00:00.000Z'),
      stdout: createMemoryStream(),
      stderr: createMemoryStream(),
    });

    expect(runProcess).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5-mini' }),
    );
    expect(result.resolvedModel).toBe('gpt-5-mini');
  });

  it('exits 2 when the task is missing', async () => {
    const stdout = createMemoryStream();
    const stderr = createMemoryStream();

    const exitCode = await runCli({
      argv: ['--repo', '/tmp'],
      env: { HOKUSAI_API_KEY: 'hk_test' },
      stdout,
      stderr,
    });

    expect(exitCode).toBe(CLI_EXIT_CODES.usage);
    expect(stderr.toString()).toContain('A task message is required.');
  });

  it('exits 2 when the repo path is invalid', async () => {
    const { client } = createClient();
    const result = await runCli({
      argv: ['ship it', '--repo', '/definitely/missing'],
      env: { HOKUSAI_API_KEY: 'hk_test' },
      stdout: createMemoryStream(),
      stderr: createMemoryStream(),
      client,
    });

    expect(result).toBe(CLI_EXIT_CODES.usage);
  });

  it('routes on dry run without spawning aider or submitting a row', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { client, submitContribution } = createClient();
    const runProcess = vi.fn();
    const stdout = createMemoryStream();
    const stderr = createMemoryStream();

    const exitCode = await runCli({
      argv: ['ship it', '--repo', repo, '--dry-run'],
      env: { HOKUSAI_API_KEY: 'hk_test' },
      stdout,
      stderr,
      client,
      runProcess,
      clock: () => new Date('2026-07-16T12:00:00.000Z'),
    });

    expect(exitCode).toBe(CLI_EXIT_CODES.success);
    expect(runProcess).not.toHaveBeenCalled();
    expect(submitContribution).not.toHaveBeenCalled();
    expect(stdout.toString()).toContain('"dryRun": true');
    expect(stdout.toString()).toContain('"resolvedModel": "gpt-5-codex"');
  });

  it('derives price from known tokens when aider does not report measured cost', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { client, submitContribution } = createClient();
    const runProcess = vi.fn(() =>
      Promise.resolve(
        createProcessResult(`
Model: gpt-5-mini
Tokens: input 2000 output 500
`),
      ),
    );

    const result = await runAider({
      taskText: 'ship it',
      repoPath: repo,
      model: 'gpt-5-mini',
      env: { HOKUSAI_API_KEY: 'hk_test' },
      client: {
        ...client,
        route: vi.fn(() =>
          Promise.resolve({
            routeId: 'route_123',
            taskId: 'ignored',
            status: 'accepted' as const,
            recommendation: { model: 'gpt-5-mini' },
          }),
        ),
      },
      runProcess,
      clock: () => new Date('2026-07-16T12:00:00.000Z'),
      stdout: createMemoryStream(),
      stderr: createMemoryStream(),
    });

    expect(result.actualCostUsd).toBeCloseTo(0.0015, 6);
    expect(submitContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            actual_cost_usd: expect.closeTo(0.0015, 6),
          }),
        ],
      }),
    );
  });

  it('preserves measured aider cost when present', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { client, submitContribution } = createClient();
    const runProcess = vi.fn(() =>
      Promise.resolve(
        createProcessResult(`
Model: gpt-5-codex
Tokens: input 500 output 100
Cost: $0.123456
`),
      ),
    );

    const result = await runAider({
      taskText: 'ship it',
      repoPath: repo,
      env: { HOKUSAI_API_KEY: 'hk_test' },
      client,
      runProcess,
      clock: () => new Date('2026-07-16T12:00:00.000Z'),
      stdout: createMemoryStream(),
      stderr: createMemoryStream(),
    });

    expect(result.actualCostUsd).toBe(0.123456);
    expect(submitContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            actual_cost_usd: 0.123456,
          }),
        ],
      }),
    );
  });

  it('omits unknown cost and logs telemetry-only behavior explicitly', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { client, submitContribution } = createClient();
    const stderr = createMemoryStream();
    const runProcess = vi.fn(() =>
      Promise.resolve(
        createProcessResult('task completed', {
          completionResult: 'failure',
          exitCode: 1,
        }),
      ),
    );

    const result = await runAider({
      taskText: 'ship it',
      repoPath: repo,
      env: { HOKUSAI_API_KEY: 'hk_test' },
      client,
      runProcess,
      clock: () => new Date('2026-07-16T12:00:00.000Z'),
      stdout: createMemoryStream(),
      stderr,
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.error);
    expect(submitContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.not.objectContaining({
            actual_cost_usd: expect.anything(),
          }),
        ],
      }),
    );
    expect(stderr.toString()).toContain('actual_cost_usd: (omitted; telemetry only)');
  });

  it('returns an error when aider is missing and skips submission', async () => {
    const repo = await createRepo();
    reposToDelete.push(repo);
    const { client, submitContribution } = createClient();

    const result = await runCliWithRepo(repo, {
      client,
      runProcess: vi.fn(() =>
        Promise.reject(new AiderBinaryNotFoundError('aider')),
      ),
    });

    expect(result.exitCode).toBe(CLI_EXIT_CODES.error);
    expect(submitContribution).not.toHaveBeenCalled();
    expect(result.stderr).toContain('aider not found on PATH');
  });
});
