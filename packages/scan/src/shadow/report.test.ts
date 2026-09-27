/**
 * Shadow report tests (REQ-F6): metric definitions, null-on-zero-denominator
 * semantics, the 19-entry threshold sweep, file/stdout parity, and malformed
 * JSONL accounting.
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ArbiterShadowOutcomeV1, ArbiterShadowScoreV1 } from '@hokusai/core';
import { validateShadowOutcomeRow, validateShadowScoreRow } from '@hokusai/core';
import { computeShadowReport, runShadowReport } from './report.js';
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
  const dir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-report-'));
  cleanups.push(dir);
  return dir;
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

function outcomeRow(n: number, survived: boolean | null): ArbiterShadowOutcomeV1 {
  return {
    schema_version: 'arbiter_shadow_outcome/v1',
    repo: 'o/r',
    pr_number: n,
    merge_sha: fakeSha(n),
    horizon_days: 30,
    labelled_at: NOW.toISOString(),
    survived,
    label: Object.fromEntries(
      Object.entries(stubLabel(fakeSha(n), n, survived)).filter(([key]) => key !== 'line_ranges'),
    ) as ArbiterShadowOutcomeV1['label'],
  };
}

/**
 * REQ-F6 fixture: 10 scored in window, 4 flagged (score 0.4 < threshold
 * 0.5), 8 matured. Among matured: flagged ∧ ¬survived = 3, flagged ∧
 * survived = 1, survived total = 6.
 */
function req6Fixture(): { scores: ArbiterShadowScoreV1[]; outcomes: ArbiterShadowOutcomeV1[] } {
  const scores: ArbiterShadowScoreV1[] = [];
  const outcomes: ArbiterShadowOutcomeV1[] = [];
  // PRs 1-4 flagged. 1-3 matured & not survived; 4 matured & survived.
  for (let n = 1; n <= 4; n++) {
    scores.push(scoreRow(n, { mergedAt: daysAgo(15), score: 0.4 }));
    outcomes.push(outcomeRow(n, n <= 3 ? false : true));
  }
  // PRs 5-8 unflagged, matured, survived (survived total = 6 with PR 4... adjust: 5 survived here).
  for (let n = 5; n <= 8; n++) {
    scores.push(scoreRow(n, { mergedAt: daysAgo(15), score: 0.9 }));
    outcomes.push(outcomeRow(n, true));
  }
  // PRs 9-10 unflagged, not matured.
  for (let n = 9; n <= 10; n++) {
    scores.push(scoreRow(n, { mergedAt: daysAgo(15), score: 0.9 }));
  }
  return { scores, outcomes };
}

