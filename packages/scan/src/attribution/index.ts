/** SDK-facing projection of the P2.6 attribution engine. Raw evidence never reaches S3. */
import type { ArbiterReportV1 } from '@hokusai/core';
import type { AttributionConfig, PrAttribution, SignalEvidence } from './engine.js';
export { attributePullRequest, resolveAttributionConfig, extractExecutedRoute, HARNESS_REGISTRY, MODEL_SIGNATURES, GENERIC_AGENT_SIGNATURES, AttributionConfigError, DEFAULT_ATTRIBUTION_CONFIG, type AttributionConfig, type AttributionPrInput, type PrAttribution } from './engine.js';
export type ReportAttribution = ArbiterReportV1['prs'][number]['attribution'];
type Method = ReportAttribution['agent']['methods'][number];
const TIER = { verified: 1, strong: 0.8, weak: 0.5 } as const;
const SIGNAL_METHOD: Record<SignalEvidence['signal'], Method> = {
  executedRoute: 'first_party_route_metadata', wavemillMeta: 'first_party_route_metadata',
  botAuthor: 'bot_author', coAuthoredBy: 'co_authored_by_trailer',
  branchPrefix: 'branch_prefix', label: 'pr_label', commitSignature: 'commit_signature',
};
function ownerRules(config: AttributionConfig): string[] {
  return [
    ...config.extraBotLogins, ...config.extraBranchPrefixes, ...config.extraCoAuthorFragments,
    ...config.extraLabelNames, ...config.extraCommitSignatureFragments,
    ...config.extraHarnesses.flatMap((h) => [...h.botLogins, ...h.branchPrefixes, ...h.coAuthorFragments, ...h.labelNames, ...h.commitSignatureFragments]),
    ...config.extraModelSignatures.map((m) => m.fragment),
  ].map((value) => value.toLowerCase());
}
function methods(evidence: SignalEvidence[], config?: AttributionConfig): Method[] {
  const extra = config ? ownerRules(config) : [];
  return [...new Set(evidence.map((item) => {
    const rule = item.rule.toLowerCase();
    return extra.some((fragment) => fragment && rule.endsWith(fragment)) ? 'owner_config' : SIGNAL_METHOD[item.signal];
  }))].sort();
}
/** Closed S3 attribution vocabulary, with confidence and no raw evidence. */
export function toReportAttribution(value: PrAttribution, config?: AttributionConfig): ReportAttribution {
  return {
    agent: { status: value.agent.status, confidence: value.agent.confidence ? TIER[value.agent.confidence] : null, methods: methods(value.agent.evidence, config) },
    harness: { id: value.harness.status === 'identified' ? value.harness.value ?? null : null, confidence: value.harness.confidence ? TIER[value.harness.confidence] : null, methods: methods(value.harness.evidence, config) },
    exact_model: { id: value.model.status === 'identified' ? value.model.value ?? null : null, confidence: value.model.confidence ? TIER[value.model.confidence] : null, methods: methods(value.model.evidence, config), evidence: value.model.status !== 'identified' ? null : value.model.evidence.some((item) => item.signal === 'executedRoute' && item.modelId === value.model.value && item.tier === 'verified') ? 'first_party_executed' : 'heuristic' },
  };
}
