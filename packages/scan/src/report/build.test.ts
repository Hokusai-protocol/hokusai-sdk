import { describe, expect, it } from 'vitest';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
import { buildReportDraft, emitReport } from './build.js';

describe('report builder', () => {
  it('emits deterministic schema-valid canonical JSON', () => {
    const fixture = reportDraftFixtures.full();
    const horizons = [...new Set(fixture.prs.flatMap((pr) => pr.labels.map((label) => label.horizon_days)))].sort((a, b) => a - b);
    const input = {
      owner: 'example', repo: 'repo', integrationBranch: 'develop', scannerVersion: '1.0.0',
      scannedAt: '2026-10-16T00:00:00Z', asOf: '2026-10-16T00:00:00Z', lookbackDays: 180,
      mergedFrom: '2026-04-19T00:00:00Z', mergedTo: '2026-10-16T00:00:00Z', horizons, prs: fixture.prs,
    };
    const first = emitReport(buildReportDraft(input));
    expect(first).toBe(emitReport(buildReportDraft(input)));
    expect(JSON.parse(first).data_origin).toBe('scan');
  });
});
