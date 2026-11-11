import { REWORK_RISK_FEATURE_MANIFEST, validateFeatureColumns } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import type { CorpusPrRecord } from './enumerate.js';
import { MANIFEST_COLUMNS, bodyAt, extractPrFeatures, labelsAt, reviewsAt, titleAt, truncateEvidenceAt, type PrEvidence } from './features.js';

const AS_OF = '2026-01-10T12:00:00Z';
const BEFORE = '2026-01-10T09:00:00Z';
const AFTER = '2026-01-11T09:00:00Z';

const record = {
  repo: 'org/repo', pr_number: 7, pr_url: 'https://github.com/org/repo/pull/7', merged_at: AS_OF, base_ref: 'main', head_sha: 'h', merge_sha: 'm', base_sha: 'b',
  member_commits: 1, landed_by: 'squash', batched: false, relanded_merge_shas: [], author_login: 'dev', author_type: 'User', labels: [], closing_issues: [],
} as unknown as CorpusPrRecord;

const evidence: PrEvidence = {
  pr_number: 7,
  created_at: '2026-01-10T06:00:00Z',
  merged_at: AS_OF,
  title: 'renamed after merge',
  body: 'edited after merge',
  head_ref: 'fix-thing',
  reviews: [
    { id: 'r1', state: 'DISMISSED', submitted_at: '2026-01-10T08:00:00Z', author: 'alice' },
    { id: 'r2', state: 'APPROVED', submitted_at: BEFORE, author: 'bob' },
    { id: 'r3', state: 'APPROVED', submitted_at: AFTER, author: 'carol' },
    { id: 'r4', state: 'PENDING', submitted_at: null, author: 'dan' },
  ],
  dismissals: [{ at: AFTER, previous_state: 'CHANGES_REQUESTED', review_id: 'r1' }],
  label_events: [
    { at: BEFORE, action: 'added', label: 'bug' },
    { at: BEFORE, action: 'added', label: 'ui' },
    { at: '2026-01-10T10:00:00Z', action: 'removed', label: 'ui' },
    { at: AFTER, action: 'added', label: 'regression' },
    { at: AFTER, action: 'removed', label: 'bug' },
  ],
  renames: [
    { at: BEFORE, from: 'first', to: 'at merge' },
    { at: AFTER, from: 'at merge', to: 'renamed after merge' },
  ],
  body_edits: [
    { at: AFTER, body: 'edited after merge' },
    { at: BEFORE, body: 'body at merge' },
    { at: evidenceCreated(), body: 'original' },
  ],
  commits: [{ oid: 'c1', message: 'Fix\n\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>', author_name: 'Dev', author_email: 'dev@example.com', author_login: 'dev' }],
};

function evidenceCreated(): string {
  return '2026-01-10T06:00:00Z';
}

const extract = (value: PrEvidence | null, ci: Parameters<typeof extractPrFeatures>[0]['ci'] = null) => extractPrFeatures({ record, evidence: value, ci, git: {} });

describe('state at as_of', () => {
  it('replays titles, bodies, labels and reviews rather than reading current state', () => {
    expect(titleAt(evidence, AS_OF)).toBe('at merge');
    expect(bodyAt(evidence, AS_OF)).toBe('body at merge');
    expect(labelsAt(evidence, AS_OF)).toEqual(['bug']);
    expect(reviewsAt(evidence, AS_OF).map((review) => review.state)).toEqual(['CHANGES_REQUESTED', 'APPROVED']);
  });

  it('reads the first rename\'s previous title when every rename came later', () => {
    expect(titleAt({ ...evidence, renames: [{ at: AFTER, from: 'original', to: 'later' }] }, AS_OF)).toBe('original');
  });

  it('uses the current title and body only when nothing changed them', () => {
    const untouched = { ...evidence, renames: [], body_edits: [], title: 'same', body: 'same body' };
    expect(titleAt(untouched, AS_OF)).toBe('same');
    expect(bodyAt(untouched, AS_OF)).toBe('same body');
  });

  it('never falls back to a later body when the version at as_of is gone', () => {
    expect(bodyAt({ ...evidence, body_edits: [{ at: AFTER, body: 'later' }] }, AS_OF)).toBeNull();
    expect(bodyAt({ ...evidence, body_edits: [{ at: BEFORE, body: null }, { at: AFTER, body: 'later' }] }, AS_OF)).toBeNull();
  });

  it('counts labels as null when an event no longer names its label', () => {
    expect(labelsAt({ ...evidence, label_events: [{ at: BEFORE, action: 'added', label: null }] }, AS_OF)).toBeNull();
  });
});

