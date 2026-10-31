/**
 * Checked-in fixtures for the Arbiter corrective-rework contract: one
 * accepted and one rejected candidate, the repair pair the accepted one
 * materializes, and corrective rows derived through the real
 * {@link deriveCorrectiveLabel} so fixtures and derivation cannot drift.
 * The corrective rows point at the S2 harvested fixture by canonical hash.
 * Values are frozen; changing any of them is a contract change.
 */

import {
  ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  CORRECTIVE_REWORK_DEFINITION_VERSION,
  correctiveCandidateId,
  deriveCorrectiveLabel,
  type CorrectiveCandidateV1,
  type CorrectiveEnvelope,
  type CorrectiveReworkLabelV1,
  type FixChangeRef,
  type OriginalChangeRef,
  type RepairPairV1,
} from '../arbiter-corrective-rework.js';
import { canonicalHash } from '../arbiter-survival-label.js';
import { harvestedSurvivalLabelFixture } from './arbiter-survival-label.js';

const ENVELOPE: CorrectiveEnvelope = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  definition_version: CORRECTIVE_REWORK_DEFINITION_VERSION,
  labeller_version: '1.0.0',
  integration_branch: 'auto/integration',
  as_of: '2026-10-20T00:00:00Z',
  computed_at: '2026-10-28T00:00:00Z',
};

const ORIGINAL: OriginalChangeRef = {
  pr_url: harvestedSurvivalLabelFixture.prUrl,
  merge_sha: harvestedSurvivalLabelFixture.envelope.merge_sha,
  merged_at: '2026-09-01T00:00:00Z',
};

/** Merged 3 days after the original. */
const FIX: FixChangeRef = {
  pr_url: 'https://github.com/example-org/example-repo/pull/131',
  sha: 'e'.repeat(40),
  merged_at: '2026-09-04T00:00:00Z',
};

/** Merged 5 days after the original; rejected as a backport. */
const BACKPORT: FixChangeRef = {
  pr_url: 'https://github.com/example-org/example-repo/pull/140',
  sha: 'f'.repeat(40),
  merged_at: '2026-09-06T00:00:00Z',
};

export const acceptedCorrectiveCandidateFixture: CorrectiveCandidateV1 = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  record_type: 'candidate',
  candidate_id: correctiveCandidateId(ORIGINAL, FIX, 'repair_reference'),
  original: ORIGINAL,
  fix: FIX,
  lag_seconds: 3 * 86_400,
  proxy: 'repair_reference',
  confidence: 'high',
  evidence: [
    { kind: 'cites_original_pr', ref: ORIGINAL.pr_url, count: null },
    { kind: 'regression_in_marker', ref: null, count: null },
  ],
  status: 'accepted',
  exclusion_code: null,
  envelope: ENVELOPE,
};

export const rejectedCorrectiveCandidateFixture: CorrectiveCandidateV1 = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  record_type: 'candidate',
  candidate_id: correctiveCandidateId(ORIGINAL, BACKPORT, 'revert'),
  original: ORIGINAL,
  fix: BACKPORT,
  lag_seconds: 5 * 86_400,
  proxy: 'revert',
  confidence: 'high',
  evidence: [{ kind: 'revert_message', ref: ORIGINAL.merge_sha, count: null }],
  status: 'rejected',
  exclusion_code: 'backport',
  envelope: ENVELOPE,
};

export const repairPairFixture: RepairPairV1 = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  record_type: 'repair_pair',
  candidate_id: acceptedCorrectiveCandidateFixture.candidate_id,
  original: ORIGINAL,
  fix: FIX,
  lag_seconds: 3 * 86_400,
  proxy: 'repair_reference',
  confidence: 'high',
  files: {
    original: ['src/module.ts', 'src/new-module.ts'],
    fix: ['src/caller.ts', 'src/module.ts', 'test/module.test.ts'],
    fix_only: ['src/caller.ts', 'test/module.test.ts'],
    original_only: ['src/new-module.ts'],
    fix_preexisting: ['src/caller.ts', 'src/module.ts'],
  },
  line_survival: 0.8,
  fix_tests: { added: 1, modified: 0, deleted: 0 },
  original_review: { reviewed: true, review_count: 2, reviewer_count: 1, first_review_latency_seconds: 3_600 },
  graph_distance: null,
  envelope: ENVELOPE,
};

const DERIVE_BASE = {
  prUrl: ORIGINAL.pr_url,
  base_label_hash: canonicalHash(harvestedSurvivalLabelFixture),
  repair_pairs: [repairPairFixture],
  envelope: {
    definition_version: ENVELOPE.definition_version,
    labeller_version: ENVELOPE.labeller_version,
    integration_branch: ENVELOPE.integration_branch,
    as_of: ENVELOPE.as_of,
    computed_at: ENVELOPE.computed_at,
  },
};

/** The fix merged 3 days in, so the 14-day row is corrective. */
export const correctiveTrueFixture: CorrectiveReworkLabelV1 = deriveCorrectiveLabel({
  ...DERIVE_BASE,
  horizon_days: 14,
  base_label_present: true,
});

/** No accepted pair applies: the original's only pair is dropped here to show a negative. */
export const correctiveFalseFixture: CorrectiveReworkLabelV1 = deriveCorrectiveLabel({
  ...DERIVE_BASE,
  horizon_days: 30,
  base_label_present: true,
  repair_pairs: [],
});

/** The S2 base label is missing, so corrective is never imputed. */
export const correctiveMissingFixture: CorrectiveReworkLabelV1 = deriveCorrectiveLabel({
  ...DERIVE_BASE,
  horizon_days: 60,
  base_label_present: false,
});
