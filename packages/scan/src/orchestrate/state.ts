import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { HORIZONS, REASON_CODES, REPORT_ATTRIBUTION_METHODS, validateCandidateFeaturesV1, type ArbiterReportV1, type SurvivalLabelProjectionV1 } from '@hokusai/core';

export interface ScanStateHeader {
  state_version: 1; scanner_version: string; labeller_version: string; normalization_version: string;
  config_hash: string; integration_branch: string; last_seen_merge_sha: string | null;
}
export interface ScanStateRow {
  merge_sha: string; merged_at_epoch: number; pr_number: number; merged_at: string;
  attribution: ArbiterReportV1['prs'][number]['attribution'];
  features: ArbiterReportV1['prs'][number]['features'];
  labels_by_horizon: Record<string, SurvivalLabelProjectionV1>;
}
export interface ScanStateSnapshot { header: ScanStateHeader | null; rows: ScanStateRow[]; invalidated: boolean }
export interface ScanStateVersions { scannerVersion: string; labellerVersion: string; normalizationVersion: string; integrationBranch: string; config: unknown }

export function scanConfigHash(config: unknown): string {
  return createHash('sha256').update(stableJson(config)).digest('hex');
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') { const o = value as Record<string, unknown>; return `{${Object.keys(o).sort().map((key) => `${JSON.stringify(key)}:${stableJson(o[key])}`).join(',')}}`; }
  return JSON.stringify(value);
}
function atomicWrite(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try { fs.writeFileSync(temp, contents, { mode: 0o600 }); fs.renameSync(temp, file); }
  catch (error) { try { fs.unlinkSync(temp); } catch { /* best effort cleanup */ } throw error; }
}
function validHeader(value: unknown): value is ScanStateHeader {
  if (!value || typeof value !== 'object') return false;
  const h = value as Record<string, unknown>;
  return h.state_version === 1 && ['scanner_version', 'labeller_version', 'normalization_version', 'integration_branch'].every((key) => typeof h[key] === 'string') && typeof h.config_hash === 'string' && /^[0-9a-f]{64}$/.test(h.config_hash) && (h.last_seen_merge_sha === null || (typeof h.last_seen_merge_sha === 'string' && /^[0-9a-f]{40}$/.test(h.last_seen_merge_sha)));
}
function validRow(value: unknown): value is ScanStateRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return exactKeys(row, ['merge_sha', 'merged_at_epoch', 'pr_number', 'merged_at', 'attribution', 'features', 'labels_by_horizon'])
    && typeof row.merge_sha === 'string' && /^[0-9a-f]{40}$/.test(row.merge_sha)
    && Number.isInteger(row.merged_at_epoch) && (row.merged_at_epoch as number) >= 0
    && Number.isInteger(row.pr_number) && (row.pr_number as number) > 0 && typeof row.merged_at === 'string'
    && validAttribution(row.attribution) && validateCandidateFeaturesV1(row.features).ok
    && validLabelsByHorizon(row.labels_by_horizon);
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function validMethods(value: unknown): boolean { return Array.isArray(value) && value.every((method) => typeof method === 'string' && REPORT_ATTRIBUTION_METHODS.includes(method as typeof REPORT_ATTRIBUTION_METHODS[number])); }
function validDimension(value: unknown, status: readonly string[], ids: boolean, evidence = false): boolean {
  if (!object(value)) return false;
  const keys = evidence ? ['id', 'confidence', 'methods', 'evidence'] : ids ? ['id', 'confidence', 'methods'] : ['status', 'confidence', 'methods'];
  return exactKeys(value, keys) && (ids ? (typeof value.id === 'string' || value.id === null) : status.includes(value.status as string))
    && (typeof value.confidence === 'number' || value.confidence === null) && validMethods(value.methods)
    && (!evidence || value.evidence === 'first_party_executed' || value.evidence === 'heuristic' || value.evidence === null);
}
function validAttribution(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ['agent', 'harness', 'exact_model'])) return false;
  return validDimension(value.agent, ['agent', 'not_agent_signal', 'unknown'], false)
    && validDimension(value.harness, [], true) && validDimension(value.exact_model, [], true, true);
}
function validLabel(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ['horizon_days', 'label_provenance', 'outcome', 'label_hash']) || !HORIZONS.includes(value.horizon_days as typeof HORIZONS[number]) || (value.label_provenance !== 'harvested' && value.label_provenance !== 'owner_corrected') || typeof value.label_hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.label_hash) || !object(value.outcome)) return false;
  const outcome = value.outcome;
  return exactKeys(outcome, ['survived', 'survival_ratio', 'reverted', 'undone_by', 'followup', 'report_outcome', 'reason_codes'])
    && (typeof outcome.survived === 'boolean' || outcome.survived === null)
    && (typeof outcome.survival_ratio === 'number' || outcome.survival_ratio === null)
    && (typeof outcome.reverted === 'boolean' || outcome.reverted === null)
    && (outcome.undone_by === 'human' || outcome.undone_by === 'agent' || outcome.undone_by === null)
    && (typeof outcome.followup === 'boolean' || outcome.followup === null)
    && ['survived', 'followup', 'substantially_rewritten', 'reverted', null].includes(outcome.report_outcome as string | null)
    && Array.isArray(outcome.reason_codes) && outcome.reason_codes.every((code) => typeof code === 'string' && REASON_CODES.includes(code as typeof REASON_CODES[number]));
}
function validLabelsByHorizon(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([horizon, label]) => /^(14|30|60)$/.test(horizon) && validLabel(label) && String((label as Record<string, unknown>).horizon_days) === horizon);
}

