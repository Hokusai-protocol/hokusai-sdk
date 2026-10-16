/** Ported from wavemill shared/lib/pr-attribution.ts at 91a7df29. */
/**
 * PR Attribution Engine - Arbiter P2.6 (HOK-2808)
 *
 * Pure (no I/O) attribution of merged pull requests to agents, harnesses and
 * exact models, per the post-R4 contract (HOK-2791 / HOK-2944):
 *
 * Three INDEPENDENT dimensions per PR, each with confidence, evidence and an
 * explicit unknown:
 *   1. agent-authored status  - was the PR observably produced by an agent?
 *   2. harness identity       - which agent product (Copilot, Claude Code, ...)?
 *   3. exact model identity   - which model (canonical id, model-registry vocabulary)?
 *
 * Rules encoded here:
 *   - Score ALL PRs; unattributed PRs stay in the corpus. Missing signals never
 *     imply human authorship - there is no 'human' value in the type system.
 *   - Verified first-party metadata (the HOK-2945 `executed_route` payload in
 *     the `wavemill-meta` PR block) outranks every heuristic. Recommendations,
 *     intended routes, stale heads and conflicting evidence never become
 *     execution: they degrade to unknown with diagnostics.
 *   - Conflicting evidence at the same confidence tier -> unknown, with every
 *     piece of evidence retained.
 *   - The exact-model dimension is 'verified' only from an executed route;
 *     explicit model-version strings give 'strong' (Co-Authored-By trailer) or
 *     'weak' (commit-message text). Product names alone (e.g. "Copilot",
 *     "Claude Code") identify a harness, never a model.
 *   - Report gates: survival-by-model requires exact-model coverage at or above
 *     the floor; survival-by-harness requires harness coverage at or above the
 *     floor; both require at least `minEligiblePrs` eligible PRs. Below the
 *     floor the section is suppressed with an explicit reason - coverage is
 *     surfaced, never hidden.
 *
 * @module pr-attribution
 */

import { extractMetadataBlock } from './metadata-block.js';

export const PR_ATTRIBUTION_SCHEMA_VERSION = 1;

// ── Input ────────────────────────────────────────────────────────────────────

/**
 * Attribution input: a merged PR with `body` and `headSha` on top of the R4
 * tool's fields. Structurally identical to the shared fetcher's output.
 */
export interface AttributionPrInput {
  number: number;
  authorLogin: string | null;
  authorType: string | null;
  headRef: string | null;
  labels: string[];
  mergedAt: string;
  commitMessages: string[];
  body: string | null;
  headSha: string | null;
}

// ── Signals, tiers, evidence ─────────────────────────────────────────────────

/** The five R4 heuristic signals plus the two first-party wavemill signals. */
export type AttributionSignal =
  | 'botAuthor'
  | 'coAuthoredBy'
  | 'branchPrefix'
  | 'label'
  | 'commitSignature'
  | 'wavemillMeta'
  | 'executedRoute';

export const ATTRIBUTION_SIGNALS: readonly AttributionSignal[] = Object.freeze([
  'botAuthor',
  'coAuthoredBy',
  'branchPrefix',
  'label',
  'commitSignature',
  'wavemillMeta',
  'executedRoute',
]);

/**
 * Confidence tiers. 'verified' is reserved for first-party executed-route
 * evidence; heuristics cap at 'strong'.
 */
export type ConfidenceTier = 'verified' | 'strong' | 'weak';

const TIER_RANK: Record<ConfidenceTier, number> = { verified: 3, strong: 2, weak: 1 };

/**
 * Per-signal heuristic confidence. Explicit statements (bot identity, trailer,
 * "Generated with ..." signature, wavemill-meta block) are strong; naming
 * conventions (branch prefix, label) are circumstantial and weak.
 */
const SIGNAL_TIER: Record<Exclude<AttributionSignal, 'executedRoute'>, ConfidenceTier> = {
  botAuthor: 'strong',
  coAuthoredBy: 'strong',
  branchPrefix: 'weak',
  label: 'weak',
  commitSignature: 'strong',
  wavemillMeta: 'strong',
};

export interface SignalEvidence {
  signal: AttributionSignal;
  /** The matched raw value (login, trailer, branch name, label, fragment...). */
  value: string;
  /** Machine-readable rule id, e.g. `co-author-fragment:claude`. */
  rule: string;
  tier: ConfidenceTier;
  /** Harness this evidence points at, when signal is harness-specific. */
  harnessId?: string;
  /** Canonical model id this evidence points at, when model-specific. */
  modelId?: string;
}

// ── Dimension results ────────────────────────────────────────────────────────

/**
 * Agent dimension: 'agent' when any signal fired, else 'unknown'. Deliberately
 * has no 'human' value - absence of signals is not evidence of human authorship.
 */
export interface AgentDimension {
  status: 'agent' | 'unknown';
  confidence?: ConfidenceTier;
  evidence: SignalEvidence[];
}