describe('extractPrFeatures', () => {
  it('writes every manifest column and no others', () => {
    const row = extract(evidence);
    expect(Object.keys(row.features).sort()).toEqual([...MANIFEST_COLUMNS].sort());
    expect(validateFeatureColumns(Object.keys(row.features), { allowSegments: true })).toEqual([]);
    expect(MANIFEST_COLUMNS).toHaveLength(REWORK_RISK_FEATURE_MANIFEST.entries.length);
  });

  it('computes process columns from what had happened by as_of', () => {
    expect(extract(evidence).features).toMatchObject({
      'feature.process.review_count': 2,
      'feature.process.approvals': 1,
      'feature.process.changes_requested': 1,
      'feature.process.distinct_reviewers': 2,
      'feature.process.hours_open': 6,
      'feature.process.hours_to_first_review': 2,
      'feature.process.github_label_count': 1,
      'feature.process.title_chars': 'at merge'.length,
      'feature.process.body_chars': 'body at merge'.length,
    });
  });

  it('fills the agent columns, and leaves Provenance null off the harness', () => {
    expect(extract(evidence).features).toMatchObject({
      'feature.agent.marker_present': true,
      'feature.agent.tool_family': 'claude',
      'feature.agent.marked_commit_share': 1,
      'segment.agent.exact_model': 'claude-opus-4-5',
      'segment.provenance.agent_iterations': null,
      'segment.provenance.change_requests': null,
    });
  });

  it('ignores branch-update merge commits in the marked share', () => {
    const merged = { ...evidence, commits: [...evidence.commits, { oid: 'c2', message: "Merge branch 'main' into fix-thing", author_name: 'Dev', author_email: 'dev@example.com', author_login: 'dev' }] };
    expect(extract(merged).features['feature.agent.marked_commit_share']).toBe(1);
  });

  it('counts only CI finished by as_of, and treats none as unavailable', () => {
    const ci = { pr_number: 7, contexts: [{ at: BEFORE, failed: true }, { at: BEFORE, failed: false }, { at: AFTER, failed: true }, { at: null, failed: false }] };
    expect(extract(evidence, ci).features).toMatchObject({ 'segment.ci.checks_completed_by_merge': 2, 'segment.ci.checks_failed_by_merge': 1 });
    expect(extract(evidence, { pr_number: 7, contexts: [{ at: AFTER, failed: true }] }).features['segment.ci.checks_completed_by_merge']).toBeNull();
  });

  it('records the as_of basis from GitHub, not the corpus record', () => {
    expect(extract(evidence).as_of_basis).toBe('github_merged_at');
    expect(extract({ ...evidence, merged_at: null }).as_of_basis).toBe('landing_commit_time');
    expect(extract(null).as_of_basis).toBeNull();
  });

  it('writes nulls, not zeros, when no evidence was captured', () => {
    const { features } = extract(null);
    expect(features['feature.process.review_count']).toBeNull();
    expect(features['feature.agent.marker_present']).toBeNull();
    expect(features['feature.agent.marked_commit_share']).toBeNull();
  });

  it('fails closed on an unreadable timestamp', () => {
    expect(() => extract({ ...evidence, reviews: [{ id: 'x', state: 'APPROVED', submitted_at: 'yesterday', author: 'a' }] })).toThrow(/timestamp/);
  });

  it('fails when GitHub\'s merge time disagrees with the record', () => {
    expect(() => extract({ ...evidence, merged_at: AFTER })).toThrow(/disagrees/);
  });
});

describe('replay', () => {
  it('produces a byte-identical row with everything after as_of removed', () => {
    const ci = { pr_number: 7, contexts: [{ at: BEFORE, failed: false }] };
    expect(JSON.stringify(extract(truncateEvidenceAt(evidence, AS_OF), ci))).toBe(JSON.stringify(extract(evidence, ci)));
  });

  it('holds when the body at as_of is gone', () => {
    const gone = { ...evidence, body_edits: [{ at: AFTER, body: 'later' }] };
    expect(JSON.stringify(extract(truncateEvidenceAt(gone, AS_OF)))).toBe(JSON.stringify(extract(gone)));
  });

  it('changes no column when post-merge history is rewritten', () => {
    const rewritten: PrEvidence = {
      ...evidence,
      title: 'changed again',
      body: 'changed again',
      reviews: [...evidence.reviews, { id: 'r9', state: 'CHANGES_REQUESTED', submitted_at: AFTER, author: 'erin' }],
      label_events: [...evidence.label_events, { at: AFTER, action: 'added', label: 'caused-incident' }],
      renames: [...evidence.renames, { at: AFTER, from: 'renamed after merge', to: 'Revert: this broke prod' }],
      body_edits: [{ at: AFTER, body: 'this caused an outage' }, ...evidence.body_edits],
    };
    expect(JSON.stringify(extract(rewritten))).toBe(JSON.stringify(extract(evidence)));
  });
});
