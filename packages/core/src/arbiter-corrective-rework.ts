/**
 * Arbiter corrective-rework contract (HOK-3267, definition cr-0.1.0).
 *
 * S2 survival labels say a PR's lines were touched again; this contract says
 * whether that follow-up work was a *fix*. Three record types share one
 * versioned schema, discriminated by `record_type`:
 *
 * - `candidate` — every fix→original link a proxy proposed, accepted or
 *   rejected. Rejected candidates are retained with an exclusion code so the
 *   false-positive taxonomy is measured, not asserted (HOK-3048).
 * - `repair_pair` — one per accepted candidate: the original→fix pair and
 *   the delta between them (HOK-3046). The corrective boolean is derived from
 *   these, never recomputed by a separate path.
 * - `corrective` — one per (prUrl, horizon_days): whether an accepted repair
 *   pair's fix merged within the horizon. Linked to its S2 row by
 *   `base_label_hash`; never edits S2 rows.
 *
 * No raw content (titles, bodies, diffs) is ever carried — only typed codes,
 * identifiers (URLs, SHAs), repo paths and counts (decision-record §4.3).
 *
 * Sources of truth:
 * - Validation: `packages/core/schemas/arbiter-corrective-rework.schema.json`
 *   (mirrored as {@link ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA}; the
 *   contract test fails when the two drift)
 * - Producer: the `@hokusai/scan` corrective labeller (`corpus-corrective`)
 * - Contract doc: `docs/arbiter/corrective-rework-contract.md`
 *
 * Any change to this module or the schema requires a bump of
 * {@link ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION}. Changes to which proxies
 * are admitted or how they are scored bump
 * {@link CORRECTIVE_REWORK_DEFINITION_VERSION} instead.
 *
 * This module is contract-only: detection and linkage live in `@hokusai/scan`.
 */

import { createHash } from 'node:crypto';
import type { HorizonDays, LabelProvenance } from './arbiter-survival-label.js';

/** Wire-contract version. Bump for ANY field/semantics change, however small. */
export const ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION = '1.1.0';

/**
 * Version of the corrective-rework *definition*: which proxies are admitted
 * and at what confidence. cr-0.1.0 is HOK-3020 (R7)'s starting proposal;
 * calibration (HOK-3269) produces cr-0.2.0.
 */
export const CORRECTIVE_REWORK_DEFINITION_VERSION = 'cr-0.1.0';

export type CorrectiveRecordType = 'candidate' | 'repair_pair' | 'corrective';

/**
 * Fix-event proxies, in precision order.
 * `revert` (P1) — the fix reverts the original, wholly or partly.
 * `repair_reference` (P2) — the fix cites the original and carries a fix signal.
 * `szz` (P3) — the fix closes a bug/regression issue and blame on its deleted
 *   or modified lines lands in the original.
 * `regression_issue` (P4) — a regression/incident issue links the two.
 * `abnormal_churn` (P5) — recorded only; never accepted under cr-0.1.0.
 */
export const CORRECTIVE_PROXIES = [
  'revert',
  'repair_reference',
  'szz',
  'regression_issue',
  'abnormal_churn',
] as const;
export type CorrectiveProxy = (typeof CORRECTIVE_PROXIES)[number];

export type CorrectiveConfidence = 'high' | 'medium' | 'low';

/** Confidence tier each proxy carries under {@link CORRECTIVE_REWORK_DEFINITION_VERSION}. */
export const PROXY_CONFIDENCE: Readonly<Record<CorrectiveProxy, CorrectiveConfidence>> = Object.freeze({
  revert: 'high',
  repair_reference: 'high',
  szz: 'medium',
  regression_issue: 'medium',
  abnormal_churn: 'low',
});

/** Proxies admitted as positives under cr-0.1.0. `abnormal_churn` stays disabled until calibration admits it. */
export const ADMITTED_PROXIES = ['revert', 'repair_reference', 'szz', 'regression_issue'] as const satisfies readonly CorrectiveProxy[];

/**
 * Why a candidate was rejected. The first six are the shared human taxonomy
 * (HOK-3048; HOK-3269 labels with the same codes). The rest are applied
 * automatically before acceptance.
 */
export const EXCLUSION_CODES = [
  'planned_iteration',
  'requirement_change',
  'unrelated_edit',
  'refactor',
  'revert_non_defect',
  'linkage_error',
  // automatic
  'backport',
  'revert_of_revert',
  'dependency_bot',
  'fix_too_large',
  'proxy_disabled',
] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];