/** Read local derived-only state; any schema/config/ref mismatch clears the cache. */
export function readScanState(dir: string, versions: ScanStateVersions, isAncestor: (sha: string) => boolean): ScanStateSnapshot {
  const statePath = path.join(dir, 'state.json');
  const rowsPath = path.join(dir, 'prs.jsonl');
  if (!fs.existsSync(statePath)) return { header: null, rows: [], invalidated: false };
  try {
    const header: unknown = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!validHeader(header)) throw new Error('invalid state header');
    const configHash = scanConfigHash(versions.config);
    const same = header.scanner_version === versions.scannerVersion && header.labeller_version === versions.labellerVersion && header.normalization_version === versions.normalizationVersion && header.integration_branch === versions.integrationBranch && header.config_hash === configHash;
    const ancestor = header.last_seen_merge_sha === null || isAncestor(header.last_seen_merge_sha);
    if (!same || !ancestor) return { header: null, rows: [], invalidated: true };
    const rows: ScanStateRow[] = [];
    if (fs.existsSync(rowsPath)) for (const line of fs.readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean)) { const row: unknown = JSON.parse(line); if (!validRow(row)) throw new Error('invalid cache row'); rows.push(row); }
    return { header, rows, invalidated: false };
  } catch {
    return { header: null, rows: [], invalidated: true };
  }
}
export function writeScanState(dir: string, versions: ScanStateVersions, lastSeenMergeSha: string | null, rows: readonly ScanStateRow[]): void {
  if (lastSeenMergeSha !== null && !/^[0-9a-f]{40}$/.test(lastSeenMergeSha)) throw new TypeError('Invalid merge cursor');
  if (!rows.every(validRow)) throw new TypeError('Invalid derived scan cache row');
  const header: ScanStateHeader = { state_version: 1, scanner_version: versions.scannerVersion, labeller_version: versions.labellerVersion, normalization_version: versions.normalizationVersion, config_hash: scanConfigHash(versions.config), integration_branch: versions.integrationBranch, last_seen_merge_sha: lastSeenMergeSha };
  atomicWrite(path.join(dir, 'prs.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  atomicWrite(path.join(dir, 'state.json'), `${JSON.stringify(header, null, 2)}\n`);
}
