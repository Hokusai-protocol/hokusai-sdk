import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CANDIDATE_FEATURES_SCHEMA_VERSION,
  CANDIDATE_FEATURES_V1_JSON_SCHEMA,
  CANDIDATE_FEATURE_DEFINITIONS,
  CANDIDATE_FEATURE_FIELDS,
  CANDIDATE_FEATURE_INTENT_FIELDS,
  CANDIDATE_FEATURE_PROVENANCE_FIELDS,
  CANDIDATE_FEATURE_SHAPE_FIELDS,
  CANDIDATE_FEATURE_STATIC_FIELDS,
  CANDIDATE_FEATURE_TEST_FIELDS,
  CandidateFeaturesBuildError,
  finalizeCandidateFeaturesV1,
  validateCandidateFeaturesV1,
  type CandidateFeaturesV1,
  type CandidateIntentFeatures,
} from './candidate-features.js';

const complete = finalizeCandidateFeaturesV1({
  files_touched: 4,
  lines_added: 80,
  lines_deleted: 12,
  loc_touched: 92,
  dependency_depth: 2,
  module_hotspot_score: 37.5,
  diff_uncertain: false,
  type_errors: 0,
  lint_errors: 0,
  build_ok: true,
  complexity_delta: -1.25,
  tests_changed: true,
  test_pass_rate: 1,
  test_runtime_seconds: 12.4,
  task_type: 'feature',
  language: 'typescript',
  domain: 'backend',
  complexity: 5,
  repo_size_bucket: 'medium',
  files_touched_bucket: '2_5',
  description_length_bucket: 'medium',
  is_greenfield: false,
  is_migration: false,
  requires_tests: true,
  cross_service: false,
  ui_heavy: false,
  risk_level: 'medium',
  touched_out_of_scope_files: 0,
  human_intervention_count: 0,
  review_rounds: 1,
  change_requests: 0,
  self_review_iterations: 1,
  agent_iterations: 3,
});

function ajvAccepts(value: unknown): boolean {
  const validate = new Ajv2020({ allErrors: true }).compile(
    CANDIDATE_FEATURES_V1_JSON_SCHEMA,
  );
  return validate(value);
}

