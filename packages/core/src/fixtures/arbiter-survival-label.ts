/**
 * Checked-in round-trip fixture pair for the Arbiter S2 survival label
 * contract. This is the lingua franca the `Hokusai/hokusai-data-pipeline`
 * repo copies into its own consumer tests, materialized through the real
 * {@link buildArbiterSurvivalLabel} builder so fixtures and builder cannot
 * drift apart. Values are frozen; changing any of them is a contract change.
 */

import {
  buildArbiterSurvivalLabel,
  canonicalHash,
  type ArbiterSurvivalLabelV1,
  type LineRange,
} from '../arbiter-survival-label.js';

const SHA_PR_HEAD = 'a'.repeat(40);
const SHA_BASE = 'b'.repeat(40);
const SHA_MERGE = 'c'.repeat(40);
const SHA_TERMINAL = 'd'.repeat(40);

/** Two representative normalized ranges: an edit and a pure addition. */
export function survivalLabelFixtureLineRanges(): LineRange[] {
  return [
    {
      path: 'src/module.ts',
      old: { start: 10, end: 24, sha: SHA_BASE },
      new: { start: 10, end: 30, sha: SHA_PR_HEAD },
    },
    {
      path: 'src/new-file.ts',
      old: null,
      new: { start: 1, end: 42, sha: SHA_PR_HEAD },
    },
  ];
}

/** Automatically harvested `survived` label. */
export const harvestedSurvivalLabelFixture: ArbiterSurvivalLabelV1 =
  buildArbiterSurvivalLabel({
    prUrl: 'https://github.com/example-org/example-repo/pull/123',
    horizon_days: 30,
    label_provenance: 'harvested',
    line_ranges: survivalLabelFixtureLineRanges(),
    outcome: {
      survived: true,
      survival_ratio: 1,
      reverted: false,
      undone_by: null,
      followup: false,
      reason_codes: ['no_evidence'],
    },
    envelope: {
      labeller_version: '0.1.0',
      normalization_version: '1.0.0',
      pr_head_sha: SHA_PR_HEAD,
      merge_sha: SHA_MERGE,
      horizon_terminal_sha: SHA_TERMINAL,
      integration_branch: 'auto/integration',
      computed_at: '2026-09-08T00:00:00Z',
    },
  });

/**
 * Tier-2b correction superseding {@link harvestedSurvivalLabelFixture} by
 * canonical hash — the pipeline joins on `supersedes.label_hash`.
 */
export const ownerCorrectedSurvivalLabelFixture: ArbiterSurvivalLabelV1 =
  buildArbiterSurvivalLabel({
    prUrl: 'https://github.com/example-org/example-repo/pull/123',
    horizon_days: 30,
    label_provenance: 'owner_corrected',
    line_ranges: survivalLabelFixtureLineRanges(),
    outcome: {
      survived: false,
      survival_ratio: 0.6,
      reverted: false,
      undone_by: 'human',
      followup: true,
      reason_codes: ['line_range_followup'],
    },
    envelope: {
      labeller_version: '0.1.0',
      normalization_version: '1.0.0',
      pr_head_sha: SHA_PR_HEAD,
      merge_sha: SHA_MERGE,
      horizon_terminal_sha: SHA_TERMINAL,
      integration_branch: 'auto/integration',
      computed_at: '2026-09-09T12:00:00Z',
    },
    owner_correction: {
      supersedes: {
        schema_version: '1.0.0',
        computed_at: '2026-09-08T00:00:00Z',
        label_hash: canonicalHash(harvestedSurvivalLabelFixture),
      },
      correction: {
        reason_code: 'owner_dispute',
        corrected_by: 'owner:example',
        corrected_at: '2026-09-09T12:00:00Z',
        previous_report_outcome: 'survived',
        note: 'Follow-up PR #130 rewrote the labelled ranges; the harvested label missed it.',
      },
    },
  });
