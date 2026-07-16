import { spawn, type SpawnOptions } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export interface AiderRunOptions {
  /** Executable to invoke. Defaults to `aider` on PATH. */
  bin?: string;
  /** Model id to hand to `aider --model`. Passed byte-for-byte. */
  model: string;
  /** One-shot task text for `aider --message`. */
  message: string;
  /** Working directory Aider is launched in. */
  cwd?: string;
  /** Environment for the Aider process. Defaults to the parent's env. */
  env?: NodeJS.ProcessEnv;
  /** Extra argv appended after the wrapper's defaults. */
  extraArgs?: string[];
  /** Also stream captured output to the parent process. Defaults to true. */
  streamToParent?: boolean;
  /** Injectable spawn — the tests replace this with a fake. */
  spawn?: SpawnFn;
  /** Injectable performance clock — tests substitute monotonic frozen values. */
  now?: () => number;
}

export interface AiderRunResult {
  argv: string[];
  bin: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  wallClockSeconds: number;
  stdout: string;
  stderr: string;
  /** True when the process never started because the binary was missing. */
  missing: boolean;
  /** True when the binary existed but was not executable. */
  notExecutable: boolean;
  /** Node error surfaced by spawn(); populated on ENOENT/EACCES too. */
  spawnError?: NodeJS.ErrnoException;
}

export interface ChildProcessLike {
  stdout?: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): void;
  } | null;
  stderr?: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): void;
  } | null;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessLike;

const DEFAULT_ARGS = [
  '--yes-always',
  '--no-stream',
  '--no-pretty',
  '--analytics-disable',
];

/**
 * Build the argv Aider is launched with. The wrapper's defaults come first so
 * caller-supplied `extraArgs` can override any of them (Aider takes the last
 * value on the line for repeated flags).
 */
export function buildAiderArgv(options: {
  model: string;
  message: string;
  extraArgs?: string[];
}): string[] {
  const argv = [
    '--model',
    options.model,
    ...DEFAULT_ARGS,
    '--message',
    options.message,
    ...(options.extraArgs ?? []),
  ];
  return argv;
}

const nodeSpawn: SpawnFn = (command, args, spawnOptions) =>
  spawn(command, [...args], spawnOptions);

/**
 * Launch Aider with the routed model and capture wall-clock timing plus
 * stdout/stderr. Errors from spawn (ENOENT/EACCES) are surfaced through the
 * `missing`/`notExecutable` flags instead of throwing so the caller can decide
 * what to submit.
 */
export async function runAider(
  options: AiderRunOptions,
): Promise<AiderRunResult> {
  const bin = options.bin ?? 'aider';
  const argv = buildAiderArgv({
    model: options.model,
    message: options.message,
    ...(options.extraArgs ? { extraArgs: options.extraArgs } : {}),
  });
  const streamToParent = options.streamToParent ?? true;
  const doSpawn = options.spawn ?? nodeSpawn;
  const now = options.now ?? (() => performance.now());

  const spawnOptions: SpawnOptions = {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
  };

  const startedAt = now();
  let child: ChildProcessLike;
  try {
    child = doSpawn(bin, argv, spawnOptions);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const finishedAt = now();
    return {
      argv,
      bin,
      exitCode: null,
      signal: null,
      wallClockSeconds: (finishedAt - startedAt) / 1000,
      stdout: '',
      stderr: '',
      missing: err.code === 'ENOENT',
      notExecutable: err.code === 'EACCES',
      spawnError: err,
    };
  }

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (chunk) => {
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    stdout += text;
    if (streamToParent) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on('data', (chunk) => {
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    stderr += text;
    if (streamToParent) {
      process.stderr.write(text);
    }
  });

  return await new Promise<AiderRunResult>((resolve) => {
    let settled = false;
    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      spawnError?: NodeJS.ErrnoException,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const finishedAt = now();
      resolve({
        argv,
        bin,
        exitCode,
        signal,
        wallClockSeconds: (finishedAt - startedAt) / 1000,
        stdout,
        stderr,
        missing: spawnError?.code === 'ENOENT',
        notExecutable: spawnError?.code === 'EACCES',
        ...(spawnError ? { spawnError } : {}),
      });
    };

    child.on('error', (error) => {
      finish(null, null, error);
    });
    child.on('close', (code, signal) => {
      finish(code, signal);
    });
  });
}
