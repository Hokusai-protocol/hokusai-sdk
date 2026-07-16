import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiderBinaryNotFoundError,
  buildAiderArgs,
  runAiderProcess,
} from './aider-runner.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

class MockChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

function createChild(): MockChildProcess {
  const child = new MockChildProcess();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

describe('runAiderProcess', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('builds the expected non-interactive aider args', () => {
    expect(
      buildAiderArgs({
        model: 'gpt-5-codex',
        task: 'fix it',
        extraArgs: ['--map-tokens', '2048'],
      }),
    ).toEqual([
      '--model',
      'gpt-5-codex',
      '--message',
      'fix it',
      '--yes',
      '--map-tokens',
      '2048',
    ]);
  });

  it('spawns with --model and --message and uses the repo cwd', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let now = 1_000;

    const resultPromise = runAiderProcess({
      task: 'update the README',
      model: 'gpt-5-codex',
      cwd: '/tmp/repo',
      env: { OPENAI_API_KEY: 'sk-test' },
      onStdout(chunk) {
        stdoutChunks.push(chunk);
      },
      onStderr(chunk) {
        stderrChunks.push(chunk);
      },
      now: () => now,
    });

    child.stdout.write('hello\n');
    child.stderr.write('warn\n');
    now = 2_750;
    child.emit('close', 0, null);

    const result = await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith(
      'aider',
      ['--model', 'gpt-5-codex', '--message', 'update the README', '--yes'],
      {
        cwd: '/tmp/repo',
        env: { OPENAI_API_KEY: 'sk-test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(stdoutChunks).toEqual(['hello\n']);
    expect(stderrChunks).toEqual(['warn\n']);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('warn\n');
    expect(result.combinedOutput).toBe('hello\nwarn\n');
    expect(result.wallClockSeconds).toBe(1.75);
    expect(result.completionResult).toBe('success');
  });

  it('treats a non-zero exit as a completion failure', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = runAiderProcess({
      task: 'task',
      model: 'gpt-5-mini',
      cwd: '/tmp/repo',
    });

    child.emit('close', 3, null);

    const result = await resultPromise;
    expect(result.completionResult).toBe('failure');
    expect(result.exitCode).toBe(3);
  });

  it('raises a dedicated ENOENT error when aider is not installed', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = runAiderProcess({
      task: 'task',
      model: 'gpt-5-mini',
      cwd: '/tmp/repo',
    });

    child.emit(
      'error',
      Object.assign(new Error('spawn aider ENOENT'), { code: 'ENOENT' }),
    );

    await expect(resultPromise).rejects.toBeInstanceOf(AiderBinaryNotFoundError);
  });
});
