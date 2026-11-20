import { describe, expect, it } from 'vitest';
import {
  createDefaultScanGitHubClient,
  withRateLimitWait,
} from './default-deps.js';

type R = { stdout: string; stderr: string; exitCode: number; failed: boolean };
const ok = (stdout: string): R => ({
  stdout,
  stderr: '',
  exitCode: 0,
  failed: false,
});
const err = (stderr: string): R => ({
  stdout: '',
  stderr,
  exitCode: 1,
  failed: false,
});
const LIMITED = err('gh: API rate limit exceeded for user ID 1. (HTTP 403)');

describe('withRateLimitWait', () => {
  it('fails at once when waiting is not enabled', () => {
    let calls = 0;
    const run = withRateLimitWait(() => (calls++, LIMITED), undefined, {});
    expect(run([]).exitCode).toBe(1);
    expect(calls).toBe(1);
  });

  it('waits for the reset and retries', () => {
    const slept: number[] = [];
    const results = [LIMITED, ok('{}')];
    const run = withRateLimitWait(
      () => results.shift()!,
      {
        maxWaitMs: 3_600_000,
        sleep: (ms) => slept.push(ms),
        nowMs: () => 1_000,
        resetAtMs: () => 61_000,
      },
      {},
    );
    expect(run([]).exitCode).toBe(0);
    expect(slept).toEqual([65_000]);
  });

  it('waits a minute on a secondary limit with no reset, and gives up after maxWaitMs', () => {
    const slept: number[] = [];
    const run = withRateLimitWait(
      () => LIMITED,
      {
        maxWaitMs: 150_000,
        sleep: (ms) => slept.push(ms),
        resetAtMs: () => null,
      },
      {},
    );
    expect(run([]).exitCode).toBe(1);
    expect(slept).toEqual([60_000, 60_000, 30_000]);
  });

  it('does not retry other failures', () => {
    let calls = 0;
    const run = withRateLimitWait(
      () => (calls++, err('HTTP 500')),
      { maxWaitMs: 1e9, sleep: () => undefined },
      {},
    );
    run([]);
    expect(calls).toBe(1);
  });
});

describe('createDefaultScanGitHubClient', () => {
  const target = { owner: 'acme', repo: 'widgets', repoDir: '.' };

  it('falls back to GraphQL when REST says too many files changed', async () => {
    const calls: string[][] = [];
    const client = createDefaultScanGitHubClient(target, {
      runGh: (args) => {
        calls.push([...args]);
        if (args[1] === 'graphql') {
          return ok(
            JSON.stringify({
              data: {
                repository: {
                  pullRequest: {
                    number: 7,
                    title: 't',
                    body: null,
                    author: { login: 'bot', __typename: 'Bot' },
                    headRefName: 'f',
                    headRefOid: 'abc',
                    labels: { nodes: [{ name: 'x' }] },
                    mergedAt: '2026-01-01T00:00:00Z',
                  },
                },
              },
            }),
          );
        }
        return err(
          'gh: The request could not be processed because too many files changed (HTTP 422)',
        );
      },
    });
    await expect(client.getPullRequest(7)).resolves.toEqual({
      number: 7,
      title: 't',
      body: null,
      authorLogin: 'bot',
      authorType: 'Bot',
      headRef: 'f',
      headSha: 'abc',
      labels: ['x'],
      mergedAt: '2026-01-01T00:00:00Z',
    });
    expect(calls.map((c) => c[1])).toEqual([
      'repos/acme/widgets/pulls/7',
      'graphql',
    ]);
  });

  it('still throws on other REST failures and returns null on 404', async () => {
    const client = createDefaultScanGitHubClient(target, {
      runGh: (args) =>
        String(args[1]).endsWith('/1') ? err('HTTP 404') : err('HTTP 500'),
    });
    await expect(client.getPullRequest(1)).resolves.toBeNull();
    await expect(client.getPullRequest(2)).rejects.toThrow(
      /GitHub request failed/,
    );
  });
});
