/**
 * Shadow scoring runner tests (REQ-F2 incremental + idempotent, REQ-F3
 * cursor reset, REQ-F4 per-run cap and partial status).
 */

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ArbiterShadowScoreV1, ArbiterShadowStateV1 } from '@hokusai/core';
import { validateShadowScoreRow, validateShadowState } from '@hokusai/core';
import { extractCandidateFeatures } from '../candidate-features.js';
import { runShadowScore } from './score.js';
import { writeState } from './store.js';
import { createFixtureRepo, type FixtureRepo } from './test-fixture.js';

const NOW_EPOCH = 1_760_000_000; // fixed injected clock
const now = (): Date => new Date(NOW_EPOCH * 1000);
const DAY = 86400;

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-data-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(): FixtureRepo {
  const repo = createFixtureRepo(NOW_EPOCH - 100 * DAY);
  cleanups.push(() => rmSync(repo.dir, { recursive: true, force: true }));
  return repo;
}

function readScores(dataDir: string): ArbiterShadowScoreV1[] {
  const file = join(dataDir, 'scores.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ArbiterShadowScoreV1);
}

function readStateFile(dataDir: string): ArbiterShadowStateV1 {
  return JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf-8')) as ArbiterShadowStateV1;
}

function baseOptions(repo: FixtureRepo, dataDir: string) {
  return {
    dataDir,
    repo: 'o/r',
    integrationBranch: 'auto/integration',
    threshold: 0.5,
    bootstrapDays: 30,
    maxPrs: 200,
    runGit: repo.runGit,
    now,
    log: (): void => {},
  };
}

describe('runShadowScore (REQ-F2)', () => {
  it('scores only merges after the cursor, oldest first, and is idempotent', () => {
    const repo = fixture();
    const shas = repo.addMerges([
      { prNumber: 1, epoch: NOW_EPOCH - 5 * DAY },
      { prNumber: 2, epoch: NOW_EPOCH - 4 * DAY },
      { prNumber: 3, epoch: NOW_EPOCH - 3 * DAY },
      { prNumber: 4, epoch: NOW_EPOCH - 2 * DAY },
      { prNumber: 5, epoch: NOW_EPOCH - 1 * DAY },
    ]);
    const dataDir = tempDataDir();
    writeState(dataDir, {
      schema_version: 'arbiter_shadow_state/v1',
      repo: 'o/r',
      last_seen_merge_sha: shas[1] as string, // PR #2
      last_run_at: now().toISOString(),
      last_run_status: 'ok',
      last_error_code: null,
      scorer_id: 'baseline-v0',
      scorer_version: '0.1.0',
    });

    const result = runShadowScore(baseOptions(repo, dataDir));

    expect(result.scored).toBe(3);
    expect(result.status).toBe('ok');
    const rows = readScores(dataDir);
    expect(rows.map((r) => r.pr_number)).toEqual([3, 4, 5]);
    expect(rows.map((r) => r.merge_sha)).toEqual([shas[2], shas[3], shas[4]]);
    for (const row of rows) {
      expect(validateShadowScoreRow(row).ok).toBe(true);
    }

    const state = readStateFile(dataDir);
    expect(validateShadowState(state).ok).toBe(true);
    expect(state.last_seen_merge_sha).toBe(shas[4]);
    expect(state.last_run_status).toBe('ok');
    expect(state.last_error_code).toBeNull();

    // Immediate re-run: 0 rows, line count unchanged.
    const rerun = runShadowScore(baseOptions(repo, dataDir));
    expect(rerun.scored).toBe(0);
    expect(readScores(dataDir)).toHaveLength(3);
  });

  it('parses squash subjects and records null for no-ref commits', () => {
    const repo = fixture();
    repo.addMerges([
      { prNumber: 7, epoch: NOW_EPOCH - 2 * DAY, squash: true },
      { prNumber: null, epoch: NOW_EPOCH - 1 * DAY },
    ]);
    const dataDir = tempDataDir();

    const result = runShadowScore(baseOptions(repo, dataDir));

    // The initial commit (100 days old) is outside the bootstrap window.
    expect(result.scored).toBe(2);
    const rows = readScores(dataDir);
    expect(rows.map((r) => r.pr_number)).toEqual([7, null]);
  });
});

describe('runShadowScore cursor reset (REQ-F3)', () => {
  function repoWithWindowSplit(): { repo: FixtureRepo; shas: string[] } {
    const repo = fixture();
    const shas = repo.addMerges([
      { prNumber: 1, epoch: NOW_EPOCH - 50 * DAY },
      { prNumber: 2, epoch: NOW_EPOCH - 40 * DAY },
      { prNumber: 3, epoch: NOW_EPOCH - 20 * DAY },
      { prNumber: 4, epoch: NOW_EPOCH - 10 * DAY },
      { prNumber: 5, epoch: NOW_EPOCH - 1 * DAY },
    ]);
    return { repo, shas };
  }

  it('a missing cursor SHA falls back to the bootstrap window with CURSOR_RESET', () => {
    const { repo } = repoWithWindowSplit();
    const dataDir = tempDataDir();
    writeState(dataDir, {
      schema_version: 'arbiter_shadow_state/v1',
      repo: 'o/r',
      last_seen_merge_sha: 'f'.repeat(40),
      last_run_at: now().toISOString(),
      last_run_status: 'ok',
      last_error_code: null,
      scorer_id: 'baseline-v0',
      scorer_version: '0.1.0',
    });

    const result = runShadowScore(baseOptions(repo, dataDir));

    expect(result.scored).toBe(3); // PRs 3, 4, 5: within 30 days
    expect(readScores(dataDir).map((r) => r.pr_number)).toEqual([3, 4, 5]);
    expect(readStateFile(dataDir).last_error_code).toBe('CURSOR_RESET');
  });

  it('a null cursor (first run) bootstraps with status ok and no error code', () => {
    const { repo } = repoWithWindowSplit();
    const dataDir = tempDataDir();

    const result = runShadowScore(baseOptions(repo, dataDir));

    expect(result.scored).toBe(3);
    expect(result.status).toBe('ok');
    const state = readStateFile(dataDir);
    expect(state.last_run_status).toBe('ok');
    expect(state.last_error_code).toBeNull();
  });

  it('a cursor on a non-ancestor branch resets like a missing SHA', () => {
    const { repo } = repoWithWindowSplit();
    // Commit on a side branch that is not an ancestor of the integration tip.
    repo.runGit(['checkout', '--quiet', '-b', 'side', 'HEAD~3']);
    repo.runGit(['commit', '--quiet', '--allow-empty', '-m', 'side commit']);
    const sideSha = repo.runGit(['rev-parse', 'HEAD']).stdout.trim();
    repo.runGit(['checkout', '--quiet', 'auto/integration']);

    const dataDir = tempDataDir();
    writeState(dataDir, {
      schema_version: 'arbiter_shadow_state/v1',
      repo: 'o/r',
      last_seen_merge_sha: sideSha,
      last_run_at: now().toISOString(),
      last_run_status: 'ok',
      last_error_code: null,
      scorer_id: 'baseline-v0',
      scorer_version: '0.1.0',
    });

    const result = runShadowScore(baseOptions(repo, dataDir));
    expect(result.scored).toBe(3);
    expect(readStateFile(dataDir).last_error_code).toBe('CURSOR_RESET');
  });
});

describe('runShadowScore per-run cap (REQ-F4)', () => {
  it('caps each run at maxPrs and continues without duplicates', () => {
    const repo = fixture();
    repo.addMerges(
      Array.from({ length: 7 }, (_, i) => ({ prNumber: i + 1, epoch: NOW_EPOCH - (8 - i) * DAY })),
    );
    const dataDir = tempDataDir();
    const opts = { ...baseOptions(repo, dataDir), maxPrs: 3, bootstrapDays: 365 };

    const counts = [runShadowScore(opts).scored, runShadowScore(opts).scored, runShadowScore(opts).scored];
    // The first bootstrap-window run also sees the initial commit.
    expect(counts).toEqual([3, 3, 2]);

    const rows = readScores(dataDir);
    const shas = rows.map((r) => r.merge_sha);
    expect(new Set(shas).size).toBe(8);
    expect(rows.slice(1).map((r) => r.pr_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // Nothing left: a fourth run scores 0.
    expect(runShadowScore(opts).scored).toBe(0);
  });

  it(
    'scores 200 merges in under 60 seconds (NFR)',
    { timeout: 60_000 },
    () => {
      const repo = fixture();
      repo.addMerges(
        Array.from({ length: 200 }, (_, i) => ({
          prNumber: i + 1,
          epoch: NOW_EPOCH - (250 - i) * 3600,
          squash: true,
        })),
      );
      const dataDir = tempDataDir();

      const started = Date.now();
      const result = runShadowScore({ ...baseOptions(repo, dataDir), maxPrs: 200, bootstrapDays: 365 });
      const elapsedMs = Date.now() - started;

      expect(result.scored).toBeGreaterThanOrEqual(200);
      expect(elapsedMs).toBeLessThan(60_000);
    },
  );

  it('an extractor throw skips that PR, sets partial, and still advances the cursor', () => {
    const repo = fixture();
    const shas = repo.addMerges([
      { prNumber: 1, epoch: NOW_EPOCH - 3 * DAY },
      { prNumber: 2, epoch: NOW_EPOCH - 2 * DAY },
      { prNumber: 3, epoch: NOW_EPOCH - 1 * DAY },
    ]);
    const dataDir = tempDataDir();
    writeState(dataDir, {
      schema_version: 'arbiter_shadow_state/v1',
      repo: 'o/r',
      last_seen_merge_sha: repo.runGit(['rev-parse', `${shas[0]}~1`]).stdout.trim(),
      last_run_at: now().toISOString(),
      last_run_status: 'ok',
      last_error_code: null,
      scorer_id: 'baseline-v0',
      scorer_version: '0.1.0',
    });

    const logs: string[] = [];
    let calls = 0;
    const result = runShadowScore({
      ...baseOptions(repo, dataDir),
      log: (line) => logs.push(line),
      extract: (options) => {
        calls++;
        if (calls === 2) throw new Error('boom');
        return extractCandidateFeatures(options);
      },
    });

    expect(result.scored).toBe(2);
    expect(result.status).toBe('partial');
    expect(result.cursor_after).toBe(shas[2]);
    expect(readScores(dataDir).map((r) => r.pr_number)).toEqual([1, 3]);
    expect(logs.some((l) => l.startsWith('SHADOW_SKIP pr=2 code=EXTRACT_FAILED'))).toBe(true);
  });
});
