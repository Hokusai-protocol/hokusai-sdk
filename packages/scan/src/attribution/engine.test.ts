import { describe, expect, it } from 'vitest';
import { attributePullRequest, resolveAttributionConfig, AttributionConfigError, toReportAttribution } from './engine.js';
const base = { number: 1, authorLogin: 'alice', authorType: 'User', headRef: 'feature/x', labels: [], mergedAt: '2026-01-01T00:00:00Z', commitMessages: [], body: null, headSha: 'abc' };
describe('scan attribution', () => {
  it('defaults to unknown and never infers a human signal', () => {
    const result = attributePullRequest(base);
    expect(result.agent.status).toBe('unknown');
    expect(toReportAttribution(result).agent.status).toBe('unknown');
  });
  it('recognizes explicit bot configuration and route metadata', () => {
    expect(attributePullRequest({ ...base, authorLogin: 'ci-bot' }, { botLogins: ['ci-bot'] }).agent.methods).toContain('owner_config');
    expect(attributePullRequest({ ...base, authorLogin: 'extra-ci' }, { extraBotLogins: ['extra-ci'] }).agent.methods).toContain('owner_config');
    const route = attributePullRequest({ ...base, body: '<!-- wavemill-meta\nexecutedRoute: coder\nmodel: gpt-4.1\nharness: codex\n-->' });
    expect(route.exactModel.evidence).toBe('first_party_executed');
    expect(route.harness.id).toBe('codex');
  });
  it('keeps conflicting heuristic models unknown and ignores stale route metadata', () => {
    const conflict = attributePullRequest({ ...base, commitMessages: ['model=gpt-4.1', 'model=claude-3.7'] });
    expect(conflict.exactModel.id).toBeNull();
    const stale = attributePullRequest({ ...base, body: '<!-- wavemill-meta\nexecutedRoute: coder\nmodel: gpt-4.1\nheadSha: deadbeef\n-->' });
    expect(stale.exactModel.evidence).toBeNull();
  });
  it('finds agent evidence on a PR opened under a person\'s account', () => {
    const trailer = attributePullRequest({ ...base, commitMessages: ['Fix\n\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>'] });
    expect(trailer.agent).toMatchObject({ status: 'agent', methods: ['co_authored_by_trailer'] });
    expect(trailer.exactModel).toMatchObject({ id: 'claude-opus-4-5', evidence: 'heuristic' });
    const footer = attributePullRequest({ ...base, body: 'Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' });
    expect(footer.agent).toMatchObject({ status: 'agent', methods: ['commit_signature'] });
    const branch = attributePullRequest({ ...base, headRef: 'claude/fix-x' });
    expect(branch.agent.methods).toEqual(['branch_prefix']);
    expect(branch.harness.id).toBe('claude-code');
  });
  it('does not call a PR agent-written because a commit names a model or has a dependency-bot co-author', () => {
    expect(attributePullRequest({ ...base, commitMessages: ['Add gpt-4 tokenizer test'] }).agent.status).toBe('unknown');
    expect(attributePullRequest({ ...base, commitMessages: ['Merge\n\nCo-authored-by: dependabot[bot] <support@github.com>'] }).agent.status).toBe('unknown');
  });
  it('rejects unknown configuration keys', () => {
    expect(() => resolveAttributionConfig({ mystery: true })).toThrow(AttributionConfigError);
  });
});
