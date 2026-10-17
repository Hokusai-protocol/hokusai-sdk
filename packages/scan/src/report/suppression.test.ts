import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
import {
  applyReportSuppression,
  DEFAULT_REPORT_POLICY,
} from './suppression.js';

const root = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../fixtures/arbiter/report',
);
describe('scanner-owned report suppression', () => {
  it('regenerates every committed fixture', () => {
    for (const [name, build] of Object.entries(reportDraftFixtures)) {
      const actual = `${JSON.stringify(applyReportSuppression(build()), null, 2)}\n`;
      expect(actual, name).toBe(
        readFileSync(
          join(root, `${name.replaceAll('_', '-')}.v1.json`),
          'utf8',
        ),
      );
    }
  });
  it('uses the declared n floor at 19 and 20', () => {
    for (const n of [19, 20]) {
      const draft = reportDraftFixtures.full();
      draft.aggregates.survival_by_horizon.rows[0]!.cell.n = n;
      const result = applyReportSuppression(draft);
      expect(
        result.aggregates.survival_by_horizon.rows[0]!.cell.suppressed,
      ).toBe(n < 20);
    }
  });
  it('uses the declared exact-model coverage floor', () => {
    for (const rate of [0.59, 0.6]) {
      const draft = reportDraftFixtures.full();
      draft.coverage.attribution.exact_model.rate = rate;
      const result = applyReportSuppression(draft);
      expect(result.eligibility.exact_model_table).toBe(rate >= 0.6);
    }
  });
  it('is idempotent', () => {
    for (const build of Object.values(reportDraftFixtures)) {
      const once = applyReportSuppression(build());
      expect(applyReportSuppression(once)).toEqual(once);
    }
  });
  it('never enables routing from harness-only attribution', () => {
    const report = applyReportSuppression(reportDraftFixtures.harness_only());
    expect(report.eligibility.harness_table).toBe(true);
    expect(report.eligibility.exact_model_table).toBe(false);
    expect(report.eligibility.model_routing_cta).toBe(false);
    expect(report.aggregates.survival_by_model.suppression_reasons).toContain(
      'harness_only_evidence',
    );
  });
  it('suppresses cost adjustment below actual cost coverage', () => {
    const draft = reportDraftFixtures.full();
    draft.cost!.actual.prs_priced = 100;
    const result = applyReportSuppression(draft, DEFAULT_REPORT_POLICY);
    expect(result.eligibility.exact_model_table).toBe(true);
    expect(result.eligibility.cost_adjusted_by_model).toBe(false);
    expect(result.aggregates.cost_adjusted_survival_by_model.status).toBe(
      'suppressed',
    );
  });
  it('does not promote heuristic model IDs into exact-model evidence', () => {
    const draft = reportDraftFixtures.full();
    for (const pr of draft.prs)
      if (pr.attribution.exact_model.id)
        pr.attribution.exact_model.evidence = 'heuristic';
    const report = applyReportSuppression(draft);
    expect(report.coverage.attribution.exact_model.rate).toBeGreaterThan(0.6);
    expect(report.eligibility.exact_model_table).toBe(false);
    expect(report.eligibility.cost_adjusted_by_model).toBe(false);
    expect(report.eligibility.model_routing_cta).toBe(false);
  });
});
