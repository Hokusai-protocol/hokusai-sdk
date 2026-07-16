import { describe, expect, it, vi } from 'vitest';
import { parseCli, runCli } from './cli.js';
import type { RunAiderLoopResult } from './index.js';

function captureBuffers(): {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    out,
    err,
  };
}

const HAPPY_RESULT: RunAiderLoopResult = {
  routeId: 'route_1',
  allowedModels: ['claude-sonnet-4-6', 'gpt-5'],
  selectedModel: 'claude-sonnet-4-6',
  aider: {
    argv: [],
    bin: 'aider',
    exitCode: 0,
    signal: null,
    wallClockSeconds: 10,
    stdout: '',
    stderr: '',
    missing: false,
    notExecutable: false,
  },
  accounting: {},
  actualCostUsd: 0.12,
  row: {
    schema_version: 'harness_outcome_row/v1',
    task_descriptor: { task_type: 'refactor' },
    allowed_models: ['claude-sonnet-4-6', 'gpt-5'],
    selected_models: {
      coder: 'claude-sonnet-4-6',
      reviewer: 'claude-sonnet-4-6',
    },
    completion_result: 'success',
    actual_cost_usd: 0.12,
  },
  response: {
    accepted: true,
    rowsAccepted: 1,
    rowFidelityTiers: ['training_eligible'],
  },
  fidelityTier: 'training_eligible',
};

describe('parseCli', () => {
  it('parses positional task text', () => {
    const parsed = parseCli(['fix', 'the', 'thing']);
    expect(parsed.taskText).toBe('fix the thing');
  });

  it('parses --message plus passthrough args after --', () => {
    const parsed = parseCli([
      '--message',
      'refactor',
      '--max-cost-usd',
      '0.5',
      '--',
      '--no-auto-commits',
      'file.ts',
    ]);
    expect(parsed.taskText).toBe('refactor');
    expect(parsed.maxCostUsd).toBe(0.5);
    expect(parsed.extraArgs).toEqual(['--no-auto-commits', 'file.ts']);
  });

  it('accumulates repeated --available-model flags', () => {
    const parsed = parseCli([
      '--available-model',
      'openai/gpt-4o',
      '--available-model',
      'openrouter/anthropic/claude-3.5-sonnet',
      '--message',
      'hi',
    ]);
    expect(parsed.availableModels).toEqual([
      'openai/gpt-4o',
      'openrouter/anthropic/claude-3.5-sonnet',
    ]);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseCli(['--unknown', 'value'])).toThrow(/Unknown flag/);
  });

  it('rejects a non-numeric --max-cost-usd', () => {
    expect(() => parseCli(['--max-cost-usd', 'abc'])).toThrow(
      /non-negative number/,
    );
  });

  it('handles --flag=value forms', () => {
    const parsed = parseCli(['--max-cost-usd=0.75', '--message=hi']);
    expect(parsed.maxCostUsd).toBe(0.75);
    expect(parsed.taskText).toBe('hi');
  });
});

describe('runCli', () => {
  it('prints usage and exits 2 when no task is supplied', async () => {
    const buffers = captureBuffers();
    const outcome = await runCli({
      argv: [],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop: vi.fn().mockResolvedValue(HAPPY_RESULT),
    });
    expect(outcome.exitCode).toBe(2);
    expect(buffers.err.join('')).toContain('task description is required');
  });

  it('exits 0 and forwards flags to runAiderLoop on success', async () => {
    const buffers = captureBuffers();
    const runLoop = vi.fn().mockResolvedValue(HAPPY_RESULT);
    const outcome = await runCli({
      argv: [
        '--max-cost-usd',
        '0.5',
        '--available-model',
        'my/model',
        '--message',
        'fix the failing test',
        '--',
        '--no-auto-commits',
      ],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
    });
    expect(outcome.exitCode).toBe(0);
    const call = runLoop.mock.calls[0]?.[0];
    expect(call.budgetUsd).toBe(0.5);
    expect(call.extraModelIds).toContain('my/model');
    expect(call.extraAiderArgs).toEqual(['--no-auto-commits']);
    expect(call.taskText).toBe('fix the failing test');
    expect(buffers.out.join('')).toContain('selected_model: claude-sonnet-4-6');
  });

  it('supplies the task via --message when passed', async () => {
    const buffers = captureBuffers();
    const runLoop = vi.fn().mockResolvedValue(HAPPY_RESULT);
    const outcome = await runCli({
      argv: ['--message', 'do stuff'],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
    });
    expect(outcome.exitCode).toBe(0);
    expect(runLoop.mock.calls[0]?.[0].taskText).toBe('do stuff');
  });

  it('exits 1 when the loop throws (e.g. missing aider)', async () => {
    const buffers = captureBuffers();
    const runLoop = vi.fn().mockRejectedValue(new Error('aider not found'));
    const outcome = await runCli({
      argv: ['fix the thing'],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
    });
    expect(outcome.exitCode).toBe(1);
    expect(buffers.err.join('')).toContain('aider not found');
  });

  it('exits 1 when Aider exits non-zero (loop still returns a row)', async () => {
    const buffers = captureBuffers();
    const failedResult: RunAiderLoopResult = {
      ...HAPPY_RESULT,
      aider: { ...HAPPY_RESULT.aider, exitCode: 2 },
      row: { ...HAPPY_RESULT.row, completion_result: 'failure' },
      actualCostUsd: undefined,
      costOmittedReason: 'aider run failed',
    };
    const runLoop = vi.fn().mockResolvedValue(failedResult);
    const outcome = await runCli({
      argv: ['fix the thing'],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
    });
    expect(outcome.exitCode).toBe(1);
    expect(buffers.out.join('')).toContain('completion_result: failure');
  });

  it('reads message from --message-file when nothing else is provided', async () => {
    const buffers = captureBuffers();
    const runLoop = vi.fn().mockResolvedValue(HAPPY_RESULT);
    const outcome = await runCli({
      argv: ['--message-file', '/tmp/task.txt'],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
      readMessageFile: () => Promise.resolve('  task from file  '),
    });
    expect(outcome.exitCode).toBe(0);
    expect(runLoop.mock.calls[0]?.[0].taskText).toBe('task from file');
  });

  it('warns when HOKUSAI_API_KEY is missing', async () => {
    const buffers = captureBuffers();
    const runLoop = vi.fn().mockResolvedValue(HAPPY_RESULT);
    await runCli({
      argv: ['task'],
      env: {},
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
    });
    expect(buffers.err.join('')).toContain('HOKUSAI_API_KEY');
  });

  it('emits JSON when --json is set', async () => {
    const buffers = captureBuffers();
    const runLoop = vi.fn().mockResolvedValue(HAPPY_RESULT);
    const outcome = await runCli({
      argv: ['--json', 'task text'],
      env: { HOKUSAI_API_KEY: 'x' },
      stdout: buffers.stdout,
      stderr: buffers.stderr,
      createClient: () => ({ route: vi.fn(), submitContribution: vi.fn() }) as never,
      runLoop,
    });
    expect(outcome.exitCode).toBe(0);
    const stdoutJoined = buffers.out.join('');
    const parsed = JSON.parse(stdoutJoined) as {
      selected_model: string;
      fidelity_tier: string | null;
    };
    expect(parsed.selected_model).toBe('claude-sonnet-4-6');
    expect(parsed.fidelity_tier).toBe('training_eligible');
  });
});
