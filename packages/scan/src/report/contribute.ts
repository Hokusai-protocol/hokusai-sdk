import { REPORT_FORBIDDEN_KEYS, validateArbiterReportV1, type ArbiterReportV1, type FetchTransport } from '@hokusai/core';
import { ScanUpstreamError } from '../default-deps.js';

function checkKeys(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(checkKeys); return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (REPORT_FORBIDDEN_KEYS.some((forbidden) => forbidden === 'raw*' ? key.startsWith('raw') : key === forbidden)) throw new Error(`Contribution contains forbidden key: ${key}`);
    checkKeys(child);
  }
}
/** Revalidate and serialize the exact safe body used by dry-run and POST. */
export function buildContributionPayload(report: ArbiterReportV1): string {
  const valid = validateArbiterReportV1(report);
  if (!valid.ok) throw new Error('Contribution report does not satisfy arbiter_report/v1');
  if (report.data_origin !== 'scan') throw new Error('Only scan-origin reports can be contributed');
  checkKeys(report);
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)])) : value;
  return `${JSON.stringify(sort(report), null, 2)}\n`;
}
export async function submitReport(transport: FetchTransport, baseUrl: string, apiKey: string, body: string): Promise<void> {
  const response = await transport(`${baseUrl.replace(/\/$/, '')}/api/v1/arbiter/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body });
  if (response.status < 200 || response.status >= 300) throw new ScanUpstreamError(`Report contribution failed (HTTP ${response.status})`);
}