/** Harness and exact-model dimensions. */
export interface IdentityDimension {
  status: 'identified' | 'unknown';
  /** Harness id or canonical model id when identified. */
  value?: string;
  confidence?: ConfidenceTier;
  /** Every piece of pointing evidence, including conflicting/outranked pieces. */
  evidence: SignalEvidence[];
}

export interface PrAttribution {
  number: number;
  mergedAt: string;
  /** Distinct signals that fired (union basis for coverage). */
  signals: AttributionSignal[];
  agent: AgentDimension;
  harness: IdentityDimension;
  model: IdentityDimension;
  /**
   * The router's decision for this PR (HOK-3098 `route_decision`), when the
   * wavemill-meta block carries one. Not an identity signal — `recommended`
   * is what the router chose, not what ran — but it is the join key Model
   * Match needs between a PR's outcome label and its route decision.
   */
  routeDecision?: ExtractedRouteDecision;
  /** Machine-readable notes: malformed routes, stale heads, conflicts. */
  diagnostics: string[];
}

// ── Harness registry (single signature vocabulary) ───────────────────────────

export interface HarnessDefinition {
  /** Stable harness id, e.g. 'github-copilot', 'claude-code', 'wavemill'. */
  id: string;
  displayName: string;
  botLogins: string[];
  coAuthorFragments: string[];
  branchPrefixes: string[];
  labelNames: string[];
  commitSignatureFragments: string[];
}

function harness(def: HarnessDefinition): HarnessDefinition {
  return def;
}

/**
 * One entry per known agent product. The R4 flat `DETECTOR_SIGNATURES` lists
 * are re-derived from this registry via `legacyDetectorSignatures()`, so the
 * two tools cannot drift.
 */
export const HARNESS_REGISTRY: readonly HarnessDefinition[] = Object.freeze([
  harness({
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    botLogins: ['copilot', 'copilot-swe-agent', 'copilot-swe-agent[bot]', 'github-copilot[bot]'],
    coAuthorFragments: ['copilot'],
    branchPrefixes: ['copilot/', 'copilot-'],
    labelNames: ['copilot', 'github copilot', 'copilot-swe-agent'],
    commitSignatureFragments: [
      'generated with github copilot',
      'generated by github copilot',
      'copilot-swe-agent',
    ],
  }),
  harness({
    id: 'claude-code',
    displayName: 'Claude Code',
    botLogins: ['claude', 'claude[bot]', 'anthropic-code-agent[bot]'],
    coAuthorFragments: ['claude', 'anthropic'],
    branchPrefixes: ['claude/', 'claude-'],
    labelNames: ['claude', 'claude code'],
    commitSignatureFragments: ['generated with claude code', 'generated by claude code'],
  }),
  harness({
    id: 'codex',
    displayName: 'OpenAI Codex',
    botLogins: ['codex[bot]', 'openai-codex[bot]'],
    coAuthorFragments: ['codex', 'openai'],
    branchPrefixes: ['codex/', 'codex-'],
    labelNames: ['codex', 'openai codex'],
    commitSignatureFragments: [
      'generated with openai codex',
      'generated by openai codex',
      'generated by codex',
      'generated with codex',
    ],
  }),
  harness({
    id: 'cursor',
    displayName: 'Cursor',
    botLogins: ['cursor[bot]'],
    coAuthorFragments: ['cursor'],
    branchPrefixes: ['cursor/', 'cursor-'],
    labelNames: ['cursor'],
    commitSignatureFragments: [],
  }),
  harness({
    id: 'aider',
    displayName: 'Aider',
    botLogins: [],
    coAuthorFragments: ['aider'],
    branchPrefixes: ['aider/', 'aider-'],
    labelNames: ['aider'],
    commitSignatureFragments: ['written by aider', 'generated by aider'],
  }),
  harness({
    id: 'devin',
    displayName: 'Devin',
    botLogins: ['devin-ai-integration[bot]', 'devin-ai[bot]'],
    coAuthorFragments: ['devin'],
    branchPrefixes: ['devin/', 'devin-'],
    labelNames: ['devin'],
    commitSignatureFragments: ['devin ai'],
  }),
  harness({
    id: 'openhands',
    displayName: 'OpenHands',
    botLogins: ['openhands-agent[bot]'],
    coAuthorFragments: ['openhands'],
    branchPrefixes: ['openhands/', 'openhands-'],
    labelNames: ['openhands'],
    commitSignatureFragments: ['openhands agent'],
  }),
  harness({
    id: 'sweep',
    displayName: 'Sweep AI',
    botLogins: ['sweep-ai[bot]'],
    coAuthorFragments: ['sweep ai'],
    branchPrefixes: [],
    labelNames: ['sweep ai'],
    commitSignatureFragments: ['sweep ai'],
  }),
  harness({
    id: 'codegen',
    displayName: 'Codegen',
    botLogins: ['codegen-sh[bot]'],
    coAuthorFragments: ['codegen'],
    branchPrefixes: [],
    labelNames: ['codegen'],
    commitSignatureFragments: ['codegen ai'],
  }),
  harness({
    id: 'swe-agent',
    displayName: 'SWE-agent',
    botLogins: [],
    coAuthorFragments: ['swe-agent'],
    branchPrefixes: ['swe-agent/', 'swe-agent-'],
    labelNames: [],
    commitSignatureFragments: [],
  }),
  harness({
    id: 'wavemill',
    displayName: 'wavemill',
    // wavemill PRs are opened from the operator's account; identification comes
    // from the first-party wavemillMeta / executedRoute signals, not heuristics.
    botLogins: [],
    coAuthorFragments: [],
    branchPrefixes: [],
    labelNames: [],
    commitSignatureFragments: [],
  }),
]);

