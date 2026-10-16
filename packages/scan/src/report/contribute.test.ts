import { describe, expect, it } from 'vitest';
import { buildReportDraft, emitReport } from './build.js';
import { buildContributionPayload, submitReport } from './contribute.js';

describe('contribution egress', () => {
  const report = emitReport(buildReportDraft({ owner: 'owner', repo: 'repo', integrationBranch: 'master', asOf: new Date('2026-10-16T00:00:00Z'), lookbackDays: 180, mergedFrom: new Date('2026-04-19T00:00:00Z'), horizons: [30], rows: [], scannerVersion: '0.4.0' })).report;
  it('sends the validated body and bearer header', async () => {
    const body = buildContributionPayload(report);
    let received: { url: string; body: string | undefined; authorization: string | undefined } | null = null;
    await submitReport((url, init) => {
      received = { url, body: init.body, authorization: init.headers?.Authorization };
      return Promise.resolve({ status: 201, headers: { get: () => null }, text: () => Promise.resolve('') });
    }, 'https://example.test/', 'key', body);
    expect(received).toEqual({ url: 'https://example.test/api/v1/arbiter/reports', body, authorization: 'Bearer key' });
    expect(body).not.toContain('merge_sha');
  });
  it('rejects fixture-origin reports and non-2xx responses', async () => {
    expect(() => buildContributionPayload({ ...report, data_origin: 'fixture' })).toThrow();
    await expect(submitReport(() => Promise.resolve({ status: 403, headers: { get: () => null }, text: () => Promise.resolve('') }), 'https://example.test', 'key', '{}')).rejects.toThrow(/HTTP 403/);
  });
});
