import { spawn } from 'node:child_process';

export const AIDER_INSTALL_MESSAGE =
  'aider not found on PATH — install Aider (https://aider.chat) or set --aider-path';

export function formatAiderNotFoundMessage(binary: string): string {
  const trimmed = binary.trim();
  if (trimmed === '' || trimmed === 'aider') {
    return AIDER_INSTALL_MESSAGE;
  }
  return `${AIDER_INSTALL_MESSAGE} (attempted: ${trimmed})`;
}

export interface RunAiderProcessOptions {
  task: string;
  model: string;
  cwd: string;
  aiderPath?: string;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  now?: () => number;
}

export interface AiderProcessResult {
  completionResult: 'success' | 'failure';
  stdout: string;
  stderr: string;
  combinedOutput: string;
  wallClockSeconds: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  argv: string[];
  binary: string;
  cwd: string;
}

export class AiderBinaryNotFoundError extends Error {
  readonly binary: string;

  constructor(binary: string) {
    super(formatAiderNotFoundMessage(binary));
    this.name = 'AiderBinaryNotFoundError';
    this.binary = binary;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function roundSeconds(milliseconds: number): number {
  return Number((milliseconds / 1000).toFixed(3));
}

export function buildAiderArgs(input: {
  model: string;
  task: string;
  extraArgs?: string[];
}): string[] {
  return [
    '--model',
    input.model,
    '--message',
    input.task,
    '--yes',
    ...(input.extraArgs ?? []),
  ];
}

export async function runAiderProcess(
  options: RunAiderProcessOptions,
): Promise<AiderProcessResult> {
  const binary = options.aiderPath?.trim() || 'aider';
  const argv = buildAiderArgs({
    model: options.model,
    task: options.task,
    ...(options.extraArgs ? { extraArgs: options.extraArgs } : {}),
  });
  const now = options.now ?? Date.now;
  const startedAt = now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let combinedOutput = '';

    const child = spawn(binary, argv, {
      cwd: options.cwd,
      ...(options.env ? { env: options.env } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      combinedOutput += chunk;
      options.onStdout?.(chunk);
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      combinedOutput += chunk;
      options.onStderr?.(chunk);
    });

    child.once('error', (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new AiderBinaryNotFoundError(binary));
        return;
      }

      reject(error);
    });

    child.once('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;

      resolve({
        completionResult: exitCode === 0 ? 'success' : 'failure',
        stdout,
        stderr,
        combinedOutput,
        wallClockSeconds: roundSeconds(now() - startedAt),
        exitCode,
        signal,
        argv,
        binary,
        cwd: options.cwd,
      });
    });
  });
}