/**
 * Generic agent markers: they establish agent-authored status but identify no
 * particular harness.
 */
export const GENERIC_AGENT_SIGNATURES = Object.freeze({
  branchPrefixes: Object.freeze(['ai-agent/', 'agent/']),
  labelNames: Object.freeze([
    'ai-generated',
    'ai generated',
    'ai-agent',
    'ai agent',
    'agent-authored',
    'agent authored',
  ]),
});

// ── Model signature table ────────────────────────────────────────────────────

export interface ModelSignature {
  /** Lowercased fragment matched by substring inclusion. */
  fragment: string;
  /** Canonical model id (model-registry vocabulary). */
  modelId: string;
}

/**
 * Conservative mapping from explicit model-version strings to canonical model
 * ids. Deliberately excludes bare product/family names ("Copilot", "Claude",
 * "GPT") - a product name identifies a harness, never a model.
 */
export const MODEL_SIGNATURES: readonly ModelSignature[] = Object.freeze([
  { fragment: 'claude-fable-5', modelId: 'claude-fable-5' },
  { fragment: 'claude fable 5', modelId: 'claude-fable-5' },
  { fragment: 'claude-opus-4-8', modelId: 'claude-opus-4-8' },
  { fragment: 'claude opus 4.8', modelId: 'claude-opus-4-8' },
  { fragment: 'claude-sonnet-5', modelId: 'claude-sonnet-5' },
  { fragment: 'claude sonnet 5', modelId: 'claude-sonnet-5' },
  { fragment: 'claude-haiku-4-5', modelId: 'claude-haiku-4-5-20251001' },
  { fragment: 'claude haiku 4.5', modelId: 'claude-haiku-4-5-20251001' },
  { fragment: 'gpt-5.6-sol', modelId: 'gpt-5.6-sol' },
  { fragment: 'gpt-5.6', modelId: 'gpt-5.6-sol' },
  { fragment: 'gpt-5.5', modelId: 'gpt-5.5' },
]);

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * Resolved attribution configuration. The `extra*` flat lists extend the
 * corresponding heuristic pools with AGENT-ONLY evidence (the operator marked
 * a signature as agent-produced without naming a harness); `extraHarnesses`
 * adds fully-identified products; `extraModelSignatures` extends the explicit
 * model-version table.
 */
export interface AttributionConfig {
  /** Coverage floor (percent, 0-100) for the survival report gates. */
  coverageFloorPercent: number;
  /** Minimum eligible PRs for a repo to count toward the feasibility gate. */
  minEligiblePrs: number;
  extraBotLogins: string[];
  extraBranchPrefixes: string[];
  extraCoAuthorFragments: string[];
  extraLabelNames: string[];
  extraCommitSignatureFragments: string[];
  extraHarnesses: HarnessDefinition[];
  extraModelSignatures: ModelSignature[];
  disabledSignals: AttributionSignal[];
}

export const DEFAULT_ATTRIBUTION_CONFIG: AttributionConfig = Object.freeze({
  coverageFloorPercent: 60,
  minEligiblePrs: 20,
  extraBotLogins: [],
  extraBranchPrefixes: [],
  extraCoAuthorFragments: [],
  extraLabelNames: [],
  extraCommitSignatureFragments: [],
  extraHarnesses: [],
  extraModelSignatures: [],
  disabledSignals: [],
});

/** Typed configuration error naming the offending field path. */
export class AttributionConfigError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`Invalid attribution config at "${field}": ${message}`);
    this.name = 'AttributionConfigError';
    this.field = field;
  }
}

const CONFIG_ARRAY_KEYS = [
  'extraBotLogins',
  'extraBranchPrefixes',
  'extraCoAuthorFragments',
  'extraLabelNames',
  'extraCommitSignatureFragments',
] as const;

const CONFIG_KEYS = new Set<string>([
  'coverageFloorPercent',
  'minEligiblePrs',
  ...CONFIG_ARRAY_KEYS,
  'extraHarnesses',
  'extraModelSignatures',
  'disabledSignals',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new AttributionConfigError(field, 'expected an array of non-empty strings');
  }
  return (value as string[]).map((item) => item.trim());
}

