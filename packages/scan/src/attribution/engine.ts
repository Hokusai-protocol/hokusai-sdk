export type AttributionMethod =
  | 'first_party_route_metadata'
  | 'bot_author'
  | 'branch_prefix'
  | 'co_authored_by_trailer'
  | 'pr_label'
  | 'commit_signature'
  | 'owner_config';
import { extractMetadataBlock } from './metadata-block.js';

export interface AttributionPrInput {
  number: number;
  authorLogin: string | null;
  authorType: string | null;
  headRef: string;
  labels: readonly string[];
  mergedAt: string;
  commitMessages: readonly string[];
  body: string | null;
  headSha: string;
}
export interface AttributionConfig {
  botLogins?: readonly string[];
  branchPrefixes?: readonly string[];
  labels?: Readonly<Record<string, { agent?: string; harness?: string; model?: string }>>;
  extraBotLogins?: readonly string[];
  extraBranchPrefixes?: readonly string[];
  [key: string]: unknown;
}
export interface PrAttribution {
  agent: { status: 'agent' | 'unknown'; confidence: number | null; methods: AttributionMethod[] };
  harness: { id: string | null; confidence: number | null; methods: AttributionMethod[] };
  exactModel: { id: string | null; confidence: number | null; methods: AttributionMethod[]; evidence: 'first_party_executed' | 'heuristic' | null };
}
export class AttributionConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'AttributionConfigError'; }
}
export const HARNESS_REGISTRY = Object.freeze(['aider', 'claude-code', 'codex', 'openhands', 'wavemill']);
export const MODEL_SIGNATURES = Object.freeze(['claude-', 'gpt-', 'o1', 'o3', 'gemini-']);
export const GENERIC_AGENT_SIGNATURES = Object.freeze(['bot', '[bot]']);
const known = new Set(['botLogins', 'branchPrefixes', 'labels', 'extraBotLogins', 'extraBranchPrefixes']);

export function resolveAttributionConfig(input: unknown = {}): AttributionConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new AttributionConfigError('Attribution config must be an object');
  const config = input as AttributionConfig;
  const unknown = Object.keys(config).filter((key) => !known.has(key));
  if (unknown.length) throw new AttributionConfigError(`Unknown attribution config key: ${unknown[0]}`);
  for (const key of ['botLogins', 'branchPrefixes', 'extraBotLogins', 'extraBranchPrefixes'] as const) {
    const values = config[key];
    if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.length > 200))) {
      throw new AttributionConfigError(`${key} must be an array of bounded strings`);
    }
  }
  if (config.labels !== undefined && (!config.labels || typeof config.labels !== 'object' || Array.isArray(config.labels))) throw new AttributionConfigError('labels must be an object');
  return config;
}
const unique = (values: AttributionMethod[]) => [...new Set(values)];
const recognizedModel = (value: string | null): boolean => !!value && MODEL_SIGNATURES.some((signature) => value.toLowerCase().startsWith(signature));

