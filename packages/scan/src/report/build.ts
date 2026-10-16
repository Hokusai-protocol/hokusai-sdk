import { ARBITER_REPORT_SCHEMA_VERSION, type ArbiterReportV1, type ReportPolicy } from '@hokusai/core';
import { SURVIVAL_LABELLER_VERSION, SURVIVAL_NORMALIZATION_VERSION } from '../survival-labeller.js';
import { DEFAULT_REPORT_POLICY, applyReportSuppression } from './suppression.js';
import { buildAggregates, buildCoverage } from './aggregate.js';

export interface ReportDraftInput {
  owner: string;
  repo: string;
  integrationBranch: string;
  asOf: Date;
  lookbackDays: number;
  mergedFrom: Date;
  horizons: ArbiterReportV1['scan']['horizons_days'];
  rows: ArbiterReportV1['prs'];
  scannerVersion: string;
}

export function buildReportDraft(input: ReportDraftInput): ArbiterReportV1 {
  const rows = [...input.rows].sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.pr_number - b.pr_number);
  return {
    schema_version: ARBITER_REPORT_SCHEMA_VERSION,
    data_origin: 'scan',
    repo: { host: 'github', owner: input.owner, name: input.repo },
    scan: {
      scanned_at: input.asOf.toISOString(), as_of: input.asOf.toISOString(),
      scanner: { package: '@hokusai/scan', version: input.scannerVersion },
      integration_branch: input.integrationBranch, lookback_days: input.lookbackDays,
      window: { merged_from: input.mergedFrom.toISOString(), merged_to: input.asOf.toISOString() },
      horizons_days: [...input.horizons],
      contracts: { candidate_features: 'candidate_features/v1', survival_label: '1.0.0', labeller_version: SURVIVAL_LABELLER_VERSION, normalization_version: SURVIVAL_NORMALIZATION_VERSION },
    },
    policy: structuredClone(DEFAULT_REPORT_POLICY),
    coverage: buildCoverage(rows, input.horizons),
    prs: rows,
    aggregates: buildAggregates(rows, input.horizons),
    retrospective: null, cost: null, model_provenance: null,
    eligibility: { exact_model_table: false, harness_table: false, cost_adjusted_by_model: false, retrospective: false, model_routing_cta: false, reasons: [] },
  };
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}
export function emitReport(draft: ArbiterReportV1, policy: ReportPolicy = DEFAULT_REPORT_POLICY): { report: ArbiterReportV1; json: string } {
  const report = applyReportSuppression(draft, policy);
  return { report, json: `${JSON.stringify(sorted(report), null, 2)}\n` };
}