function parseHarnessDefinition(value: unknown, field: string): HarnessDefinition {
  if (!isPlainObject(value)) {
    throw new AttributionConfigError(field, 'expected a harness definition object');
  }
  const allowed = new Set([
    'id',
    'displayName',
    'botLogins',
    'coAuthorFragments',
    'branchPrefixes',
    'labelNames',
    'commitSignatureFragments',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new AttributionConfigError(`${field}.${key}`, 'unknown harness definition key');
    }
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new AttributionConfigError(`${field}.id`, 'expected a non-empty string');
  }
  const id = value.id.trim();
  if (value.displayName !== undefined && typeof value.displayName !== 'string') {
    throw new AttributionConfigError(`${field}.displayName`, 'expected a string');
  }
  const list = (key: Exclude<keyof HarnessDefinition, 'id' | 'displayName'>): string[] =>
    value[key] === undefined ? [] : parseStringArray(value[key], `${field}.${key}`);
  return {
    id,
    displayName: typeof value.displayName === 'string' ? value.displayName : id,
    botLogins: list('botLogins'),
    coAuthorFragments: list('coAuthorFragments'),
    branchPrefixes: list('branchPrefixes'),
    labelNames: list('labelNames'),
    commitSignatureFragments: list('commitSignatureFragments'),
  };
}

function parseModelSignature(value: unknown, field: string): ModelSignature {
  if (!isPlainObject(value)) {
    throw new AttributionConfigError(field, 'expected a { fragment, modelId } object');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'fragment' && key !== 'modelId') {
      throw new AttributionConfigError(`${field}.${key}`, 'unknown model signature key');
    }
  }
  if (typeof value.fragment !== 'string' || !value.fragment.trim()) {
    throw new AttributionConfigError(`${field}.fragment`, 'expected a non-empty string');
  }
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) {
    throw new AttributionConfigError(`${field}.modelId`, 'expected a non-empty string');
  }
  return { fragment: value.fragment.trim().toLocaleLowerCase(), modelId: value.modelId.trim() };
}

function parseConfigLayer(value: unknown, fieldPrefix: string): Partial<AttributionConfig> {
  if (!isPlainObject(value)) {
    throw new AttributionConfigError(fieldPrefix || '(root)', 'expected an object');
  }
  const layer: Partial<AttributionConfig> = {};
  const path = (key: string): string => (fieldPrefix ? `${fieldPrefix}.${key}` : key);

  for (const [key, raw] of Object.entries(value)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new AttributionConfigError(path(key), 'unknown config key');
    }
    if (key === 'coverageFloorPercent') {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) {
        throw new AttributionConfigError(path(key), 'expected a number from 0 to 100');
      }
      layer.coverageFloorPercent = raw;
    } else if (key === 'minEligiblePrs') {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        throw new AttributionConfigError(path(key), 'expected a non-negative integer');
      }
      layer.minEligiblePrs = raw;
    } else if ((CONFIG_ARRAY_KEYS as readonly string[]).includes(key)) {
      layer[key as (typeof CONFIG_ARRAY_KEYS)[number]] = parseStringArray(raw, path(key));
    } else if (key === 'extraHarnesses') {
      if (!Array.isArray(raw)) {
        throw new AttributionConfigError(path(key), 'expected an array');
      }
      layer.extraHarnesses = raw.map((item, index) =>
        parseHarnessDefinition(item, `${path(key)}[${index}]`),
      );
    } else if (key === 'extraModelSignatures') {
      if (!Array.isArray(raw)) {
        throw new AttributionConfigError(path(key), 'expected an array');
      }
      layer.extraModelSignatures = raw.map((item, index) =>
        parseModelSignature(item, `${path(key)}[${index}]`),
      );
    } else if (key === 'disabledSignals') {
      const signals = parseStringArray(raw, path(key));
      for (const signal of signals) {
        if (!(ATTRIBUTION_SIGNALS as readonly string[]).includes(signal)) {
          throw new AttributionConfigError(
            path(key),
            `unknown signal "${signal}" (expected one of: ${ATTRIBUTION_SIGNALS.join(', ')})`,
          );
        }
      }
      layer.disabledSignals = signals as AttributionSignal[];
    }
  }
  return layer;
}

function mergeConfigLayer(base: AttributionConfig, layer: Partial<AttributionConfig>): AttributionConfig {
  const dedupe = <T>(items: T[]): T[] => [...new Set(items)];
  return {
    coverageFloorPercent: layer.coverageFloorPercent ?? base.coverageFloorPercent,
    minEligiblePrs: layer.minEligiblePrs ?? base.minEligiblePrs,
    extraBotLogins: dedupe([...base.extraBotLogins, ...(layer.extraBotLogins ?? [])]),
    extraBranchPrefixes: dedupe([...base.extraBranchPrefixes, ...(layer.extraBranchPrefixes ?? [])]),
    extraCoAuthorFragments: dedupe([
      ...base.extraCoAuthorFragments,
      ...(layer.extraCoAuthorFragments ?? []),
    ]),
    extraLabelNames: dedupe([...base.extraLabelNames, ...(layer.extraLabelNames ?? [])]),
    extraCommitSignatureFragments: dedupe([
      ...base.extraCommitSignatureFragments,
      ...(layer.extraCommitSignatureFragments ?? []),
    ]),
    extraHarnesses: [...base.extraHarnesses, ...(layer.extraHarnesses ?? [])],
    extraModelSignatures: [...base.extraModelSignatures, ...(layer.extraModelSignatures ?? [])],
    disabledSignals: dedupe([...base.disabledSignals, ...(layer.disabledSignals ?? [])]),
  };
}

