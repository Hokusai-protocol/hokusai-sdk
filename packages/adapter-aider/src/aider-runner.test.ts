import { describe, expect, it, vi } from 'vitest';
import {
  buildAiderArgv,
  runAider,
  type ChildProcessLike,
  type SpawnFn,
} from './aider-runner.js';

interface DataListener {
  (chunk: Buffer | string): void;
}
interface CloseListener {
  (code: number | null, signal: NodeJS.Signals | null): void;
}
interface ErrorListener {
  (error: NodeJS.ErrnoException): void;
}

interface FakeChild extends ChildProcessLike {
  emitStdout: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  emitClose: (code: number | null, signal?: NodeJS.Signals) => void;
  emitError: (error: NodeJS.ErrnoException) => void;
}

function createFakeChild(): FakeChild {
  const stdoutListeners: DataListener[] = [];
  const stderrListeners: DataListener[] = [];
  const closeListeners: CloseListener[] = [];
  const errorListeners: ErrorListener[] = [];
  const child: FakeChild = {
    stdout: {
      on(event, listener) {
        if (event === 'data') {
          stdoutListeners.push(listener);
        }
      },
    },
    stderr: {
      on(event, listener) {
        if (event === 'data') {
          stderrListeners.push(listener);
        }
      },
    },
    on(event, listener) {
      if (event === 'close') {
        closeListeners.push(listener as CloseListener);
      } else if (event === 'error') {
        errorListeners.push(listener as ErrorListener);
      }
      return child;
    },
    emitStdout(chunk) {
      for (const listener of stdoutListeners) {
        listener(chunk);
      }
    },
    emitStderr(chunk) {
      for (const listener of stderrListeners) {
        listener(chunk);
      }
    },
    emitClose(code, signal) {
      for (const listener of closeListeners) {
        listener(code, signal ?? null);
      }
    },
    emitError(error) {
      for (const listener of errorListeners) {
        listener(error);
      }
    },
  };
  return child;
}

describe('buildAiderArgv', () => {
  it('always passes --model and --message with the wrapper defaults', () => {
    const argv = buildAiderArgv({ model: 'openai/gpt-4o', message: 'fix it' });
    expect(argv).toEqual([
      '--model',
      'openai/gpt-4o',
      '--yes-always',
      '--no-stream',
      '--no-pretty',
      '--analytics-disable',
      '--message',
      'fix it',
    ]);
  });

  it('appends extraArgs after the wrapper defaults', () => {
    const argv = buildAiderArgv({
      model: 'openrouter/anthropic/claude-3.5-sonnet',
      message: 'refactor',
      extraArgs: ['--no-auto-commits', 'src/foo.ts'],
    });
    expect(argv.slice(-2)).toEqual(['--no-auto-commits', 'src/foo.ts']);
    expect(argv).toContain('--model');
    expect(argv[1]).toBe('openrouter/anthropic/claude-3.5-sonnet');
  });
});

describe('runAider', () => {
  it('resolves with wall-clock timing, exit code, and captured stdio', async () => {
    const child = createFakeChild();
    const spawn: SpawnFn = vi.fn(() => child);
    let clock = 1_000;
    const now = (): number => clock;
    const promise = runAider({
      model: 'openai/gpt-4o',
      message: 'do the thing',
      spawn,
      now,
      streamToParent: false,
    });
    child.emitStdout('Model: openai/gpt-4o with diff edit format\n');
    child.emitStderr('warn: hi\n');
    clock = 3_500;
    child.emitClose(0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Model: openai/gpt-4o');
    expect(result.stderr).toContain('warn: hi');
    expect(result.wallClockSeconds).toBeCloseTo(2.5, 3);
    expect(result.missing).toBe(false);
  });

  it('marks a missing binary via ENOENT emitted after spawn', async () => {
    const child = createFakeChild();
    const spawn: SpawnFn = vi.fn(() => child);
    const promise = runAider({
      model: 'x',
      message: 'y',
      spawn,
      now: () => 0,
      streamToParent: false,
    });
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    child.emitError(enoent);
    const result = await promise;
    expect(result.missing).toBe(true);
    expect(result.notExecutable).toBe(false);
    expect(result.exitCode).toBeNull();
  });

  it('marks EACCES separately from missing binary', async () => {
    const child = createFakeChild();
    const spawn: SpawnFn = vi.fn(() => child);
    const promise = runAider({
      model: 'x',
      message: 'y',
      spawn,
      now: () => 0,
      streamToParent: false,
    });
    child.emitError(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    const result = await promise;
    expect(result.missing).toBe(false);
    expect(result.notExecutable).toBe(true);
  });

  it('captures a signal death as a failure with exitCode null', async () => {
    const child = createFakeChild();
    const spawn: SpawnFn = vi.fn(() => child);
    const promise = runAider({
      model: 'x',
      message: 'y',
      spawn,
      now: () => 0,
      streamToParent: false,
    });
    child.emitClose(null, 'SIGTERM');
    const result = await promise;
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGTERM');
  });

  it('surfaces synchronous spawn failures as missing/notExecutable', async () => {
    const spawn: SpawnFn = () => {
      throw Object.assign(new Error('boom'), { code: 'ENOENT' });
    };
    const result = await runAider({
      model: 'x',
      message: 'y',
      spawn,
      now: () => 0,
      streamToParent: false,
    });
    expect(result.missing).toBe(true);
    expect(result.exitCode).toBeNull();
  });
});
