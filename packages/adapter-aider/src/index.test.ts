import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryModelRegistry,
  isHarnessOutcomeRowV1,
  validateContributionRow,
} from '@hokusai/core';
import {
  AIDER_HARNESS_NAME,
  buildAiderCandidatePool,
  DEFAULT_AIDER_MODEL_POOL,
  normalizeExtraModelId,
  runAiderLoop,
  type AiderLoopClient,
} from './index.js';
import type { AiderRunOptions, AiderRunResult } from './aider-runner.js';

const TASK_TEXT = 'refactor the auth middleware to use the new policy engine';

function createFakeClient(
  overrides: {
    routeRecommendation?: string;
    submitResponse?: object;
    submitError?: Error;
  } = {},
): {
  client: AiderLoopClient;
  route: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
} {
  const route = vi.fn(() =>
    Promise.resolve({
      routeId: 'route_abc123',
      taskId: 'aider-test',
      status: 'accepted' as const,
      recommendation: {
        model: overrides.routeRecommendation ?? 'claude-sonnet-4-6',
      },
    }),
  );
  const submit = vi.fn(() => {
    if (overrides.submitError) {
      return Promise.reject(overrides.submitError);
    }
    return Promise.resolve({
      accepted: true,
      requestId: 'req_1',
      submissionId: 'sub_1',
      rowsAccepted: 1,
      rowFidelityTiers: ['training_eligible'],
      ...(overrides.submitResponse ?? {}),
    });
  });
  return {
    client: { route, submitContribution: submit },
    route,
    submit,
  };
}

type FakeRunner = (options: AiderRunOptions) => Promise<AiderRunResult>;

function fakeRunner(result: Partial<AiderRunResult> = {}): FakeRunner {
  return (options) =>
    Promise.resolve({
      argv: [
        '--model',
        options.model,
        '--message',
        options.message,
        ...(options.extraArgs ?? []),
      ],
      bin: options.bin ?? 'aider',
      exitCode: 0,
      signal: null,
      wallClockSeconds: 12.5,
      stdout: 'Main model: claude-sonnet-4-6 with diff edit format\n',
      stderr: '',
      missing: false,
      notExecutable: false,
      ...result,
    });
}

describe('candidate pool', () => {
  it('exposes the built-in pool and constructs a valid registry', () => {
    expect(DEFAULT_AIDER_MODEL_POOL.length).toBeGreaterThan(5);
    const registry = new InMemoryModelRegistry([...DEFAULT_AIDER_MODEL_POOL]);
    expect(registry.list().length).toBe(DEFAULT_AIDER_MODEL_POOL.length);
  });

  it('normalizeExtraModelId produces a routable descriptor', () => {
    const model = normalizeExtraModelId(
      'openrouter/anthropic/claude-3.5-sonnet',
    );
    expect(model.id).toBe('openrouter/anthropic/claude-3.5-sonnet');
    expect(model.provider).toBe('openrouter');
  });

  it('buildAiderCandidatePool dedupes known ids and appends extras', () => {
    const pool = buildAiderCandidatePool([
      'openai/gpt-5', // already in the built-in pool
      'my-local/llama',
    ]);
    const ids = pool.map((model) => model.id);
    expect(ids).toContain('my-local/llama');
    // gpt-5 shows up only once (the built-in wins).
    expect(ids.filter((id) => id === 'my-local/llama')).toHaveLength(1);
  });
});