/**
 * Resolves an attribution config for one repository: defaults <- file-level
 * keys <- `repos["owner/name"]` overrides. Scalars replace; the `extra*` lists
 * and `disabledSignals` are additive (that is the point of per-repo extension).
 * Unknown keys anywhere raise a typed `AttributionConfigError`.
 */
export function resolveAttributionConfig(raw: unknown, repo?: string): AttributionConfig {
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_ATTRIBUTION_CONFIG };
  }
  if (!isPlainObject(raw)) {
    throw new AttributionConfigError('(root)', 'expected a JSON object');
  }

  const { repos, ...fileLevel } = raw;
  if (repos !== undefined && !isPlainObject(repos)) {
    throw new AttributionConfigError('repos', 'expected an object keyed by "owner/name"');
  }

  let config = mergeConfigLayer(DEFAULT_ATTRIBUTION_CONFIG, parseConfigLayer(fileLevel, ''));

  // Validate every per-repo section eagerly so a malformed override fails fast
  // even when scanning a different repo.
  const repoLayers = new Map<string, Partial<AttributionConfig>>();
  if (isPlainObject(repos)) {
    for (const [slug, section] of Object.entries(repos)) {
      repoLayers.set(slug, parseConfigLayer(section, `repos.${slug}`));
    }
  }

  if (repo !== undefined) {
    const layer = repoLayers.get(repo);
    if (layer) {
      config = mergeConfigLayer(config, layer);
    }
  }

  return config;
}

// ── Executed-route extraction (HOK-2945 first-party contract) ────────────────

export type RouteRole = 'planner' | 'coder' | 'reviewer';

const ROUTE_ROLES: readonly RouteRole[] = ['planner', 'coder', 'reviewer'];

export interface ExecutedRouteRoleEntry {
  status: string;
  model: string | null;
}

export interface ExtractedExecutedRoute {
  /** Stage-result head SHA the payload claims to describe, when present. */
  headSha: string | null;
  roles: Partial<Record<RouteRole, ExecutedRouteRoleEntry>>;
  /** Compact rendering used as evidence value. */
  raw: string;
}

/** The HOK-3098 `route_decision` payload, normalized to camelCase. */
export interface ExtractedRouteDecision {
  decisionId: string;
  traceId?: string;
  /** `hokusai` | `local` | `fallback` (kept as a string for forward compat). */
  source: string;
  fallbackReason?: string;
  policyVersion: string | null;
  recommended: Partial<Record<RouteRole, string>>;
  decidedAt: string | null;
  supersedes?: string;
}

interface RouteExtraction {
  route: ExtractedExecutedRoute | null;
  /** Present only for `route_schema: 2` blocks carrying `route_decision`. */
  decision: ExtractedRouteDecision | null;
  diagnostics: string[];
}

/** `route_schema` values whose `executed_route` shape the scanner reads. */
const SUPPORTED_ROUTE_SCHEMAS: ReadonlySet<string> = new Set(['1', '2']);
/** First `route_schema` that defines `route_decision`. */
const ROUTE_DECISION_MIN_SCHEMA = 2;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Leniently reads a `route_decision` payload. Only `decision_id` and `source`
 * are required; everything else degrades to null/absent so a partially
 * populated decision is still joinable.
 */
function extractRouteDecision(
  raw: string,
  routeSchema: string | null,
  diagnostics: string[],
): ExtractedRouteDecision | null {
  if (routeSchema === null || !/^\d+$/.test(routeSchema) || Number(routeSchema) < ROUTE_DECISION_MIN_SCHEMA) {
    diagnostics.push(
      `route-decision-schema-mismatch: route_decision requires route_schema >= ${ROUTE_DECISION_MIN_SCHEMA} (got ${routeSchema ?? 'none'}); ignored`,
    );
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    diagnostics.push('malformed-route-decision: route_decision is not valid single-line JSON; ignored');
    return null;
  }
  if (!isPlainObject(payload)) {
    diagnostics.push('malformed-route-decision: route_decision is not a JSON object; ignored');
    return null;
  }
  const decisionId = optionalString(payload.decision_id);
  const source = optionalString(payload.source);
  if (!decisionId || !source) {
    diagnostics.push('malformed-route-decision: route_decision lacks decision_id or source; ignored');
    return null;
  }

  const recommended: Partial<Record<RouteRole, string>> = {};
  if (isPlainObject(payload.recommended)) {
    for (const role of ROUTE_ROLES) {
      const model = optionalString(payload.recommended[role]);
      if (model) recommended[role] = model;
    }
  }
  const traceId = optionalString(payload.trace_id);
  const fallbackReason = optionalString(payload.fallback_reason);
  const supersedes = optionalString(payload.supersedes);

  return {
    decisionId,
    ...(traceId ? { traceId } : {}),
    source,
    ...(fallbackReason ? { fallbackReason } : {}),
    policyVersion: optionalString(payload.policy_version) ?? null,
    recommended,
    decidedAt: optionalString(payload.decided_at) ?? null,
    ...(supersedes ? { supersedes } : {}),
  };
}

