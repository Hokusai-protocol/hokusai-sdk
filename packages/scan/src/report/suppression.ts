/** Scanner-owned report visibility rules. Both render paths receive this output. */
import {
  REPORT_SUPPRESSION_REASONS,
  validateArbiterReportV1,
  type ArbiterReportV1,
  type ReportCell,
  type ReportPolicy,
  type SuppressionReason,
} from '@hokusai/core';

export type ArbiterReportDraftV1 = ArbiterReportV1;
export const DEFAULT_REPORT_POLICY: ReportPolicy = Object.freeze({
  policy_version: '1.0.0',
  min_cell_n: 20,
  min_agent_coverage: 0.6,
  min_harness_coverage: 0.6,
  min_exact_model_coverage: 0.6,
  min_cost_coverage: 0.6,
  min_reworked_for_retrospective: 20,
  ci_method: 'wilson',
  ci_level: 0.95,
});
export class ArbiterReportBuildError extends Error {
  constructor(readonly errors: readonly { path: string; message: string }[]) {
    super(
      `Cannot build arbiter_report/v1: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
    this.name = 'ArbiterReportBuildError';
  }
}
const ordered = (reasons: readonly SuppressionReason[]): SuppressionReason[] =>
  REPORT_SUPPRESSION_REASONS.filter((r) => reasons.includes(r));
function hide(cell: ReportCell, reasons: readonly SuppressionReason[]): void {
  cell.suppressed = true;
  cell.value = null;
  cell.ci = null;
  cell.suppression_reasons = ordered([...cell.suppression_reasons, ...reasons]);
}
function rowsCells(row: Record<string, unknown>): ReportCell[] {
  return Object.entries(row)
    .filter(
      ([key]) => key === 'cell' || key === 'ratio' || key.endsWith('_rate'),
    )
    .map(([, value]) => value as ReportCell);
}

/** Pure and idempotent. The policy is recorded for audit, never consumed by a renderer. */
export function applyReportSuppression(
  draft: ArbiterReportDraftV1,
  policy: ReportPolicy = DEFAULT_REPORT_POLICY,
): ArbiterReportV1 {
  const report = structuredClone(draft);
  report.policy = structuredClone(policy);
  // A heuristic model guess is never executed-model evidence. Coverage in the
  // envelope stays descriptive; eligibility uses the stronger first-party bar.
  const executed = report.prs.filter(
    (pr) => pr.attribution.exact_model.evidence === 'first_party_executed',
  );
  const executedRate =
    executed.length / Math.max(1, report.coverage.prs_enumerated);
  const exact =
    report.coverage.attribution.exact_model.rate >=
      policy.min_exact_model_coverage &&
    executedRate >= policy.min_exact_model_coverage;
  const harness =
    report.coverage.attribution.harness.rate >= policy.min_harness_coverage;
  const comparablePriced = executed.filter(
    (pr) => pr.cost?.actual_usd !== null && pr.cost?.actual_usd !== undefined,
  ).length;
  const priced = Math.min(
    report.cost?.actual.prs_priced ?? 0,
    comparablePriced,
  );
  const actualCoverage = priced / Math.max(1, executed.length);
  const actual =
    !!report.cost &&
    !report.cost.actual.suppressed &&
    priced >= policy.min_cell_n &&
    actualCoverage >= policy.min_cost_coverage;
  const eligibility = report.eligibility;
  eligibility.exact_model_table = exact;
  eligibility.harness_table = harness;
  eligibility.cost_adjusted_by_model = exact && actual;
  eligibility.retrospective =
    !!report.model_provenance &&
    !!report.retrospective &&
    report.retrospective.n_reworked >= policy.min_reworked_for_retrospective;
  const modelReasons: SuppressionReason[] = exact
    ? []
    : harness
      ? ['exact_model_coverage_below_floor', 'harness_only_evidence']
      : ['exact_model_coverage_below_floor'];
  const harnessReasons: SuppressionReason[] = harness
    ? []
    : ['harness_coverage_below_floor'];
  const costReasons: SuppressionReason[] = exact
    ? actual
      ? []
      : ['cost_coverage_below_floor']
    : modelReasons;
  const sectionReasons: Record<
    keyof typeof report.aggregates,
    SuppressionReason[]
  > = {
    survival_by_horizon: [],
    risk_ratios: [],
    survival_by_model: modelReasons,
    survival_by_harness: harnessReasons,
    cost_adjusted_survival_by_model: costReasons,
  };
  for (const [name, section] of Object.entries(report.aggregates)) {
    const reason = sectionReasons[name as keyof typeof report.aggregates];
    for (const row of section.rows as Record<string, unknown>[])
      for (const cell of rowsCells(row)) {
        if (cell.n < policy.min_cell_n) hide(cell, ['n_below_floor']);
        if (reason.length) hide(cell, reason);
      }
    const cells = (section.rows as Record<string, unknown>[]).flatMap(
      rowsCells,
    );
    if (reason.length || !cells.length || cells.every((c) => c.suppressed)) {
      section.status = 'suppressed';
      section.suppression_reasons = ordered([
        ...section.suppression_reasons,
        ...reason,
        ...cells.flatMap((c) => c.suppression_reasons),
        ...(!cells.length ? ['n_below_floor' as const] : []),
      ]);
    } else {
      section.status = 'shown';
      section.suppression_reasons = [];
    }
  }
  eligibility.cost_adjusted_by_model =
    eligibility.cost_adjusted_by_model &&
    report.aggregates.cost_adjusted_survival_by_model.rows.some(
      (row) => !row.cell.suppressed,
    );
  eligibility.model_routing_cta =
    exact &&
    report.aggregates.survival_by_model.rows.some((r) => !r.cell.suppressed);
  eligibility.reasons = ordered([
    ...modelReasons,
    ...harnessReasons,
    ...costReasons,
    ...(report.coverage.attribution.agent.rate < policy.min_agent_coverage
      ? ['agent_coverage_below_floor' as const]
      : []),
  ]);
  if (report.retrospective) {
    const reasons: SuppressionReason[] = [];
    if (!report.model_provenance) reasons.push('no_model_provenance');
    if (report.retrospective.n_reworked < policy.min_reworked_for_retrospective)
      reasons.push('reworked_below_floor');
    for (const [name, cell] of Object.entries({
      precision: report.retrospective.precision,
      recall: report.retrospective.recall,
      flagged_share: report.retrospective.flagged_share,
    })) {
      if (cell.n < policy.min_cell_n) hide(cell, ['n_below_floor']);
      if (
        name !== 'flagged_share' &&
        cell.n < policy.min_reworked_for_retrospective
      )
        hide(cell, ['reworked_below_floor']);
      if (reasons.length) hide(cell, reasons);
    }
    report.retrospective.suppressed =
      !eligibility.retrospective ||
      [
        report.retrospective.precision,
        report.retrospective.recall,
        report.retrospective.flagged_share,
      ].every((c) => c.suppressed);
    report.retrospective.suppression_reasons = report.retrospective.suppressed
      ? ordered([
          ...reasons,
          ...report.retrospective.precision.suppression_reasons,
        ])
      : [];
  }
  if (report.cost) {
    for (const part of [report.cost.actual, report.cost.estimated])
      if (part.prs_priced < policy.min_cell_n) {
        part.total_usd = null;
        part.suppressed = true;
        part.suppression_reasons = ordered([
          ...part.suppression_reasons,
          'n_below_floor',
        ]);
      }
  }
  const valid = validateArbiterReportV1(report);
  if (!valid.ok) throw new ArbiterReportBuildError(valid.errors);
  return valid.value;
}
