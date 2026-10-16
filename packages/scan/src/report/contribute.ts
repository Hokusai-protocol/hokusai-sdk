import { REPORT_FORBIDDEN_KEYS, validateArbiterReportV1, type ArbiterReportV1 } from '@hokusai/core';
import type { FetchTransport } from '@hokusai/core';
import { ScanUpstreamError } from '../default-deps.js';

export class ContributionPayloadError extends Error { constructor(message: string) { super(message); this.name = 'ContributionPayloadError'; } }
const forbidden = new Set<string>(REPORT_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));
function findForbidden(value: unknown, prefix = ''): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) { const found = findForbidden(value[i], `${prefix}[${i}]`); if (found) return found; } return null; }
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (forbidden.has(lower) || (lower.startsWith('raw') && lower.length > 3)) return `${prefix}.${key}`;
    const found = findForbidden(child, `${prefix}.${key}`); if (found) return found;
  }
  return null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') { const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`; }
  return JSON.stringify(value);
}
export function buildContributionPayload(report: unknown): { payload: ArbiterReportV1; body: string } {
  const checked = validateArbiterReportV1(report);
  if (!checked.ok) throw new ContributionPayloadError(`Invalid report: ${checked.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  if (checked.value.data_origin !== 'scan') throw new ContributionPayloadError('Only scan reports can be contributed');
  const path = findForbidden(checked.value);
  if (path) throw new ContributionPayloadError(`Forbidden report field at ${path}`);
  return { payload: checked.value, body: `${JSON.stringify(JSON.parse(canonical(checked.value)), null, 2)}\n` };
}
export async function submitReport(transport: FetchTransport, payload: ReturnType<typeof buildContributionPayload>, options: { baseUrl: string; apiKey: string }): Promise<{ status: number; responseText: string }> {
  if (!options.apiKey) throw new ContributionPayloadError('API key is required');
  let response;
  try {
    response = await transport(`${options.baseUrl.replace(/\/$/, '')}/api/v1/arbiter/reports`, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: payload.body });
  } catch {
    throw new ScanUpstreamError('Arbiter report submission failed');
  }
  const responseText = await response.text();
  if (response.status < 200 || response.status >= 300) throw new ScanUpstreamError(`Arbiter report submission failed (HTTP ${response.status})`);
  return { status: response.status, responseText };
}