describe('candidate_features/v1 field registry', () => {
  it('defines exactly five disjoint groups and one complete ordered field list', () => {
    const grouped = [
      ...CANDIDATE_FEATURE_SHAPE_FIELDS,
      ...CANDIDATE_FEATURE_STATIC_FIELDS,
      ...CANDIDATE_FEATURE_TEST_FIELDS,
      ...CANDIDATE_FEATURE_INTENT_FIELDS,
      ...CANDIDATE_FEATURE_PROVENANCE_FIELDS,
    ];

    expect(grouped).toEqual(CANDIDATE_FEATURE_FIELDS);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(CANDIDATE_FEATURE_FIELDS).toHaveLength(33);
    expect(Object.keys(CANDIDATE_FEATURE_DEFINITIONS)).toEqual(
      CANDIDATE_FEATURE_FIELDS,
    );
  });

  it('keeps the schema properties and required fields aligned with the manifest', () => {
    const properties = CANDIDATE_FEATURES_V1_JSON_SCHEMA.properties as Record<
      string,
      unknown
    >;
    const required = CANDIDATE_FEATURES_V1_JSON_SCHEMA.required;

    expect(Object.keys(properties)).toEqual([
      'schema_version',
      ...CANDIDATE_FEATURE_FIELDS,
    ]);
    expect(required).toEqual(['schema_version', ...CANDIDATE_FEATURE_FIELDS]);
    expect(CANDIDATE_FEATURES_V1_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('compile-time links Intent projections to candidate values', () => {
    expectTypeOf<CandidateIntentFeatures>().toMatchTypeOf<
      Partial<
        Pick<
          CandidateFeaturesV1,
          (typeof CANDIDATE_FEATURE_INTENT_FIELDS)[number]
        >
      >
    >();
  });
});

describe('finalizeCandidateFeaturesV1', () => {
  it('builds a complete valid vector and keeps deterministic key order', () => {
    expect(complete.schema_version).toBe(CANDIDATE_FEATURES_SCHEMA_VERSION);
    expect(Object.keys(complete)).toEqual([
      'schema_version',
      ...CANDIDATE_FEATURE_FIELDS,
    ]);
    expect(validateCandidateFeaturesV1(complete)).toEqual({
      ok: true,
      value: complete,
    });
    expect(ajvAccepts(complete)).toBe(true);
  });

  it('fills unavailable fields with null', () => {
    const sparse = finalizeCandidateFeaturesV1({
      files_touched: 0,
      build_ok: null,
    });

    expect(sparse.files_touched).toBe(0);
    expect(sparse.build_ok).toBeNull();
    expect(sparse.type_errors).toBeNull();
    expect(sparse.task_type).toBeNull();
    expect(sparse.touched_out_of_scope_files).toBeNull();
    expect(
      Object.values(sparse).filter((value) => value === null),
    ).toHaveLength(CANDIDATE_FEATURE_FIELDS.length - 1);
  });

  it('preserves observed zero and false independently from null', () => {
    const values = finalizeCandidateFeaturesV1({
      type_errors: 0,
      lint_errors: 0,
      build_ok: false,
      tests_changed: false,
      touched_out_of_scope_files: 0,
    });

    expect(values).toMatchObject({
      type_errors: 0,
      lint_errors: 0,
      build_ok: false,
      tests_changed: false,
      touched_out_of_scope_files: 0,
    });
    expect(values.complexity_delta).toBeNull();
  });

  it('lets a later, richer projection replace an earlier null', () => {
    expect(
      finalizeCandidateFeaturesV1(
        { build_ok: null, type_errors: null },
        { build_ok: true, type_errors: 0 },
      ),
    ).toMatchObject({ build_ok: true, type_errors: 0 });
  });

  it('rejects unknown projection fields instead of silently dropping them', () => {
    expect(() =>
      finalizeCandidateFeaturesV1({ prompt: 'secret' } as never),
    ).toThrow(CandidateFeaturesBuildError);
  });
});

describe('validateCandidateFeaturesV1', () => {
  it('accepts an all-null vector', () => {
    const sparse = finalizeCandidateFeaturesV1();
    expect(validateCandidateFeaturesV1(sparse).ok).toBe(true);
    expect(ajvAccepts(sparse)).toBe(true);
  });

  it.each([
    'prompt',
    'source',
    'diff',
    'file_path',
    'model',
    'vendor',
    'harness',
    'user_id',
    'trigger_source',
    'price',
    'cost_usd',
  ])('rejects prohibited or unknown key %s', (key) => {
    const invalid = { ...complete, [key]: 'not allowed' };
    const result = validateCandidateFeaturesV1(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === key)).toBe(true);
    }
    expect(ajvAccepts(invalid)).toBe(false);
  });

  it.each(CANDIDATE_FEATURE_FIELDS)(
    'rejects missing required field %s',
    (field) => {
      const missing = { ...complete } as Record<string, unknown>;
      delete missing[field];
      const result = validateCandidateFeaturesV1(missing);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContainEqual({
          path: field,
          message: 'Field is required.',
          code: 'required',
        });
      }
      expect(ajvAccepts(missing)).toBe(false);
    },
  );

  it.each([
    'shape_extra',
    'static_extra',
    'test_extra',
    'intent_extra',
    'provenance_extra',
  ])('rejects group-local unknown field %s', (field) => {
    const invalid = { ...complete, [field]: 0 };
    expect(validateCandidateFeaturesV1(invalid).ok).toBe(false);
    expect(ajvAccepts(invalid)).toBe(false);
  });

  it('rejects the wrong version', () => {
    const versionResult = validateCandidateFeaturesV1({
      ...complete,
      schema_version: 'candidate_features/v2',
    });

    expect(versionResult.ok).toBe(false);
  });

  it.each([
    ['files_touched', -1],
    ['type_errors', 1.5],
    ['module_hotspot_score', 101],
    ['test_pass_rate', 1.01],
    ['complexity', Number.NaN],
    ['task_type', 'banana'],
    ['build_ok', 1],
  ])('rejects invalid value for %s', (field, value) => {
    const invalid = { ...complete, [field]: value };
    expect(validateCandidateFeaturesV1(invalid).ok).toBe(false);
    expect(ajvAccepts(invalid)).toBe(false);
  });

  it('rejects arrays and class instances as wire objects', () => {
    expect(validateCandidateFeaturesV1([]).ok).toBe(false);
    expect(validateCandidateFeaturesV1(new (class {})()).ok).toBe(false);
  });

  it('agrees with AJV on representative valid and invalid vectors', () => {
    const candidates: unknown[] = [
      complete,
      finalizeCandidateFeaturesV1(),
      { ...complete, build_ok: null },
      { ...complete, review_rounds: -1 },
      { ...complete, extra: false },
      { ...complete, schema_version: null },
    ];

    for (const candidate of candidates) {
      expect(validateCandidateFeaturesV1(candidate).ok).toBe(
        ajvAccepts(candidate),
      );
    }
  });
});

describe('Wavemill compatibility sentinels', () => {
  it('represents CI not-run as null, not the legacy passed=true sentinel', () => {
    const legacyCi = { ran: false, passed: true };
    const projection = {
      build_ok: legacyCi.ran ? legacyCi.passed : null,
    } as const;

    expect(finalizeCandidateFeaturesV1(projection).build_ok).toBeNull();
  });

  it('represents empty static collection and missing scope authority as null', () => {
    const legacyStatic: Record<string, never> = {};
    const scope = { status: 'error', kind: 'missing-authority' } as const;
    const projection = {
      type_errors: 'typeErrors' in legacyStatic ? 0 : null,
      lint_errors: 'lintErrors' in legacyStatic ? 0 : null,
      touched_out_of_scope_files:
        scope.status === 'error' ? null : (0 as number),
    } as const;

    expect(finalizeCandidateFeaturesV1(projection)).toMatchObject({
      type_errors: null,
      lint_errors: null,
      touched_out_of_scope_files: null,
    });
  });
});
