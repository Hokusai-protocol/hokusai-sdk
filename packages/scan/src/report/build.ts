import { validateArbiterReportV1, type ArbiterReportV1, type HorizonDays, type ReportPolicy } from '@hokusai/core';
import { SCAN_CONTRACT } from '../contract.js';
import { DEFAULT_REPORT_POLICY, applyReportSuppression, type ArbiterReportDraftV1 } from './suppression.js';
import { buildAggregates, buildCoverage } from './aggregate.js';

export interface BuildReportDraftInput {
  owner: string; repo: string; integrationBranch: string; scannerVersion: string;
  scannedAt: string; asOf: string; lookbackDays: number; mergedFrom: string; mergedTo: string;
  horizons: readonly HorizonDays[]; prs: ArbiterReportV1['prs']; policy?: ReportPolicy;
}
/** Assemble the closed-schema report draft; suppression is applied only by emitReport. */
export function buildReportDraft(input: BuildReportDraftInput): ArbiterReportDraftV1 {
  const horizons = [...input.horizons].sort((a, b) => a - b);
  const prs = [...input.prs].sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.pr_number - b.pr_number);
  return {
    schema_version: 'arbiter_report/v1', data_origin: 'scan',
    repo: { host: 'github', owner: input.owner, name: input.repo },
    scan: {
      scanned_at: input.scannedAt, as_of: input.asOf,
      scanner: { package: '@hokusai/scan', version: input.scannerVersion },
      integration_branch: input.integrationBranch, lookback_days: input.lookbackDays,
      window: { merged_from: input.mergedFrom, merged_to: input.mergedTo }, horizons_days: horizons,
      contracts: { candidate_features: 'candidate_features/v1', survival_label: '1.0.0', labeller_version: SCAN_CONTRACT.labellerVersion, normalization_version: SCAN_CONTRACT.normalizationVersion },
    },
    policy: structuredClone(input.policy ?? DEFAULT_REPORT_POLICY), coverage: buildCoverage(prs, horizons), prs,
    aggregates: buildAggregates(prs, horizons), cost: null, retrospective: null, model_provenance: null,
    eligibility: { exact_model_table: false, harness_table: false, cost_adjusted_by_model: false, retrospective: false, model_routing_cta: false, reasons: [] },
  };
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function emitReport(draft: ArbiterReportDraftV1, policy: ReportPolicy = DEFAULT_REPORT_POLICY): string {
  const report = applyReportSuppression(draft, policy);
  const validation = validateArbiterReportV1(report);
  if (!validation.ok) throw new Error(`Invalid arbiter_report/v1: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  return `${JSON.stringify(JSON.parse(canonicalJson(report)), null, 2)}\n`;
}
