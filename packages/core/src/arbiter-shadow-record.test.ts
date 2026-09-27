/**
 * Tests for arbiter-shadow-record contracts and validators.
 */

import { describe, it, expect } from 'vitest';
import {
  ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
  ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION,
  ARBITER_SHADOW_STATE_SCHEMA_VERSION,
  ARBITER_SHADOW_FORBIDDEN_KEYS,
  validateShadowScoreRow,
  validateShadowOutcomeRow,
  validateShadowState,
  initialShadowState,
} from './arbiter-shadow-record.js';
import { ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION } from './arbiter-survival-label.js';
import { completeCandidateFeaturesV1Fixture } from './fixtures/candidate-features.js';

const VALID_FEATURES = completeCandidateFeaturesV1Fixture;

const VALID_LABEL = {
  schema_version: ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
  prUrl: 'https://github.com/owner/repo/pull/123',
  horizon_days: 30 as const,
  label_provenance: 'harvested' as const,
  outcome: {
    survived: true,
    survival_ratio: 0.95,
    reverted: false,
    undone_by: null,
    followup: false,
    report_outcome: 'survived',
    reason_codes: ['no_evidence'],
  },
  envelope: {
    labeller_version: '1.0.0',
    normalization_version: '1.0.0',
    pr_head_sha: 'a'.repeat(40),
    merge_sha: 'b'.repeat(40),
    horizon_terminal_sha: 'c'.repeat(40),
    integration_branch: 'auto/integration',
    computed_at: '2025-01-01T00:00:00Z',
  },
};

