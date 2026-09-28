/**
 * Shadow backfill tests (REQ-F5): maturity horizon, idempotency, per-PR
 * failure isolation with retry, missing-label persistence, unlabellable rows.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ArbiterShadowOutcomeV1 } from '@hokusai/core';
import { validateShadowOutcomeRow, validateShadowScoreRow } from '@hokusai/core';
import type { MergedPrRef, SurvivalLabellerDeps, SurvivalLabellerTarget } from '../survival-labeller.js';
import { createOfflineGitHubClient } from '../default-deps.js';
import { runShadowBackfill, type RunShadowBackfillOptions } from './backfill.js';
import { appendJsonl } from './store.js';
import { fakeSha, scoreRow, stubLabel } from './test-rows.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const now = (): Date => NOW;
const DAY = 86400 * 1000;

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-backfill-'));
  cleanups.push(dir);
  return dir;
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

function readOutcomes(dataDir: string): ArbiterShadowOutcomeV1[] {
  const file = join(dataDir, 'outcomes.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ArbiterShadowOutcomeV1);
}

const target: SurvivalLabellerTarget = {
  owner: 'o',
  repo: 'r',
  integrationBranch: 'auto/integration',
  repoDir: '/nonexistent-not-used-by-stubs',
};

const deps: SurvivalLabellerDeps = {
  runGit: () => ({ stdout: '', stderr: '', exitCode: 1 }),
  github: createOfflineGitHubClient(),
  now,
};

function prRef(prNumber: number, sha: string): MergedPrRef {
  return {
    prNumber,
    prUrl: `https://github.com/o/r/pull/${prNumber}`,
    mergeSha: sha,
    parentSha: fakeSha(999),
    headSha: fakeSha(998),
    mergedAtEpoch: 0,
    subject: '',
  };
}

function options(
  dataDir: string,
  overrides: Partial<RunShadowBackfillOptions> = {},
): RunShadowBackfillOptions {
  return {
    dataDir,
    horizonDays: 30,
    target,
    deps,
    now,
    log: () => {},
    ...overrides,
  };
}

describe('runShadowBackfill (REQ-F5)', () => {
  it('labels matured PRs only, and a re-run appends nothing', () => {
    const dataDir = tempDataDir();
    appendJsonl(
      join(dataDir, 'scores.jsonl'),
      [
        scoreRow(1, { mergedAt: daysAgo(40) }),
        scoreRow(2, { mergedAt: daysAgo(35) }),
        scoreRow(3, { mergedAt: daysAgo(10) }),
      ],
      validateShadowScoreRow,
    );

    const enumerate = () => [prRef(1, fakeSha(1)), prRef(2, fakeSha(2)), prRef(3, fakeSha(3))];
    const label: RunShadowBackfillOptions['label'] = (_t, _d, pr) => [
      stubLabel(pr.mergeSha, pr.prNumber, pr.prNumber === 1),
    ];

    const result = runShadowBackfill(options(dataDir, { enumerate, label }));

    expect(result.labelled).toBe(2);
    expect(result.pending).toBe(1);
    const rows = readOutcomes(dataDir);
    expect(rows.map((r) => [r.pr_number, r.survived])).toEqual([
      [1, true],
      [2, false],
    ]);
    for (const row of rows) {
      expect(validateShadowOutcomeRow(row).ok).toBe(true);
      // D4 privacy: the embedded label carries no line_ranges.
      expect('line_ranges' in row.label).toBe(false);
    }

    const rerun = runShadowBackfill(options(dataDir, { enumerate, label }));
    expect(rerun.labelled).toBe(0);
    expect(readOutcomes(dataDir)).toHaveLength(2);
  });

  it('counts exactly merged_at + horizon == now as mature (inclusive)', () => {
    const dataDir = tempDataDir();
    appendJsonl(
      join(dataDir, 'scores.jsonl'),
      [scoreRow(1, { mergedAt: daysAgo(30) })],
      validateShadowScoreRow,
    );

    const result = runShadowBackfill(
      options(dataDir, {
        enumerate: () => [prRef(1, fakeSha(1))],
        label: (_t, _d, pr) => [stubLabel(pr.mergeSha, pr.prNumber, true)],
      }),
    );
    expect(result.labelled).toBe(1);
  });

  it('a labeller throw skips that PR and it is retried on the next run', () => {
    const dataDir = tempDataDir();
    appendJsonl(
      join(dataDir, 'scores.jsonl'),
      [scoreRow(1, { mergedAt: daysAgo(40) }), scoreRow(2, { mergedAt: daysAgo(40) })],
      validateShadowScoreRow,
    );
    const enumerate = () => [prRef(1, fakeSha(1)), prRef(2, fakeSha(2))];

    const logs: string[] = [];
    const throwing: RunShadowBackfillOptions['label'] = (_t, _d, pr) => {
      if (pr.prNumber === 1) throw new Error('boom');
      return [stubLabel(pr.mergeSha, pr.prNumber, true)];
    };
    const first = runShadowBackfill(
      options(dataDir, { enumerate, label: throwing, log: (l) => logs.push(l) }),
    );
    expect(first.labelled).toBe(1);
    expect(first.skipped).toBe(1);
    expect(logs.some((l) => l.startsWith('SHADOW_SKIP pr=1 code=LABEL_FAILED'))).toBe(true);

    const second = runShadowBackfill(
      options(dataDir, {
        enumerate,
        label: (_t, _d, pr) => [stubLabel(pr.mergeSha, pr.prNumber, true)],
      }),
    );
    expect(second.labelled).toBe(1);
    expect(readOutcomes(dataDir).map((r) => r.pr_number).sort()).toEqual([1, 2]);
  });

  it('missing_horizon gives no row (retried later); other missing labels persist survived: null', () => {
    const dataDir = tempDataDir();
    appendJsonl(
      join(dataDir, 'scores.jsonl'),
      [scoreRow(1, { mergedAt: daysAgo(40) }), scoreRow(2, { mergedAt: daysAgo(40) })],
      validateShadowScoreRow,
    );

    const result = runShadowBackfill(
      options(dataDir, {
        enumerate: () => [prRef(1, fakeSha(1)), prRef(2, fakeSha(2))],
        label: (_t, _d, pr) =>
          pr.prNumber === 1
            ? [stubLabel(pr.mergeSha, pr.prNumber, null, ['missing_horizon'])]
            : [stubLabel(pr.mergeSha, pr.prNumber, null, ['inaccessible_history'])],
      }),
    );

    expect(result.labelled).toBe(1);
    expect(result.pending).toBe(1);
    const rows = readOutcomes(dataDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pr_number).toBe(2);
    expect(rows[0]?.survived).toBeNull();
  });

  it('null-PR score rows are unlabellable and PRs missing from the enumeration are skipped', () => {
    const dataDir = tempDataDir();
    appendJsonl(
      join(dataDir, 'scores.jsonl'),
      [
        scoreRow(1, { prNumber: null, mergedAt: daysAgo(40) }),
        scoreRow(2, { mergedAt: daysAgo(40) }),
      ],
      validateShadowScoreRow,
    );

    const result = runShadowBackfill(
      options(dataDir, {
        enumerate: () => [],
        label: () => [],
      }),
    );
    expect(result.unlabellable).toBe(1);
    expect(result.skipped).toBe(1);
    expect(readOutcomes(dataDir)).toHaveLength(0);
  });
});
