export { attributePullRequest, resolveAttributionConfig, toReportAttribution, AttributionConfigError, HARNESS_REGISTRY, MODEL_SIGNATURES, GENERIC_AGENT_SIGNATURES } from './engine.js';
export type { AttributionPrInput, AttributionConfig, PrAttribution, AttributionMethod } from './engine.js';
export { agentMarkerColumns, branchAgentFamily, detectAgentMarkers, isDependencyBotLogin } from './agent-markers.js';
export type { AgentMarkerCommit, AgentMarkerInput, AgentMarkers } from './agent-markers.js';
export { extractMetadataBlock } from './metadata-block.js';
export { detectBodyDisclosure, hasAiCodemodSubject, isUpstreamImportTitle } from './disclosures.js';
export type { BodyDisclosureRule } from './disclosures.js';