describe('runAiderLoop', () => {
  it('routes, runs Aider, and submits exactly one row on the happy path', async () => {
    const { client, route, submit } = createFakeClient();
    const runner = fakeRunner({
      stdout: [
        'Main model: claude-sonnet-4-6 with diff edit format',
        'Tokens: 14k sent, 1.1k received. Cost: $0.06 message, $0.21 session.',
      ].join('\n'),
    });

    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      budgetUsd: 0.5,
      runner: runner,
      taskId: 'task-happy',
    });

    expect(route).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.selectedModel).toBe('claude-sonnet-4-6');
    expect(result.actualCostUsd).toBe(0.21);
    expect(result.row.harness).toBe(AIDER_HARNESS_NAME);
    expect(result.row.actual_cost_usd).toBe(0.21);
    expect(result.row.selected_models.coder).toBe('claude-sonnet-4-6');
    expect(result.row.allowed_models.length).toBeGreaterThan(1);
    expect(isHarnessOutcomeRowV1(result.row)).toBe(true);
  });

  it('passes provider-prefixed model ids to Aider byte-for-byte', async () => {
    const { client } = createFakeClient({
      routeRecommendation: 'openrouter/anthropic/claude-3.5-sonnet',
    });
    let capturedArgv: readonly string[] | undefined;
    const runner: FakeRunner = (options) => {
      capturedArgv = ['--model', options.model, '--message', options.message];
      return Promise.resolve({
        argv: [...capturedArgv],
        bin: 'aider',
        exitCode: 0,
        signal: null,
        wallClockSeconds: 5,
        stdout: '',
        stderr: '',
        missing: false,
        notExecutable: false,
      });
    };

    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      extraModelIds: ['openrouter/anthropic/claude-3.5-sonnet'],
      runner,
    });
    expect(result.selectedModel).toBe('openrouter/anthropic/claude-3.5-sonnet');
    expect(capturedArgv?.[1]).toBe('openrouter/anthropic/claude-3.5-sonnet');
  });

  it('derives cost from tokens when Aider does not report a session cost', async () => {
    const { client } = createFakeClient();
    const runner = fakeRunner({
      stdout: 'Tokens: 1,000 sent, 500 received.',
    });

    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      runner: runner,
    });
    // gpt-5 or claude-sonnet-4-6 is priced, so we expect a derived cost.
    expect(result.actualCostUsd).toBeDefined();
    expect(result.actualCostUsd).toBeGreaterThan(0);
  });

  it('omits actual_cost_usd when Aider printed nothing parseable', async () => {
    const { client } = createFakeClient();
    const runner = fakeRunner({ stdout: 'no cost or tokens here' });
    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      runner: runner,
    });
    expect(result.actualCostUsd).toBeUndefined();
    expect(result.costOmittedReason).toContain('no cost');
    expect(result.row.actual_cost_usd).toBeUndefined();
  });

  it('omits actual_cost_usd for an unpriced external model', async () => {
    const { client } = createFakeClient({
      routeRecommendation: 'my-local/llama',
    });
    const runner = fakeRunner({
      stdout: 'Tokens: 100 sent, 50 received.',
    });
    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      extraModelIds: ['my-local/llama'],
      runner: runner,
    });
    expect(result.selectedModel).toBe('my-local/llama');
    expect(result.actualCostUsd).toBeUndefined();
    expect(result.costOmittedReason).toContain('not priced');
  });

  it('submits a telemetry-only failure row on non-zero exit', async () => {
    const { client, submit } = createFakeClient();
    const runner = fakeRunner({
      exitCode: 2,
      stdout: 'Tokens: 100 sent, 50 received. Cost: $0.01 message, $0.05 session.',
    });
    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      runner: runner,
    });
    expect(result.row.completion_result).toBe('failure');
    expect(result.row.actual_cost_usd).toBeUndefined();
    expect(result.costOmittedReason).toContain('failed');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('submits a telemetry-only failure row when Aider was killed by signal', async () => {
    const { client } = createFakeClient();
    const runner = fakeRunner({ exitCode: null, signal: 'SIGKILL' });
    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      runner: runner,
    });
    expect(result.row.completion_result).toBe('failure');
    expect(result.actualCostUsd).toBeUndefined();
  });

  it('does not submit when Aider is missing on PATH', async () => {
    const { client, submit } = createFakeClient();
    const runner = fakeRunner({
      missing: true,
      spawnError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    await expect(
      runAiderLoop({
        client,
        taskText: TASK_TEXT,
        runner: runner,
      }),
    ).rejects.toThrow(/aider/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not submit when Aider exists but is not executable', async () => {
    const { client, submit } = createFakeClient();
    const runner = fakeRunner({ notExecutable: true });
    await expect(
      runAiderLoop({
        client,
        taskText: TASK_TEXT,
        runner: runner,
      }),
    ).rejects.toThrow(/not executable/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not spawn when routing fails', async () => {
    const { client } = createFakeClient();
    const routeError = new Error('boom');
    (client.route as ReturnType<typeof vi.fn>).mockRejectedValueOnce(routeError);
    const runner = vi.fn(fakeRunner());
    await expect(
      runAiderLoop({
        client,
        taskText: TASK_TEXT,
        runner: runner,
      }),
    ).rejects.toThrow('boom');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects an unknown recommendation instead of silently substituting', async () => {
    const { client } = createFakeClient({
      routeRecommendation: 'model-nobody-supports',
    });
    const runner = vi.fn(fakeRunner());
    await expect(
      runAiderLoop({
        client,
        taskText: TASK_TEXT,
        runner: runner,
      }),
    ).rejects.toThrow(/not in the candidate pool/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('never includes raw prompt/stdout in the submitted row', async () => {
    const { client, submit } = createFakeClient();
    const runner = fakeRunner({
      stdout: 'sensitive stdout content that must not leak',
    });
    await runAiderLoop({
      client,
      taskText: 'sensitive-task-text should-not-leak',
      runner: runner,
    });
    const [payload] = submit.mock.calls[0] ?? [];
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('sensitive stdout content');
    expect(serialized).not.toContain('sensitive-task-text');
    // Row still validates.
    expect(() => validateContributionRow(payload.rows[0])).not.toThrow();
  });

  it('surfaces partial fidelity as-is when the server says so', async () => {
    const { client } = createFakeClient({
      submitResponse: { rowFidelityTiers: ['partial'] },
    });
    const runner = fakeRunner({
      stdout: 'no tokens no cost',
    });
    const result = await runAiderLoop({
      client,
      taskText: TASK_TEXT,
      runner: runner,
    });
    expect(result.fidelityTier).toBe('partial');
  });
});