/** Typed evidence behind a candidate. `ref` is a URL, SHA or label name — never free text. */
export const EVIDENCE_KINDS = [
  'revert_message',
  'reverts_pr_reference',
  'cites_original_pr',
  'cites_original_sha',
  'fix_label',
  'fix_title_prefix',
  'regression_in_marker',
  'closes_issue_citing_original',
  'closes_bug_issue',
  'blamed_lines',
  'regression_issue_label',
  /** On a revert: the class of reason a merge bot recorded ({@link REVERT_REASON_CLASSES}); the reason text itself is never stored. */
  'revert_reason',
] as const;

/**
 * Why a revert happened, from the reason a merge bot records. Kept so the
 * definition can include or exclude classes without re-running detection
 * (HOK-3269 decides, e.g., whether internal-build breakage is a defect).
 */
export const REVERT_REASON_CLASSES = ['public_ci', 'internal_build', 'autorevert', 'collateral', 'other', 'unstated'] as const;
export type RevertReasonClass = (typeof REVERT_REASON_CLASSES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface CandidateEvidence {
  kind: EvidenceKind;
  ref: string | null;
  /** Non-negative count where the kind is countable (e.g. blamed lines), else null. */
  count: number | null;
}

/** The original (labelled) PR. */
export interface OriginalChangeRef {
  pr_url: string;
  /** Integration-branch commit that landed it (same as the S2 envelope's merge_sha). */
  merge_sha: string;
  merged_at: string;
}

/** The fix. A direct push has no PR, so `pr_url` may be null; `sha` is the integration-branch commit that landed it. */
export interface FixChangeRef {
  pr_url: string | null;
  sha: string;
  merged_at: string;
}

export interface CorrectiveEnvelope {
  /** Equals {@link ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION} at emit time (and the top-level schema_version). */
  schema_version: string;
  definition_version: string;
  labeller_version: string;
  integration_branch: string;
  /** Corpus cut-off (ISO-8601 UTC): no fix after this is considered. */
  as_of: string;
  computed_at: string;
}

export interface CorrectiveCandidateV1 {
  schema_version: string;
  record_type: 'candidate';
  /** {@link correctiveCandidateId} of (original, fix, proxy). */
  candidate_id: string;
  original: OriginalChangeRef;
  fix: FixChangeRef;
  /** fix.merged_at − original.merged_at, in seconds; positive. */
  lag_seconds: number;
  proxy: CorrectiveProxy;
  confidence: CorrectiveConfidence;
  /** Non-empty. */
  evidence: CandidateEvidence[];
  status: 'accepted' | 'rejected';
  /** Null iff status is `accepted`. */
  exclusion_code: ExclusionCode | null;
  envelope: CorrectiveEnvelope;
}

export interface RepairPairFiles {
  original: string[];
  fix: string[];
  /** fix − original: where the repair reached beyond the original change. */
  fix_only: string[];
  /** original − fix. */
  original_only: string[];
  /** Fix files that already existed at original.merge_sha. */
  fix_preexisting: string[];
}

export interface RepairPairTestDelta {
  added: number;
  modified: number;
  deleted: number;
}

/** Review metadata on the original PR. Null fields mean not collected, never "none". */
export interface OriginalReview {
  reviewed: boolean | null;
  review_count: number | null;
  reviewer_count: number | null;
  first_review_latency_seconds: number | null;
}

export interface RepairPairV1 {
  schema_version: string;
  record_type: 'repair_pair';
  /** The accepted candidate this pair materializes. */
  candidate_id: string;
  original: OriginalChangeRef;
  fix: FixChangeRef;
  lag_seconds: number;
  proxy: CorrectiveProxy;
  confidence: CorrectiveConfidence;
  files: RepairPairFiles;
  /** Fraction 0.0–1.0 of the original's added lines still present in the fix's parent tree; null when unmeasurable. */
  line_survival: number | null;
  /** Test-file changes in the fix. */
  fix_tests: RepairPairTestDelta;
  original_review: OriginalReview;
  /** Structural distance between fix-only and original files; null until backfilled from a structural index. */
  graph_distance: number | null;
  envelope: CorrectiveEnvelope;
}

/**
 * Reason codes on a corrective row: the proxies of the accepted pairs within
 * the horizon, or exactly one of `no_accepted_fix` / `base_label_missing`.
 */
export const CORRECTIVE_REASON_CODES = [...ADMITTED_PROXIES, 'no_accepted_fix', 'base_label_missing'] as const;
export type CorrectiveReasonCode = (typeof CORRECTIVE_REASON_CODES)[number];

export interface CorrectiveReworkLabelV1 {
  schema_version: string;
  record_type: 'corrective';
  prUrl: string;
  horizon_days: HorizonDays;
  label_provenance: LabelProvenance;
  /** S2 `canonicalHash` of the survival label this row derives from. */
  base_label_hash: string;
  /** Null iff the S2 base label is missing (report_outcome null). */
  corrective: boolean | null;
  /** Highest confidence among `repair_pair_ids`; null unless corrective. */
  confidence: CorrectiveConfidence | null;
  reason_codes: CorrectiveReasonCode[];
  /** candidate_ids of accepted repair pairs whose fix merged within (merge, merge + horizon]; sorted. */
  repair_pair_ids: string[];
  envelope: CorrectiveEnvelope;
}

export type ArbiterCorrectiveReworkRecordV1 = CorrectiveCandidateV1 | RepairPairV1 | CorrectiveReworkLabelV1;

/**
 * Stable identity of a candidate across runs and definition versions: SHA-256
 * (lowercase hex) of original PR URL, fix identity (PR URL, else SHA) and proxy.
 */
export function correctiveCandidateId(original: Pick<OriginalChangeRef, 'pr_url'>, fix: Pick<FixChangeRef, 'pr_url' | 'sha'>, proxy: CorrectiveProxy): string {
  return createHash('sha256')
    .update([original.pr_url, fix.pr_url ?? fix.sha, proxy].join('\0'), 'utf-8')
    .digest('hex');
}

const CONFIDENCE_RANK: Record<CorrectiveConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Inputs to {@link deriveCorrectiveLabel}: the S2 base plus the original's accepted pairs. */
export interface DeriveCorrectiveInput {
  prUrl: string;
  horizon_days: HorizonDays;
  base_label_hash: string;
  /** False when the S2 base label's report_outcome is null. */
  base_label_present: boolean;
  /** Accepted repair pairs whose original is `prUrl`, any lag. */
  repair_pairs: readonly Pick<RepairPairV1, 'candidate_id' | 'lag_seconds' | 'proxy' | 'confidence' | 'original'>[];
  envelope: Omit<CorrectiveEnvelope, 'schema_version'>;
}

/**
 * Derive a corrective row from accepted repair pairs. The original is
 * corrective at horizon H iff an admitted pair's fix merged in
 * (merge, merge + H days]. Pure and deterministic.
 */
export function deriveCorrectiveLabel(input: DeriveCorrectiveInput): CorrectiveReworkLabelV1 {
  const envelope: CorrectiveEnvelope = { ...input.envelope, schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION };
  const base = {
    schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
    record_type: 'corrective' as const,
    prUrl: input.prUrl,
    horizon_days: input.horizon_days,
    label_provenance: 'harvested' as const,
    base_label_hash: input.base_label_hash,
  };
  if (!input.base_label_present) {
    return { ...base, corrective: null, confidence: null, reason_codes: ['base_label_missing'], repair_pair_ids: [], envelope };
  }
  const horizonSeconds = input.horizon_days * 86_400;
  const admitted = new Set<string>(ADMITTED_PROXIES);
  const within = input.repair_pairs.filter(
    (p) => p.original.pr_url === input.prUrl && admitted.has(p.proxy) && p.lag_seconds > 0 && p.lag_seconds <= horizonSeconds,
  );
  if (within.length === 0) {
    return { ...base, corrective: false, confidence: null, reason_codes: ['no_accepted_fix'], repair_pair_ids: [], envelope };
  }
  const confidence = within.reduce<CorrectiveConfidence>(
    (best, p) => (CONFIDENCE_RANK[p.confidence] > CONFIDENCE_RANK[best] ? p.confidence : best),
    'low',
  );
  const proxies = new Set(within.map((p) => p.proxy));
  return {
    ...base,
    corrective: true,
    confidence,
    reason_codes: ADMITTED_PROXIES.filter((p) => proxies.has(p)),
    repair_pair_ids: [...new Set(within.map((p) => p.candidate_id))].sort(),
    envelope,
  };
}
