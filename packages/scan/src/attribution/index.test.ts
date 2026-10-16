import { describe, expect, it } from 'vitest';
import { attributePullRequest, resolveAttributionConfig, toReportAttribution } from './index.js';
const base = { number: 1, authorLogin: 'someone', authorType: 'User', headRef: null, labels: [], mergedAt: '2026-10-16T00:00:00Z', commitMessages: [], body: null, headSha: 'abc123' };
const meta = (lines: string[]) => `<!-- wavemill-meta\n${lines.join('\n')}\n-->`;
const route = JSON.stringify({ head_sha: 'abc123', planner: { status: 'executed', model: 'claude-opus-5' }, coder: { status: 'executed', model: 'claude-fable-5' }, reviewer: { status: 'executed', model: 'gpt-5.5' } });
describe('PR attribution port', () => {
  it('never infers human from absent signals', () => {
    const result = toReportAttribution(attributePullRequest(base));
    expect(result.agent.status).toBe('unknown');
    expect(result.exact_model.id).toBeNull();
  });
  it('verified executed coder outranks conflicting heuristics', () => {
    const body = meta(['route_schema: 1', `executed_route: ${route}`]);
    const result = toReportAttribution(attributePullRequest({ ...base, body, headRef: 'claude-code/fix', labels: ['cursor'] }));
    expect(result.exact_model).toMatchObject({ id: 'claude-fable-5', evidence: 'first_party_executed', confidence: 1 });
    expect(result.harness.id).toBe('wavemill');
    const stale = toReportAttribution(attributePullRequest({ ...base, body, headSha: 'other' }));
    expect(stale.exact_model.id).toBeNull();
  });
  it('conflicts remain unknown and owner config is explicit', () => {
    const conflict = toReportAttribution(attributePullRequest({ ...base, commitMessages: ['Co-authored-by: Claude Fable 5 <noreply@anthropic.com>', 'Co-authored-by: GPT-5.5 <noreply@openai.com>'] }));
    expect(conflict.exact_model.id).toBeNull();
    const config = resolveAttributionConfig({ extraBotLogins: ['someone'] });
    expect(toReportAttribution(attributePullRequest(base, config), config).agent.methods).toContain('owner_config');
    expect(() => resolveAttributionConfig({ unknown: ['x'] })).toThrow();
  });
});
