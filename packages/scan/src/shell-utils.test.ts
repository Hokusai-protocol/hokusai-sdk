import { describe, expect, it } from 'vitest';
import { escapeShellArg, execArgvCommand } from './shell-utils.js';

describe('escapeShellArg', () => {
  it('wraps plain strings in single quotes', () => {
    expect(escapeShellArg('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(escapeShellArg("user's file.txt")).toBe("'user'\\''s file.txt'");
  });

  it('handles the empty string', () => {
    expect(escapeShellArg('')).toBe("''");
  });
});

describe('execArgvCommand', () => {
  it('captures stdout with exit code 0', () => {
    const result = execArgvCommand('printf', ['%s', 'ok'], { encoding: 'utf-8' });
    expect(result.exitCode).toBe(0);
    expect(result.failed).toBe(false);
    expect(result.stdout).toBe('ok');
  });

  it('captures a non-zero exit code without throwing', () => {
    const result = execArgvCommand('/bin/sh', ['-c', 'echo err >&2; exit 3'], {
      encoding: 'utf-8',
    });
    expect(result.exitCode).toBe(3);
    expect(result.failed).toBe(false);
    expect(result.stderr).toContain('err');
  });

  it('marks a missing executable as failed with exit code -1', () => {
    const result = execArgvCommand('definitely-not-a-real-binary-42', []);
    expect(result.failed).toBe(true);
    expect(result.exitCode).toBe(-1);
  });
});
