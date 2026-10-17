import { describe, expect, it } from 'vitest';
import { enumerateWindow } from './enumerate.js';
import type { GitCommandResult } from '../survival-labeller.js';
const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), d = 'd'.repeat(40);
describe('enumerateWindow', () => {
  it('walks oldest first, filters the date window, extracts PRs, and caps newest merges', () => {
    let logArgs: readonly string[] = [];
    const runGit = (args: readonly string[]): GitCommandResult => {
      if (args[0] === 'merge-base') return { stdout: '', stderr: '', exitCode: 0 };
      logArgs = args;
      return { stdout: [
        `${a}\t${b} ${c}\t1780000000\tMerge pull request #10 from org/feature`,
        `${d}\t${c} ${b}\t1781000000\tchore: no issue`,
      ].join('\n'), stderr: '', exitCode: 0 };
    };
    const result = enumerateWindow({ runGit, branch: 'develop', from: new Date(1780000000000), to: new Date(1782000000000), cursor: null, maxPrs: 1 });
    expect(logArgs[0]).toBe('log');
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]).toMatchObject({ mergeSha: d, prNumber: null, headSha: b });
  });
  it('resets a non-ancestor cursor and rejects malformed windows', () => {
    const runGit = (args: readonly string[]): GitCommandResult => args[0] === 'merge-base'
      ? { stdout: '', stderr: '', exitCode: 1 }
      : { stdout: '', stderr: '', exitCode: 0 };
    expect(enumerateWindow({ runGit, branch: 'main', from: new Date(0), to: new Date(1), cursor: a }).cursorReset).toBe(true);
    expect(() => enumerateWindow({ runGit, branch: 'main', from: new Date(2), to: new Date(1) })).toThrow(/Invalid merge window/);
  });
});