/**
 * Leniently extracts the HOK-2945 `route_schema` / `executed_route` payload
 * and the HOK-3098 `route_decision` payload from a `wavemill-meta` block. This
 * is deliberately NOT `parsePrMetadata` (which errors on unknown fields): only
 * the contract lines are read, so unknown sibling fields never break
 * extraction. `route_schema` 1 and 2 share the `executed_route` shape.
 */
export function extractExecutedRoute(block: string): RouteExtraction {
  const diagnostics: string[] = [];
  let routeSchema: string | null = null;
  let executedRouteRaw: string | null = null;
  let routeDecisionRaw: string | null = null;

  for (const line of block.split('\n')) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const [, field, value] = match;
    if (field === 'route_schema') {
      routeSchema = value!.trim();
    } else if (field === 'executed_route') {
      executedRouteRaw = value!.trim();
    } else if (field === 'route_decision') {
      routeDecisionRaw = value!.trim();
    }
  }

  // The decision is independent of executed-route validity: a stale or
  // malformed executed_route never hides which decision the PR came from.
  const decision = routeDecisionRaw === null
    ? null
    : extractRouteDecision(routeDecisionRaw, routeSchema, diagnostics);

  if (executedRouteRaw === null) {
    return { route: null, decision, diagnostics };
  }
  if (routeSchema === null) {
    diagnostics.push('executed-route-missing-schema: executed_route present without route_schema; ignored');
    return { route: null, decision, diagnostics };
  }
  if (!SUPPORTED_ROUTE_SCHEMAS.has(routeSchema)) {
    diagnostics.push(`unsupported-route-schema: route_schema "${routeSchema}"; executed_route ignored`);
    return { route: null, decision, diagnostics };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(executedRouteRaw);
  } catch {
    diagnostics.push('malformed-executed-route: executed_route is not valid single-line JSON; ignored');
    return { route: null, decision, diagnostics };
  }
  if (!isPlainObject(payload)) {
    diagnostics.push('malformed-executed-route: executed_route is not a JSON object; ignored');
    return { route: null, decision, diagnostics };
  }

  const headShaRaw = payload.head_sha ?? payload.headSha ?? payload.head;
  const roles: Partial<Record<RouteRole, ExecutedRouteRoleEntry>> = {};
  for (const role of ROUTE_ROLES) {
    const entry = payload[role];
    if (!isPlainObject(entry) || typeof entry.status !== 'string') continue;
    const model = entry.model ?? entry.resolved_model ?? entry.resolvedModel;
    roles[role] = {
      status: entry.status,
      model: typeof model === 'string' && model.trim() ? model.trim() : null,
    };
  }

  return {
    route: {
      headSha: typeof headShaRaw === 'string' && headShaRaw.trim() ? headShaRaw.trim() : null,
      roles,
      raw: executedRouteRaw,
    },
    decision,
    diagnostics,
  };
}

// ── Attribution core ─────────────────────────────────────────────────────────

function normalized(value: string): string {
  return value.toLocaleLowerCase().trim();
}

function extractCoAuthorTrailers(message: string): string[] {
  const trailers: string[] = [];
  for (const line of message.split(/\r?\n/)) {
    const match = line.match(/^Co-authored-by:\s*(.+)$/i);
    if (match) {
      trailers.push(match[1]!.trim());
    }
  }
  return trailers;
}

/**
 * Evidence collector: dedupes on (signal, harnessId, modelId), keeping the
 * highest-tier occurrence, and preserves insertion order otherwise.
 */
class EvidenceCollector {
  private readonly byKey = new Map<string, SignalEvidence>();

  add(evidence: SignalEvidence): void {
    const key = `${evidence.signal}|${evidence.harnessId ?? ''}|${evidence.modelId ?? ''}`;
    const existing = this.byKey.get(key);
    if (!existing || TIER_RANK[evidence.tier] > TIER_RANK[existing.tier]) {
      this.byKey.set(key, evidence);
    }
  }

  all(): SignalEvidence[] {
    return [...this.byKey.values()];
  }
}

interface Candidate {
  value: string;
  tier: ConfidenceTier;
}

/**
 * Resolves an identity dimension from its pointing evidence: the unique value
 * at the highest confidence tier wins; a tie between DIFFERENT values at the
 * top tier degrades to unknown (conflicting evidence never becomes an
 * identification) and reports a diagnostic.
 */
