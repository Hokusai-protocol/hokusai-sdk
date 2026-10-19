import { describe, expect, it } from 'vitest';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
import { buildAggregates, buildCoverage } from './aggregate.js';

describe('report aggregation', () => {
  it('builds deterministic descriptive cells, coverage, and empty bucket rows', () => {
    const source = reportDraftFixtures.full().prs[0]!;
    const prs = Array.from({ length: 20 }, (_, i) => ({
      ...structuredClone(source), pr_number: i + 1,
      labels: source.labels.map((label) => ({ ...label, outcome: { ...label.outcome, report_outcome: i < 5 ? 'reverted' as const : 'survived' as const, survived: i >= 5 } })),
    }));
    const horizon = source.labels[0]!.horizon_days;
    const aggregates = buildAggregates(prs, [horizon]);
    expect(aggregates.survival_by_horizon.rows).toHaveLength(4);
    expect(aggregates.survival_by_horizon.rows.find((row) => row.outcome === 'reverted')?.cell).toMatchObject({ n: 20, value: 0.25, basis: 'descriptive' });
    expect(aggregates.risk_ratios.rows).toHaveLength(10);
    expect(aggregates.risk_ratios.rows.filter((row) => row.feature === 'loc_touched' && row.bucket !== 'q1').every((row) => row.rework_rate.n === 0)).toBe(true);
    const coverage = buildCoverage(prs, [horizon]);
    expect(coverage.prs_enumerated).toBe(20);
    expect(coverage.labels_by_horizon[0]?.labelled).toBe(20);
  });
});
