import { describe, expect, it } from 'vitest';
import { validateArbiterReportV1, type ArbiterReportV1 } from '@hokusai/core';
import { buildReportDraft, emitReport } from './build.js';
import { katzLogRatioInterval, nearestRankQuartiles, quartileOf, wilsonInterval } from './stats.js';

const input = (rows: ArbiterReportV1['prs']) => ({ owner: 'sample', repo: 'example', integrationBranch: 'master', asOf: new Date('2026-10-16T00:00:00Z'), lookbackDays: 180, mergedFrom: new Date('2026-04-19T00:00:00Z'), horizons: [30] as [30], rows, scannerVersion: '0.4.0' });
const row = (n: number, testsChanged: boolean): ArbiterReportV1['prs'][number] => ({
  pr_number: n, merged_at: '2026-05-01T00:00:00Z',
  attribution: { agent: { status: 'unknown', confidence: null, methods: [] }, harness: { id: null, confidence: null, methods: [] }, exact_model: { id: null, confidence: null, methods: [], evidence: null } },
  features: { schema_version: 'candidate_features/v1', files_touched: 1, lines_added: 1, lines_deleted: 0, loc_touched: n, dependency_depth: null, module_hotspot_score: null, diff_uncertain: false, type_errors: null, lint_errors: null, build_ok: null, complexity_delta: null, tests_changed: testsChanged, test_pass_rate: null, test_runtime_seconds: null, task_type: null, language: null, domain: null, complexity: null, repo_size_bucket: null, files_touched_bucket: '1', description_length_bucket: null, is_greenfield: null, is_migration: null, requires_tests: null, cross_service: null, ui_heavy: null, risk_level: null, touched_out_of_scope_files: null, human_intervention_count: null, review_rounds: null, change_requests: null, self_review_iterations: null, agent_iterations: null },
  labels: [{ horizon_days: 30, label_provenance: 'harvested', outcome: { survived: true, survival_ratio: 1, reverted: false, undone_by: null, followup: false, report_outcome: 'survived', reason_codes: ['no_evidence'] }, label_hash: 'a'.repeat(64) }], cost: null, prediction: null,
});

describe('report aggregation', () => {
  it('validates an empty scan', () => {
    const report = emitReport(buildReportDraft(input([]))).report;
    expect(validateArbiterReportV1(report).ok).toBe(true);
  });
  it('suppresses at n=19 and shows at n=20', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, i < 19));
    const report = emitReport(buildReportDraft(input(rows))).report;
    const thin = report.aggregates.risk_ratios.rows.find((r) => r.feature === 'tests_changed' && r.bucket === 'true')!;
    expect(thin.rework_rate.n).toBe(19);
    expect(thin.rework_rate.suppressed).toBe(true);
    expect(thin.ratio.suppressed).toBe(true);
    const balanced = emitReport(buildReportDraft(input(Array.from({ length: 40 }, (_, i) => row(i + 1, i < 20))))).report;
    const shown = balanced.aggregates.risk_ratios.rows.find((r) => r.feature === 'tests_changed' && r.bucket === 'true')!;
    expect(shown.rework_rate.n).toBe(20);
    expect(shown.rework_rate.suppressed).toBe(false);
    expect(shown.ratio.suppressed).toBe(false);
    expect(validateArbiterReportV1(balanced).ok).toBe(true);
  });
  it('computes stable intervals and quartiles', () => {
    expect(wilsonInterval(5, 10)).toEqual({ low: 0.2366, high: 0.7634 });
    expect(katzLogRatioInterval(0, 20, 10, 20)?.ratio).toBeGreaterThan(0);
    expect(quartileOf(1, nearestRankQuartiles([1, 1, 1, 1])!)).toBe('q1');
  });
});
