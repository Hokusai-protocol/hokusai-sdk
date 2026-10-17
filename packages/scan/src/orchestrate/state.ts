import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArbiterReportV1 } from '@hokusai/core';
import type { GitRunner } from '../survival-labeller.js';
import { isAncestor } from '../shadow/discover.js';

type Row = ArbiterReportV1['prs'][number];
export interface CachedPr { merge_sha: string; row: Row }
export interface ScanState {
  state_version: 1;
  scanner_version: string;
  labeller_version: string;
  normalization_version: string;
  config_hash: string;
  integration_branch: string;
  last_seen_merge_sha: string;
}
export function configHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isCachedPr(value: unknown): value is CachedPr {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CachedPr>;
  const row = entry.row;
  return /^[0-9a-f]{40}$/.test(entry.merge_sha ?? '')
    && !!row
    && Number.isInteger(row.pr_number)
    && row.pr_number > 0
    && typeof row.merged_at === 'string'
    && Number.isFinite(Date.parse(row.merged_at))
    && !!row.attribution && typeof row.attribution === 'object'
    && !!row.features && typeof row.features === 'object'
    && Array.isArray(row.labels)
    && Object.hasOwn(row, 'cost')
    && Object.hasOwn(row, 'prediction');
}
export function readScanState(dir: string, expected: Omit<ScanState, 'state_version' | 'last_seen_merge_sha'>, runGit: GitRunner): { state: ScanState; prs: CachedPr[] } | null {
  if (!existsSync(join(dir, 'state.json')) || !existsSync(join(dir, 'prs.jsonl'))) return null;
  try {
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as ScanState;
    if (state.state_version !== 1 || !Object.entries(expected).every(([key, value]) => state[key as keyof ScanState] === value) || !/^[0-9a-f]{40}$/.test(state.last_seen_merge_sha) || !isAncestor(runGit, state.last_seen_merge_sha, expected.integration_branch)) return null;
    const prs = readFileSync(join(dir, 'prs.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CachedPr);
    if (!prs.every(isCachedPr)) return null;
    return { state, prs };
  } catch { return null; }
}
export function writeScanState(dir: string, state: ScanState, prs: readonly CachedPr[]): void {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, content: string): void => { const temp = join(dir, `${name}.tmp-${randomUUID()}`); writeFileSync(temp, content, { mode: 0o600 }); renameSync(temp, join(dir, name)); };
  write('prs.jsonl', prs.map((entry) => JSON.stringify(entry)).join('\n') + (prs.length ? '\n' : ''));
  write('state.json', `${JSON.stringify(state)}\n`);
}
