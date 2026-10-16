import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readScanState, scanConfigHash, writeScanState, type ScanStateRow, type ScanStateVersions } from './state.js';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
const tempDirs: string[] = [];
const dir = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-state-')); tempDirs.push(value); return value; };
const versions: ScanStateVersions = { scannerVersion: '1.0.0', labellerVersion: '1.0.0', normalizationVersion: '1.0.0', integrationBranch: 'develop', config: { horizons: [14, 30] } };
afterEach(() => { for (const value of tempDirs.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });
describe('local report state', () => {
  it('hashes config deterministically and invalidates version/config/ref changes', () => {
    expect(scanConfigHash({ b: 2, a: 1 })).toBe(scanConfigHash({ a: 1, b: 2 }));
    const root = dir(); writeScanState(root, versions, null, []);
    expect(readScanState(root, versions, () => true).invalidated).toBe(false);
    expect(readScanState(root, { ...versions, scannerVersion: '2.0.0' }, () => true).invalidated).toBe(true);
    const source = reportDraftFixtures.full().prs[0]!;
    const row: ScanStateRow = { merge_sha: 'a'.repeat(40), pr_number: source.pr_number, merged_at: source.merged_at, attribution: source.attribution, features: source.features, labels_by_horizon: Object.fromEntries(source.labels.map((label) => [String(label.horizon_days), label])) };
    writeScanState(root, versions, row.merge_sha, [row]);
    expect(readScanState(root, versions, () => false).invalidated).toBe(true);
  });
  it('recovers from corrupt state and does not write raw metadata fields', () => {
    const root = dir(); writeScanState(root, versions, null, []);
    fs.writeFileSync(path.join(root, 'state.json'), '{');
    expect(readScanState(root, versions, () => true)).toMatchObject({ invalidated: true, rows: [] });
    writeScanState(root, versions, null, []);
    const bytes = fs.readFileSync(path.join(root, 'prs.jsonl'), 'utf8');
    expect(bytes).not.toMatch(/title|body|author|branch|sha/i);
  });
});
