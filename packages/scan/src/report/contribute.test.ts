import { describe, expect, it } from 'vitest';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
import { buildContributionPayload, ContributionPayloadError, submitReport } from './contribute.js';
import { ScanUpstreamError } from '../default-deps.js';

describe('experimental report contribution payload', () => {
  it('validates scan origin and produces the exact body for transport', async () => {
    const report = reportDraftFixtures.full();
    report.data_origin = 'scan';
    const built = buildContributionPayload(report);
    let sent = '';
    let authorization = '';
    await submitReport(async (_url, init) => {
      await Promise.resolve();
      sent = init.body ?? ''; authorization = init.headers?.Authorization ?? '';
      return { status: 202, headers: { get: () => null }, async text() { await Promise.resolve(); return 'accepted'; } };
    }, built, { baseUrl: 'https://api.example.test/', apiKey: 'secret-value' });
    expect(sent).toBe(built.body);
    expect(authorization).toBe('Bearer secret-value');
  });
  it('maps non-2xx replies to upstream errors and requires a key', async () => {
    const payload = buildContributionPayload({ ...reportDraftFixtures.full(), data_origin: 'scan' });
    await expect(submitReport(async () => { await Promise.resolve(); return ({ status: 503, headers: { get: () => null }, async text() { await Promise.resolve(); return 'ignored'; } }); }, payload, { baseUrl: 'https://api.test', apiKey: 'secret' })).rejects.toBeInstanceOf(ScanUpstreamError);
    await expect(submitReport(async () => { await Promise.resolve(); return ({ status: 200, headers: { get: () => null }, async text() { await Promise.resolve(); return ''; } }); }, payload, { baseUrl: 'https://api.test', apiKey: '' })).rejects.toBeInstanceOf(ContributionPayloadError);
  });
  it('rejects fixture origin and forbidden fields', () => {
    expect(() => buildContributionPayload(reportDraftFixtures.full())).toThrow(ContributionPayloadError);
    const invalid = reportDraftFixtures.full() as unknown as Record<string, unknown>;
    invalid.data_origin = 'scan'; invalid.rawPrompt = 'unsafe';
    expect(() => buildContributionPayload(invalid)).toThrow(ContributionPayloadError);
  });
});
