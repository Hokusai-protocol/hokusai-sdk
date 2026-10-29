import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { execArgvCommand } from '../shell-utils.js';
import { GIT_OUTPUT_MAX_BUFFER, type GitRunner } from '../survival-labeller.js';
import type { SampleItem } from './calibration.js';
import { buildItemEvidence, EVIDENCE_DIFF_MAX_CHARS } from './calibration-evidence.js';
import type { CorpusPrRecord } from './enumerate.js';

const dir = mkdtempSync(join(tmpdir(), 'calibration-evidence-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sh = (args: string[], date: string) =>
  execFileSync('git', ['-C', dir, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, encoding: 'utf8' }).trim();
function commit(files: Record<string, string>, message: string, date: string): string {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  sh(['add', '-A'], date);
  sh(['commit', '-q', '-m', message], date);
  return sh(['rev-parse', 'HEAD'], date);
}

execFileSync('git', ['init', '-q', '-b', 'main', dir]);
const base = commit({ 'a.ts': 'one\n', 'b.ts': 'b\n' }, 'base', '2025-01-01T00:00:00Z');
const original = commit({ 'a.ts': 'one\ntwo\n' }, 'original', '2025-01-02T00:00:00Z');
const fix = commit({ 'a.ts': 'one\n2\n' }, 'fix', '2025-01-05T00:00:00Z');
const touch = commit({ 'a.ts': 'one\n2\nthree\n' }, 'later edit', '2025-01-10T00:00:00Z');
const unrelated = commit({ 'b.ts': 'bb\n' }, 'other file', '2025-01-11T00:00:00Z');
const tooLate = commit({ 'a.ts': 'one\n2\nthree\nfour\n' }, 'after the horizon', '2025-03-01T00:00:00Z');
const direct = commit({ 'a.ts': 'x'.repeat(EVIDENCE_DIFF_MAX_CHARS + 10) }, 'direct push', '2025-01-12T00:00:00Z');

const record = (n: number, from: string, to: string, mergedAt: string): CorpusPrRecord =>
  ({ pr_url: `https://github.com/o/r/pull/${n}`, title: `PR ${n}`, body: `body ${n}`, merged_at: mergedAt, base_sha: from, merge_sha: to, landed_sha: to, relanded_merge_shas: [] }) as unknown as CorpusPrRecord;
const prs = [
  record(1, base, original, '2025-01-02T00:00:00Z'),
  record(2, original, fix, '2025-01-05T00:00:00Z'),
  record(3, fix, touch, '2025-01-10T00:00:00Z'),
  record(4, touch, unrelated, '2025-01-11T00:00:00Z'),
  record(5, direct, tooLate, '2025-03-01T00:00:00Z'),
];
const context = { branch: 'main', horizonDays: 30, prs: new Map(prs.map((p) => [p.pr_url, p])), bySha: new Map(prs.map((p) => [p.merge_sha, p])) };
const runGit: GitRunner = (args) => execArgvCommand('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: GIT_OUTPUT_MAX_BUFFER });

const item = (fixUrls: string[]): SampleItem =>
  ({ item_id: 'i1', repo: 'o/r', pr_url: prs[0]!.pr_url, stratum: 'revert', proxies: ['revert'], candidates: fixUrls.map((fix_url) => ({ fix_url })), double: false, audit: true }) as unknown as SampleItem;

describe('buildItemEvidence', () => {
  it("gives the original's and each fix's text and diff", () => {
    const e = buildItemEvidence(item([prs[1]!.pr_url]), context, runGit);
    expect(e.original).toMatchObject({ title: 'PR 1', body: 'body 1', files: ['a.ts'], diff_truncated: false });
    expect(e.original.diff).toContain('+two');
    expect(e.fixes).toHaveLength(1);
    expect(e.fixes[0]!.diff).toContain('+2');
  });

  it('lists later PRs within the horizon that touched the original files, leaving out candidate fixes', () => {
    const e = buildItemEvidence(item([prs[1]!.pr_url]), context, runGit);
    expect(e.related.map((r) => r.url)).toEqual([prs[2]!.pr_url]);
  });

  it('reads a direct-push fix from its commit and marks a cut diff', () => {
    const e = buildItemEvidence(item([`https://github.com/o/r/commit/${direct}`]), context, runGit);
    expect(e.fixes[0]).toMatchObject({ title: null, diff_truncated: true });
    expect(e.fixes[0]!.diff).toContain('[diff truncated');
  });
});
