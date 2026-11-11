/**
 * `corpus-corrective-derive` (HOK-3269): corrective rows under another
 * definition, from the repair pairs `corpus-corrective` already wrote.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ArbiterSurvivalLabelV1, CorrectiveReworkLabelV1 } from '@hokusai/core';
import { harvestedSurvivalLabelFixture } from '../../../core/src/fixtures/arbiter-survival-label.js';
import { readGzipJsonlMembers, runCorpusCli, writeJsonl } from './cli.js';

const url = (n: number) => `https://github.com/o/r/pull/${n}`;
const DAY = 86_400;

function s2(n: number, outcome: ArbiterSurvivalLabelV1['outcome']['report_outcome'] = 'survived'): ArbiterSurvivalLabelV1 {
  return { ...harvestedSurvivalLabelFixture, prUrl: url(n), horizon_days: 30, outcome: { ...harvestedSurvivalLabelFixture.outcome, report_outcome: outcome } };
}

function pair(n: number, proxy: 'revert' | 'repair_reference' | 'szz' | 'regression_issue', id: string) {
  return { candidate_id: id.repeat(64), lag_seconds: 5 * DAY, proxy, confidence: proxy === 'revert' || proxy === 'repair_reference' ? 'high' : 'medium', original: { pr_url: url(n) } };
}

describe('corpus-corrective-derive', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  function corpus() {
    const dir = mkdtempSync(join(tmpdir(), 'corrective-derive-'));
    dirs.push(dir);
    const repoDir = join(dir, 'cache', 'o__r');
    mkdirSync(repoDir, { recursive: true });
    const envelope = { schema_version: '1.1.0', definition_version: 'cr-0.1.0', labeller_version: '1.0.0', integration_branch: 'main', as_of: '2026-10-20T00:00:00Z', computed_at: '2026-10-28T00:00:00Z' };
    // #1 reverted, #2 linked only by SZZ, #3 by SZZ and a repair reference, #4 clean, #5 no base label.
    writeJsonl(join(repoDir, 's2.jsonl.gz'), [s2(1), s2(2), s2(3), s2(4), s2(5, null)], { gzip: true });
    writeJsonl(join(repoDir, 'repair_pairs.jsonl.gz'), [pair(1, 'revert', 'a'), pair(2, 'szz', 'b'), pair(3, 'szz', 'c'), pair(3, 'repair_reference', 'd')], { gzip: true });
    writeJsonl(join(repoDir, 'corrective.jsonl.gz'), [{ prUrl: url(1), horizon_days: 30, envelope }], { gzip: true });
    const manifest = { manifest_version: '0.1.0', window: { merged_from: '2025-01-01', merged_until: '2025-06-01' }, repos: [{ repo: 'o/r', status: 'kept', observed_merge_convention: 'squash' }], alternates: [] };
    writeFileSync(join(dir, 'cohort.json'), JSON.stringify(manifest));
    return { dir, repoDir };
  }

  const run = (dir: string, definition?: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const args = ['--manifest', 'cohort.json', '--cache-dir', 'cache', ...(definition ? ['--definition', definition] : [])];
    const { exitCode } = runCorpusCli('corpus-corrective-derive', args, { cwd: dir, writeStdout: (t) => out.push(t), writeStderr: (t) => err.push(t) });
    return { exitCode, out: out.join(''), err: err.join('') };
  };

  it('writes cr-0.2.0 rows that drop SZZ-only positives and keep the default envelope otherwise', () => {
    const { dir, repoDir } = corpus();
    expect(run(dir, 'cr-0.2.0').exitCode).toBe(0);
    const rows = [...readGzipJsonlMembers<CorrectiveReworkLabelV1>(join(repoDir, 'corrective.cr-0.2.0.jsonl.gz'))];
    expect(rows.map((r) => [r.prUrl.split('/').pop(), r.corrective, r.reason_codes])).toEqual([
      ['1', true, ['revert']],
      ['2', false, ['no_accepted_fix']],
      ['3', true, ['repair_reference']],
      ['4', false, ['no_accepted_fix']],
      ['5', null, ['base_label_missing']],
    ]);
    const envelope = rows[0]!.envelope;
    expect(envelope).toMatchObject({ definition_version: 'cr-0.2.0', labeller_version: '1.0.0', integration_branch: 'main', as_of: '2026-10-20T00:00:00Z' });
    const summary = JSON.parse(readFileSync(join(repoDir, 'corrective.cr-0.2.0.summary.json'), 'utf8'));
    expect(summary.corrective_by_horizon['30']).toEqual({ rows: 5, true: 2, false: 2, null: 1, true_share: 0.5 });
    // The default rows are left alone.
    expect([...readGzipJsonlMembers<CorrectiveReworkLabelV1>(join(repoDir, 'corrective.jsonl.gz'))]).toHaveLength(1);
  });

  it('refuses an unknown definition, a missing one and the default', () => {
    const { dir } = corpus();
    expect(run(dir).exitCode).toBe(2);
    expect(run(dir, 'cr-9.9.9').exitCode).toBe(2);
    const fresh = run(dir, 'cr-0.1.0');
    expect(fresh.exitCode).toBe(2);
    expect(fresh.err).toContain('default definition');
  });
});
