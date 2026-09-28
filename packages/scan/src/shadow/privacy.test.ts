/**
 * Raw-content leakage test (REQ-F9, Arbiter S5): a repo whose commit
 * messages, author identity and file contents carry a fake secret and an
 * email must produce shadow data and stdout containing neither string.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runShadowCli } from './cli.js';
import { GIT_OUTPUT_MAX_BUFFER } from '../survival-labeller.js';

const SECRET = 'sk-test-SHADOWLEAK123';
const EMAIL = 'leak@example.com';
const NOW_EPOCH = 1_760_000_000;
const DAY = 86400;

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

describe('shadow data never contains raw content (REQ-F9)', () => {
  it('secret strings in messages, emails and diffs never reach the data dir or stdout', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-leak-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-leak-data-'));
    cleanups.push(repoDir, dataDir);

    const env = (epoch: number): NodeJS.ProcessEnv => ({
      ...process.env,
      GIT_AUTHOR_NAME: 'Leaky Author',
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: 'Leaky Author',
      GIT_COMMITTER_EMAIL: EMAIL,
      GIT_AUTHOR_DATE: `${epoch} +0000`,
      GIT_COMMITTER_DATE: `${epoch} +0000`,
      GIT_CONFIG_NOSYSTEM: '1',
    });
    const git = (args: string[], epoch: number): void => {
      execFileSync('git', ['-C', repoDir, ...args], {
        env: env(epoch),
        maxBuffer: GIT_OUTPUT_MAX_BUFFER,
      });
    };

    const base = NOW_EPOCH - 3 * DAY;
    git(['init', '--quiet', '--initial-branch', 'auto/integration'], base);
    writeFileSync(join(repoDir, 'README.md'), 'base\n');
    git(['add', '.'], base);
    git(['commit', '--quiet', '-m', 'initial commit'], base);

    // A merged PR whose branch commit and merge subject carry the secret,
    // whose changed file contains both strings.
    git(['checkout', '--quiet', '-b', 'feat-1'], base + 100);
    writeFileSync(join(repoDir, 'config.txt'), `token=${SECRET}\ncontact=${EMAIL}\n`);
    git(['add', '.'], base + 100);
    git(['commit', '--quiet', '-m', `feat: add ${SECRET} for ${EMAIL}`], base + 100);
    git(['checkout', '--quiet', 'auto/integration'], base + 200);
    git(
      ['merge', '--quiet', '--no-ff', '-m', `Merge pull request #1 from o/feat-1 leaking ${SECRET} ${EMAIL}`, 'feat-1'],
      base + 200,
    );

    const stdout: string[] = [];
    const args = [
      '--data-dir', dataDir,
      '--repo', repoDir,
      '--github-repo', 'o/r',
      '--integration-branch', 'auto/integration',
    ];
    const io = { log: (l: string) => stdout.push(l), cwd: repoDir, now: () => new Date(NOW_EPOCH * 1000) };

    expect(runShadowCli('shadow-score', args, io).exitCode).toBe(0);
    expect(runShadowCli('shadow-backfill', args, io).exitCode).toBe(0);
    expect(runShadowCli('shadow-report', ['--data-dir', dataDir], io).exitCode).toBe(0);

    const scores = readFileSync(join(dataDir, 'scores.jsonl'), 'utf-8');
    expect(scores.length).toBeGreaterThan(0);

    for (const file of walkFiles(dataDir)) {
      const content = readFileSync(file, 'utf-8');
      expect(content, `${file} leaks the secret`).not.toContain(SECRET);
      expect(content, `${file} leaks the email`).not.toContain(EMAIL);
    }
    const allStdout = stdout.join('\n');
    expect(allStdout).not.toContain(SECRET);
    expect(allStdout).not.toContain(EMAIL);
  });
});