function resolveIdentity(
  dimension: 'harness' | 'model',
  evidence: SignalEvidence[],
  diagnostics: string[],
): IdentityDimension {
  const key = dimension === 'harness' ? 'harnessId' : 'modelId';
  const pointing = evidence.filter((item) => item[key] !== undefined);
  if (pointing.length === 0) {
    return { status: 'unknown', evidence: [] };
  }

  const best = new Map<string, Candidate>();
  for (const item of pointing) {
    const value = item[key] as string;
    const existing = best.get(value);
    if (!existing || TIER_RANK[item.tier] > TIER_RANK[existing.tier]) {
      best.set(value, { value, tier: item.tier });
    }
  }

  const topRank = Math.max(...[...best.values()].map((candidate) => TIER_RANK[candidate.tier]));
  const winners = [...best.values()].filter((candidate) => TIER_RANK[candidate.tier] === topRank);

  if (winners.length > 1) {
    const values = winners.map((candidate) => candidate.value).sort().join(' vs ');
    diagnostics.push(`conflicting-${dimension}-evidence: ${values} at tier ${winners[0]!.tier}`);
    return { status: 'unknown', evidence: pointing };
  }

  return {
    status: 'identified',
    value: winners[0]!.value,
    confidence: winners[0]!.tier,
    evidence: pointing,
  };
}

/**
 * Attributes one merged PR across the three dimensions.
 *
 * Precedence per dimension: `executedRoute` (verified) outranks
 * `wavemillMeta` / bot author / trailer / commit signature (strong), which
 * outrank branch prefix / label (weak). All fired evidence is retained.
 */