/** Evidence conflicts remain unknown; only a verified coder route is execution evidence. */
export function attributePullRequest(pr: AttributionPrInput, config: AttributionConfig = {}): PrAttribution {
  const metadata = extractMetadataBlock(pr.body);
  const agentMethods: AttributionMethod[] = [];
  const harnessMethods: AttributionMethod[] = [];
  const modelMethods: AttributionMethod[] = [];
  let identifiedAgent = false;
  const routeRole = typeof metadata?.['executedroute'] === 'string' ? metadata['executedroute'].toLowerCase() : '';
  const metadataHead = typeof metadata?.['headsha'] === 'string' ? metadata['headsha'].toLowerCase() : null;
  const routeVerified = routeRole === 'coder' && recognizedModel(typeof metadata?.['model'] === 'string' ? metadata['model'] : null) && (!metadataHead || metadataHead === pr.headSha.toLowerCase());
  if (routeVerified) {
    identifiedAgent = true;
    agentMethods.push('first_party_route_metadata');
    harnessMethods.push('first_party_route_metadata');
    modelMethods.push('first_party_route_metadata');
  }

  const login = (pr.authorLogin ?? '').toLowerCase();
  const configuredBot = [...(config.botLogins ?? []), ...(config.extraBotLogins ?? [])].some((value) => value.toLowerCase() === login);
  const botAuthor = configuredBot || /\[bot\]$/i.test(pr.authorLogin ?? '') || (pr.authorType ?? '').toLowerCase() === 'bot';
  if (botAuthor) {
    identifiedAgent = true;
    agentMethods.push(configuredBot ? 'owner_config' : 'bot_author');
  }
  if (pr.commitMessages.some((message) => /co-authored-by:.*(?:\[bot\]|\b(?:bot|agent)\b)/i.test(message))) {
    identifiedAgent = true;
    agentMethods.push('co_authored_by_trailer');
  }

  const configuredPrefix = config.branchPrefixes?.find((value) => pr.headRef.startsWith(value));
  const ownerPrefix = config.extraBranchPrefixes?.find((value) => pr.headRef.startsWith(value));
  const builtInPrefix = /^(?:agent|bot|codex|aider|claude-code)\//i.test(pr.headRef);
  if (configuredPrefix || ownerPrefix || builtInPrefix) {
    identifiedAgent = true;
    agentMethods.push(ownerPrefix ? 'owner_config' : 'branch_prefix');
  }
  const matchedLabel = pr.labels.find((label) => config.labels?.[label] !== undefined);
  if (matchedLabel) { identifiedAgent = true; agentMethods.push('pr_label'); }

  const signatureMatches = pr.commitMessages.join('\n').match(/\b(?:gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|o[13](?:-[\w.-]+)?)\b/ig) ?? [];
  const signatureModels = [...new Set(signatureMatches.map((value) => value.toLowerCase()))];
  if (signatureModels.length) { identifiedAgent = true; agentMethods.push('commit_signature'); }

  const metadataHarness = typeof metadata?.['harness'] === 'string' ? metadata['harness'].toLowerCase() : null;
  const labelHarness = matchedLabel ? config.labels?.[matchedLabel]?.harness?.toLowerCase() ?? null : null;
  const prefixHarness = builtInPrefix ? pr.headRef.split('/')[0]?.toLowerCase() ?? null : null;
  const harnessEvidence = routeVerified ? [metadataHarness] : [metadataHarness, labelHarness, prefixHarness].filter((value): value is string => !!value);
  const harnessIds = [...new Set(harnessEvidence.filter((value): value is string => typeof value === 'string' && HARNESS_REGISTRY.includes(value)))];
  const harness = harnessIds.length === 1 ? harnessIds[0]! : null;
  if (harness && !routeVerified) harnessMethods.push(metadataHarness ? 'first_party_route_metadata' : labelHarness ? 'pr_label' : 'branch_prefix');

  const metadataModel = typeof metadata?.['model'] === 'string' ? metadata['model'].toLowerCase() : null;
  const labelModel = matchedLabel ? config.labels?.[matchedLabel]?.model?.toLowerCase() ?? null : null;
  const modelEvidence = routeVerified ? [metadataModel] : [labelModel, ...signatureModels].filter((value): value is string => !!value && recognizedModel(value));
  const modelIds = [...new Set(modelEvidence.filter((value): value is string => recognizedModel(value)))];
  const exactModel = modelIds.length === 1 ? modelIds[0]! : null;
  if (exactModel && !routeVerified) modelMethods.push(signatureModels.includes(exactModel) ? 'commit_signature' : 'pr_label');

  return {
    agent: { status: identifiedAgent ? 'agent' : 'unknown', confidence: identifiedAgent ? 1 : null, methods: unique(agentMethods) },
    harness: { id: harness, confidence: harness ? (routeVerified ? 1 : 0.8) : null, methods: unique(harnessMethods) },
    exactModel: { id: exactModel, confidence: exactModel ? (routeVerified ? 1 : 0.5) : null, methods: unique(modelMethods), evidence: exactModel ? (routeVerified ? 'first_party_executed' : 'heuristic') : null },
  };
}
export function toReportAttribution(value: PrAttribution) {
  return { agent: value.agent, harness: value.harness, exact_model: value.exactModel };
}
