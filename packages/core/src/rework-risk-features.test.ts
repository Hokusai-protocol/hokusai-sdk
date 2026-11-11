/**
 * Contract test for the merge-time feature manifest and leakage validator
 * (HOK-3023). The conformance file is shared with HOK-2818 and HOK-3021.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  acceptedCorrectiveCandidateFixture,
  correctiveTrueFixture,
  rejectedCorrectiveCandidateFixture,
  repairPairFixture,
} from './fixtures/arbiter-corrective-rework.js';
import {
  AGENT_TOOL_FAMILIES,
  FEATURE_AS_OF_SOURCES,
  REWORK_RISK_FEATURE_MANIFEST,
  validateEvidenceAsOf,
  validateFeatureColumns,
  validateFeatureManifest,
} from './rework-risk-features.js';

const here = dirname(fileURLToPath(import.meta.url));
const conformance = JSON.parse(
  readFileSync(join(here, '../../../fixtures/arbiter/rework-risk/leakage-conformance.json'), 'utf8'),
) as { cases: { name: string; columns: string[]; allow_segments: boolean; expect_codes: string[] }[] };

const codes = (errors: { code: string }[]) => errors.map((error) => error.code);
const entryNames = REWORK_RISK_FEATURE_MANIFEST.entries.map((entry) => entry.name);
const validEntry = { name: 'feature.shape.example', as_of_source: 'git_diff_base_to_merge', segment: false };
const manifestWith = (entry: Record<string, unknown>) => ({ manifest_version: 'rr-merge-features/9.9.9', entries: [entry] });

describe('the merge-time feature manifest', () => {
  it('passes its own validator', () => {
    expect(validateFeatureManifest(REWORK_RISK_FEATURE_MANIFEST)).toEqual([]);
  });

  it('declares an as_of source and a null meaning for every entry', () => {
    for (const entry of REWORK_RISK_FEATURE_MANIFEST.entries) {
      expect(FEATURE_AS_OF_SOURCES).toContain(entry.as_of_source);
      expect(entry.null_meaning.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('tags the five Provenance fields as segment features', () => {
    for (const field of ['agent_iterations', 'self_review_iterations', 'human_intervention_count', 'review_rounds', 'change_requests']) {
      expect(entryNames).toContain(`segment.provenance.${field}`);
      expect(entryNames).not.toContain(`feature.provenance.${field}`);
    }
  });

  it('keeps CI signals out of the arm inputs', () => {
    expect(entryNames.filter((name) => name.includes('.ci.') && !name.startsWith('segment.'))).toEqual([]);
  });

  it('gives arm inputs a closed category list and keeps the exact model out', () => {
    const family = REWORK_RISK_FEATURE_MANIFEST.entries.find((entry) => entry.name === 'feature.agent.tool_family');
    expect(family?.categories).toEqual(AGENT_TOOL_FAMILIES);
    expect(entryNames).toContain('segment.agent.exact_model');
    expect(entryNames).not.toContain('feature.agent.exact_model');
  });

  it('declares no structural blast-radius field from a fix', () => {
    expect(entryNames.filter((name) => name.endsWith('graph_distance'))).toEqual([]);
  });
});

describe('validateFeatureManifest', () => {
  it.each([
    ['missing_as_of_source', { name: 'feature.shape.example', segment: false }],
    ['post_merge_as_of_source', { ...validEntry, as_of_source: 'github_current_state' }],
    ['post_merge_as_of_source', { ...validEntry, as_of_source: 'label_store' }],
    ['unknown_as_of_source', { ...validEntry, as_of_source: 'somewhere_else' }],
    ['invalid_namespace', { ...validEntry, name: 'loc_touched' }],
    ['segment_flag_mismatch', { ...validEntry, segment: true }],
    ['label_field', { ...validEntry, name: 'label.corrective' }],
    ['denied_field', { ...validEntry, name: 'feature.shape.lag_seconds' }],
    ['open_category_in_arm_input', { ...validEntry, kind: 'category' }],
  ])('rejects with %s', (code, entry) => {
    expect(codes(validateFeatureManifest(manifestWith(entry)))).toContain(code);
  });

  it('rejects a bad version and a duplicate entry', () => {
    const found = codes(validateFeatureManifest({ manifest_version: 'v1', entries: [validEntry, validEntry] }));
    expect(found).toEqual(expect.arrayContaining(['invalid_manifest_version', 'duplicate_entry']));
  });
});

describe('validateFeatureColumns', () => {
  it.each(conformance.cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    expect(codes(validateFeatureColumns(item.columns, { allowSegments: item.allow_segments }))).toEqual(item.expect_codes);
  });

  it.each([
    ['accepted candidate', acceptedCorrectiveCandidateFixture],
    ['rejected candidate', rejectedCorrectiveCandidateFixture],
    ['repair pair', repairPairFixture],
    ['corrective label', correctiveTrueFixture],
  ])('rejects every field of a %s', (_name, record) => {
    const columns = Object.keys(record);
    const errors = validateFeatureColumns(columns);
    expect(errors).toHaveLength(columns.length);
  });

  it('fails when the manifest it is given is leaky', () => {
    const manifest = {
      manifest_version: 'rr-merge-features/9.9.9',
      as_of: 'test',
      entries: [{ name: 'feature.process.final_labels', as_of_source: 'github_current_state', kind: 'integer', description: 'x', null_meaning: 'x', segment: false }],
    } as never;
    expect(codes(validateFeatureColumns(['feature.process.final_labels'], { manifest }))).toContain('post_merge_as_of_source');
  });
});

describe('validateEvidenceAsOf', () => {
  const asOf = '2026-01-10T12:00:00Z';

  it('accepts evidence at or before the cutoff, across timestamp formats', () => {
    expect(validateEvidenceAsOf([
      { source: 'review', at: '2026-01-10T12:00:00.000Z' },
      { source: 'label', at: '2026-01-10T07:00:00-05:00' },
    ], asOf)).toEqual([]);
  });

  it('rejects evidence one second after the cutoff', () => {
    expect(codes(validateEvidenceAsOf([{ source: 'review', at: '2026-01-10T12:00:01Z' }], asOf))).toEqual(['event_after_as_of']);
  });

  it('compares instants rather than strings', () => {
    expect(codes(validateEvidenceAsOf([{ source: 'review', at: '2026-01-10T08:00:00-05:00' }], asOf))).toEqual(['event_after_as_of']);
  });

  it('fails closed on an unreadable timestamp or cutoff', () => {
    expect(codes(validateEvidenceAsOf([{ source: 'review', at: 'yesterday' }], asOf))).toEqual(['invalid_event_timestamp']);
    expect(codes(validateEvidenceAsOf([], 'soon'))).toEqual(['invalid_as_of']);
  });
});