export function attributePullRequest(
  pr: AttributionPrInput,
  config: AttributionConfig = DEFAULT_ATTRIBUTION_CONFIG,
): PrAttribution {
  const collector = new EvidenceCollector();
  const diagnostics: string[] = [];
  const enabled = (signal: AttributionSignal): boolean => !config.disabledSignals.includes(signal);
  const harnesses = [...HARNESS_REGISTRY, ...config.extraHarnesses];
  const modelSignatures = [...MODEL_SIGNATURES, ...config.extraModelSignatures];

  let routeDecision: ExtractedRouteDecision | null = null;

  // ── First-party wavemill signals ──
  if (pr.body) {
    const { block } = extractMetadataBlock(pr.body);
    if (block !== null) {
      if (enabled('wavemillMeta')) {
        collector.add({
          signal: 'wavemillMeta',
          value: 'wavemill-meta',
          rule: 'wavemill-meta-block-present',
          tier: SIGNAL_TIER.wavemillMeta,
          harnessId: 'wavemill',
        });
      }
      if (enabled('executedRoute')) {
        const { route, decision, diagnostics: routeDiagnostics } = extractExecutedRoute(block);
        diagnostics.push(...routeDiagnostics);
        routeDecision = decision;
        if (route) {
          if (route.headSha && pr.headSha && route.headSha !== pr.headSha) {
            // Stale evidence describes an older head; it never becomes execution.
            diagnostics.push(
              `stale-route-head: executed_route head ${route.headSha} != PR head ${pr.headSha}; route discarded`,
            );
          } else {
            const executedRoles = ROUTE_ROLES.filter(
              (role) => route.roles[role]?.status === 'executed',
            );
            if (executedRoles.length === 0) {
              diagnostics.push(
                'executed-route-no-executed-roles: no role has status "executed"; route not credited',
              );
            } else {
              const coder = route.roles.coder;
              const coderModel =
                coder?.status === 'executed' && coder.model ? coder.model : undefined;
              collector.add({
                signal: 'executedRoute',
                value: route.raw,
                rule: `executed-route:roles=${executedRoles.join(',')}`,
                tier: 'verified',
                harnessId: 'wavemill',
                ...(coderModel ? { modelId: coderModel } : {}),
              });
            }
          }
        }
      }
    }
  }

  // ── Bot author ──
  if (enabled('botAuthor') && pr.authorLogin) {
    const login = normalized(pr.authorLogin);
    const strippedBotLogin = normalized(pr.authorType ?? '') === 'bot'
      ? login.replace(/\[bot\]$/, '')
      : null;
    const matchesLogin = (candidates: string[]): string | undefined =>
      candidates.find(
        (candidate) => candidate === login || (strippedBotLogin !== null && candidate === strippedBotLogin),
      );
    for (const entry of harnesses) {
      const matched = matchesLogin(entry.botLogins.map(normalized));
      if (matched) {
        collector.add({
          signal: 'botAuthor',
          value: pr.authorLogin,
          rule: `bot-login:${matched}`,
          tier: SIGNAL_TIER.botAuthor,
          harnessId: entry.id,
        });
      }
    }
    const extraMatch = matchesLogin(config.extraBotLogins.map(normalized));
    if (extraMatch) {
      collector.add({
        signal: 'botAuthor',
        value: pr.authorLogin,
        rule: `bot-login:${extraMatch}`,
        tier: SIGNAL_TIER.botAuthor,
      });
    }
  }

  // ── Co-authored-by trailers (harness fragments + explicit model versions) ──
  if (enabled('coAuthoredBy')) {
    for (const message of pr.commitMessages) {
      for (const trailer of extractCoAuthorTrailers(message)) {
        const trailerText = normalized(trailer);
        for (const entry of harnesses) {
          const matched = entry.coAuthorFragments.find((fragment) =>
            trailerText.includes(normalized(fragment)),
          );
          if (matched) {
            collector.add({
              signal: 'coAuthoredBy',
              value: trailer,
              rule: `co-author-fragment:${normalized(matched)}`,
              tier: SIGNAL_TIER.coAuthoredBy,
              harnessId: entry.id,
            });
          }
        }
        const extraMatched = config.extraCoAuthorFragments.find((fragment) =>
          trailerText.includes(normalized(fragment)),
        );
        if (extraMatched) {
          collector.add({
            signal: 'coAuthoredBy',
            value: trailer,
            rule: `co-author-fragment:${normalized(extraMatched)}`,
            tier: SIGNAL_TIER.coAuthoredBy,
          });
        }
        for (const signature of modelSignatures) {
          if (trailerText.includes(signature.fragment)) {
            collector.add({
              signal: 'coAuthoredBy',
              value: trailer,
              rule: `model-fragment:${signature.fragment}`,
              tier: 'strong',
              modelId: signature.modelId,
            });
          }
        }
      }
    }
  }

  // ── Branch prefix ──
  if (enabled('branchPrefix') && pr.headRef) {
    const headRef = normalized(pr.headRef);
    for (const entry of harnesses) {
      const matched = entry.branchPrefixes.find((prefix) => headRef.startsWith(normalized(prefix)));
      if (matched) {
        collector.add({
          signal: 'branchPrefix',
          value: pr.headRef,
          rule: `branch-prefix:${normalized(matched)}`,
          tier: SIGNAL_TIER.branchPrefix,
          harnessId: entry.id,
        });
      }
    }
    const generic = [...GENERIC_AGENT_SIGNATURES.branchPrefixes, ...config.extraBranchPrefixes].find(
      (prefix) => headRef.startsWith(normalized(prefix)),
    );
    if (generic) {
      collector.add({
        signal: 'branchPrefix',
        value: pr.headRef,
        rule: `branch-prefix:${normalized(generic)}`,
        tier: SIGNAL_TIER.branchPrefix,
      });
    }
  }

  // ── Label ──
  if (enabled('label')) {
    for (const label of pr.labels) {
      const labelName = normalized(label);
      for (const entry of harnesses) {
        const matched = entry.labelNames.find((candidate) => labelName === normalized(candidate));
        if (matched) {
          collector.add({
            signal: 'label',
            value: label,
            rule: `label:${normalized(matched)}`,
            tier: SIGNAL_TIER.label,
            harnessId: entry.id,
          });
        }
      }
      const generic = [...GENERIC_AGENT_SIGNATURES.labelNames, ...config.extraLabelNames].find(
        (candidate) => labelName === normalized(candidate),
      );
      if (generic) {
        collector.add({
          signal: 'label',
          value: label,
          rule: `label:${normalized(generic)}`,
          tier: SIGNAL_TIER.label,
        });
      }
    }
  }

  // ── Commit signatures (harness fragments + weak model-version fragments) ──
  if (enabled('commitSignature')) {
    for (const message of pr.commitMessages) {
      const messageText = normalized(message);
      for (const entry of harnesses) {
        const matched = entry.commitSignatureFragments.find((fragment) =>
          messageText.includes(normalized(fragment)),
        );
        if (matched) {
          collector.add({
            signal: 'commitSignature',
            value: normalized(matched),
            rule: `commit-signature:${normalized(matched)}`,
            tier: SIGNAL_TIER.commitSignature,
            harnessId: entry.id,
          });
        }
      }
      const extraMatched = config.extraCommitSignatureFragments.find((fragment) =>
        messageText.includes(normalized(fragment)),
      );
      if (extraMatched) {
        collector.add({
          signal: 'commitSignature',
          value: normalized(extraMatched),
          rule: `commit-signature:${normalized(extraMatched)}`,
          tier: SIGNAL_TIER.commitSignature,
        });
      }
      for (const signature of modelSignatures) {
        if (messageText.includes(signature.fragment)) {
          collector.add({
            signal: 'commitSignature',
            value: signature.fragment,
            rule: `model-fragment:${signature.fragment}`,
            tier: 'weak',
            modelId: signature.modelId,
          });
        }
      }
    }
  }

  const evidence = collector.all();
  const signals = [...new Set(evidence.map((item) => item.signal))];

  const agentTier = evidence.reduce<ConfidenceTier | undefined>(
    (bestTier, item) =>
      bestTier === undefined || TIER_RANK[item.tier] > TIER_RANK[bestTier] ? item.tier : bestTier,
    undefined,
  );

  return {
    number: pr.number,
    mergedAt: pr.mergedAt,
    signals,
    agent:
      evidence.length > 0
        ? { status: 'agent', ...(agentTier ? { confidence: agentTier } : {}), evidence }
        : { status: 'unknown', evidence: [] },
    harness: resolveIdentity('harness', evidence, diagnostics),
    model: resolveIdentity('model', evidence, diagnostics),
    ...(routeDecision ? { routeDecision } : {}),
    diagnostics,
  };
}