describe('computeShadowReport (REQ-F6)', () => {
  it('computes the fixture metrics', () => {
    const { scores, outcomes } = req6Fixture();
    // survived ∧ matured = PR4 + PRs 5-8 = 5; REQ-F6 wants 6, so mark one
    // more: flip PR3 to survived? No — REQ-F6: flagged∧¬survived = 3 needs
    // PRs 1-3 not survived. Add survived via an extra matured unflagged PR
    // by maturing PR9.
    outcomes.push(outcomeRow(9, true));

    const report = computeShadowReport(scores, outcomes, {
      windowDays: 30,
      horizonDays: 30,
      now,
    });

    expect(report.repos).toHaveLength(1);
    const repo = report.repos[0];
    expect(repo).toBeDefined();
    if (!repo) return;
    expect(repo.n_scored).toBe(10);
    expect(repo.n_matured).toBe(9);
    expect(repo.n_flagged).toBe(4);
    expect(repo.would_flag_rate).toBe(0.4);
    expect(repo.precision).toBe(0.75); // 3 / 4
    expect(repo.false_positive_rate).toBe(0.1667); // 1 / 6
    expect(repo.base_survival_rate).toBe(0.6667); // 6 / 9
    expect(repo.scorer_id).toBe('baseline-v0');
    expect(repo.scorer_version).toBe('0.1.0');

    expect(repo.threshold_sweep).toHaveLength(19);
    expect(repo.threshold_sweep[0]?.threshold).toBe(0.05);
    expect(repo.threshold_sweep[18]?.threshold).toBe(0.95);
    // At threshold 0.95, everything (0.4 and 0.9 scores) is flagged.
    expect(repo.threshold_sweep[18]?.would_flag_count).toBe(10);
  });

  it('reports null ratios when nothing has matured, but still the flag rate', () => {
    const scores = [
      scoreRow(1, { mergedAt: daysAgo(5), score: 0.4 }),
      scoreRow(2, { mergedAt: daysAgo(5), score: 0.9 }),
    ];
    const report = computeShadowReport(scores, [], { windowDays: 30, horizonDays: 30, now });
    const repo = report.repos[0];
    expect(repo?.n_matured).toBe(0);
    expect(repo?.would_flag_rate).toBe(0.5);
    expect(repo?.precision).toBeNull();
    expect(repo?.false_positive_rate).toBeNull();
    expect(repo?.base_survival_rate).toBeNull();
  });

  it('a would-flag rate of exactly 0 is reported as 0, not null', () => {
    const scores = [scoreRow(1, { mergedAt: daysAgo(5), score: 0.9 })];
    const report = computeShadowReport(scores, [], { windowDays: 30, horizonDays: 30, now });
    expect(report.repos[0]?.would_flag_rate).toBe(0);
  });

  it('outcomes with survived: null count as unlabelled, not matured', () => {
    const scores = [scoreRow(1, { mergedAt: daysAgo(15), score: 0.4 })];
    const outcomes = [outcomeRow(1, null)];
    const report = computeShadowReport(scores, outcomes, { windowDays: 30, horizonDays: 30, now });
    const repo = report.repos[0];
    expect(repo?.n_matured).toBe(0);
    expect(repo?.n_unlabelled).toBe(1);
    expect(repo?.precision).toBeNull();
  });

  it('flags mixed-scorer windows and reports the most frequent pair', () => {
    const scores = [
      scoreRow(1, { mergedAt: daysAgo(5), score: 0.9 }),
      scoreRow(2, { mergedAt: daysAgo(5), score: 0.9 }),
      { ...scoreRow(3, { mergedAt: daysAgo(5), score: 0.9 }), scorer_id: 'model-a', scorer_version: '1.0.0' },
    ];
    const report = computeShadowReport(scores, [], { windowDays: 30, horizonDays: 30, now });
    const repo = report.repos[0];
    expect(repo?.scorer_mixed).toBe(true);
    expect(repo?.scorer_id).toBe('baseline-v0');
    expect(repo?.scorer_version).toBe('0.1.0');
  });

  it('a single-scorer window is not flagged as mixed', () => {
    const scores = [scoreRow(1, { mergedAt: daysAgo(5), score: 0.9 })];
    const report = computeShadowReport(scores, [], { windowDays: 30, horizonDays: 30, now });
    expect(report.repos[0]?.scorer_mixed).toBe(false);
  });

  it('scores outside the window are excluded', () => {
    const scores = [
      scoreRow(1, { mergedAt: daysAgo(45), score: 0.4 }),
      scoreRow(2, { mergedAt: daysAgo(5), score: 0.9 }),
    ];
    const report = computeShadowReport(scores, [], { windowDays: 30, horizonDays: 30, now });
    expect(report.repos[0]?.n_scored).toBe(1);
  });
});

describe('runShadowReport IO (REQ-F6)', () => {
  it('writes reports/<date>.json matching stdout, and counts malformed lines', () => {
    const dataDir = tempDataDir();
    appendJsonl(
      join(dataDir, 'scores.jsonl'),
      [scoreRow(1, { mergedAt: daysAgo(5), score: 0.4 })],
      validateShadowScoreRow,
    );
    appendFileSync(join(dataDir, 'scores.jsonl'), '{bad json\n');
    appendJsonl(join(dataDir, 'outcomes.jsonl'), [outcomeRow(1, true)], validateShadowOutcomeRow);

    const lines: string[] = [];
    runShadowReport({ dataDir, windowDays: 30, horizonDays: 30, now, log: (l) => lines.push(l) });

    const file = readFileSync(join(dataDir, 'reports/2026-09-01.json'), 'utf-8');
    expect(lines.join('\n')).toBe(file);
    const parsed = JSON.parse(file) as { malformed_lines: { scores: number; outcomes: number } };
    expect(parsed.malformed_lines).toEqual({ scores: 1, outcomes: 0 });
  });

  it('an empty data dir reports zero scored and exits cleanly', () => {
    const dataDir = tempDataDir();
    writeFileSync(join(dataDir, 'scores.jsonl'), '');
    const lines: string[] = [];
    const report = runShadowReport({
      dataDir,
      windowDays: 30,
      horizonDays: 30,
      now,
      log: (l) => lines.push(l),
    });
    expect(report.repos).toHaveLength(0);
  });
});