describe('arbiter-shadow-record validators', () => {
  describe('validateShadowScoreRow', () => {
    it('accepts a valid score row', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.75,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(row);
      }
    });

    it('rejects wrong schema_version', () => {
      const row = {
        schema_version: 'arbiter_shadow_score/v0',
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.75,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path === 'schema_version')).toBe(true);
      }
    });

    it('rejects score outside [0, 1]', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 1.2,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path === 'score')).toBe(true);
      }
    });

    it('rejects NaN score', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: Number.NaN,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path === 'score')).toBe(true);
      }
    });

    it('rejects non-40-hex merge_sha', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'abc123',
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.75,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path === 'merge_sha')).toBe(true);
      }
    });

    it('rejects would_flag inconsistent with score < threshold', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.6,
        threshold: 0.5,
        would_flag: true,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path === 'would_flag')).toBe(true);
      }
    });

    it('accepts score == threshold when would_flag is false', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.5,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(true);
    });

    it('rejects forbidden key in features', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.75,
        threshold: 0.5,
        would_flag: false,
        features: {
          ...VALID_FEATURES,
          diff: 'some diff content',
        },
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path.includes('diff'))).toBe(true);
      }
    });

    it('rejects nested forbidden key', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.75,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
        extra_nested: {
          author_email: 'leak@example.com',
        },
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path.includes('author_email'))).toBe(true);
      }
    });

    it('accepts pr_number null', () => {
      const row = {
        schema_version: ARBITER_SHADOW_SCORE_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: null,
        merge_sha: 'a'.repeat(40),
        merged_at: '2025-01-01T00:00:00Z',
        scored_at: '2025-01-01T01:00:00Z',
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
        score: 0.75,
        threshold: 0.5,
        would_flag: false,
        features: VALID_FEATURES,
      };

      const result = validateShadowScoreRow(row);
      expect(result.ok).toBe(true);
    });
  });

  describe('validateShadowOutcomeRow', () => {
    it('accepts a valid outcome row', () => {
      const row = {
        schema_version: ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'b'.repeat(40),
        horizon_days: 30 as const,
        labelled_at: '2025-01-31T00:00:00Z',
        survived: true,
        label: VALID_LABEL,
      };

      const result = validateShadowOutcomeRow(row);
      expect(result.ok).toBe(true);
    });

    it('rejects outcome with line_ranges', () => {
      const rowLabel = {
        ...VALID_LABEL,
        line_ranges: [
          {
            path: 'src/foo.ts',
            old: { start: 1, end: 5, sha: 'a'.repeat(40) },
            new: { start: 1, end: 6, sha: 'b'.repeat(40) },
          },
        ],
      };

      const row = {
        schema_version: ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'b'.repeat(40),
        horizon_days: 30 as const,
        labelled_at: '2025-01-31T00:00:00Z',
        survived: true,
        label: rowLabel,
      };

      const result = validateShadowOutcomeRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path.includes('line_ranges'))).toBe(true);
      }
    });

    it('rejects survived mismatch', () => {
      const row = {
        schema_version: ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'b'.repeat(40),
        horizon_days: 30 as const,
        labelled_at: '2025-01-31T00:00:00Z',
        survived: false,
        label: VALID_LABEL,
      };

      const result = validateShadowOutcomeRow(row);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path.includes('survived'))).toBe(true);
      }
    });

    it('accepts survived null', () => {
      const labelWithNullSurvived = {
        ...VALID_LABEL,
        outcome: {
          ...VALID_LABEL.outcome,
          survived: null,
          survival_ratio: null,
          reverted: null,
          followup: null,
          report_outcome: null,
          reason_codes: ['missing_horizon'],
        },
      };

      const row = {
        schema_version: ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION,
        repo: 'owner/repo',
        pr_number: 123,
        merge_sha: 'b'.repeat(40),
        horizon_days: 30 as const,
        labelled_at: '2025-01-31T00:00:00Z',
        survived: null,
        label: labelWithNullSurvived,
      };

      const result = validateShadowOutcomeRow(row);
      expect(result.ok).toBe(true);
    });
  });

  describe('validateShadowState', () => {
    it('accepts a valid state', () => {
      const state = {
        schema_version: ARBITER_SHADOW_STATE_SCHEMA_VERSION,
        repo: 'owner/repo',
        last_seen_merge_sha: 'a'.repeat(40),
        last_run_at: '2025-01-01T00:00:00Z',
        last_run_status: 'ok' as const,
        last_error_code: null,
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
      };

      const result = validateShadowState(state);
      expect(result.ok).toBe(true);
    });

    it('rejects invalid run_status', () => {
      const state = {
        schema_version: ARBITER_SHADOW_STATE_SCHEMA_VERSION,
        repo: 'owner/repo',
        last_seen_merge_sha: null,
        last_run_at: null,
        last_run_status: 'invalid',
        last_error_code: null,
        scorer_id: 'baseline-v0',
        scorer_version: '0.1.0',
      };

      const result = validateShadowState(state);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.path === 'last_run_status')).toBe(true);
      }
    });
  });

  describe('initialShadowState', () => {
    it('creates initial state with null cursor', () => {
      const state = initialShadowState('owner/repo', 'baseline-v0', '0.1.0');

      expect(state.repo).toBe('owner/repo');
      expect(state.last_seen_merge_sha).toBe(null);
      expect(state.last_run_at).toBe(null);
      expect(state.last_run_status).toBe('ok');
      expect(state.last_error_code).toBe(null);
      expect(state.scorer_id).toBe('baseline-v0');
      expect(state.scorer_version).toBe('0.1.0');
    });
  });

  describe('forbidden keys', () => {
    it('includes all core raw-content names', () => {
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('rawTaskText')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('rawCode')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('rawLog')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('prompt')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('rawPrompt')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('rawContent')).toBe(true);
    });

    it('includes additional privacy keys', () => {
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('diff')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('patch')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('body')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('title')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('commit_message')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('author_email')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('author_name')).toBe(true);
    });

    it('includes outcome-specific privacy keys', () => {
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('line_ranges')).toBe(true);
      expect(ARBITER_SHADOW_FORBIDDEN_KEYS.has('path')).toBe(true);
    });
  });
});
