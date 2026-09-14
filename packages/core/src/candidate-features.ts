/**
 * Canonical derived-only feature contract for the Implementation Arbiter.
 *
 * Producers may inspect source, task text, and diffs locally, but only the
 * bounded values declared here may cross the candidate-feature boundary.
 * Every feature key is required on the wire and nullable when its documented
 * evidence is unavailable.
 *
 * @module candidate-features
 */

import {
  HOKUSAI_DESCRIPTION_LENGTH_BUCKETS,
  HOKUSAI_DOMAINS,
  HOKUSAI_FILES_TOUCHED_BUCKETS,
  HOKUSAI_LANGUAGES,
  HOKUSAI_REPO_SIZE_BUCKETS,
  HOKUSAI_RISK_LEVELS,
  HOKUSAI_TASK_TYPES,
} from './contribution/descriptor-types.js';
import type { HokusaiFieldError } from './schemas.js';

export const CANDIDATE_FEATURES_SCHEMA_VERSION =
  'candidate_features/v1' as const;

export const CANDIDATE_FEATURE_GROUPS = [
  'shape',
  'static',
  'test',
  'intent',
  'provenance',
] as const;

export type CandidateFeatureGroup = (typeof CANDIDATE_FEATURE_GROUPS)[number];

interface CandidateFeatureDefinitionBase {
  readonly group: CandidateFeatureGroup;
  readonly description: string;
  readonly nullMeaning: string;
  readonly source: string;
}

export interface CandidateBooleanFeatureDefinition extends CandidateFeatureDefinitionBase {
  readonly kind: 'boolean';
}

export interface CandidateNumberFeatureDefinition extends CandidateFeatureDefinitionBase {
  readonly kind: 'number' | 'integer';
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface CandidateEnumFeatureDefinition<
  TValues extends readonly string[] = readonly string[],
> extends CandidateFeatureDefinitionBase {
  readonly kind: 'enum';
  readonly values: TValues;
}

export type CandidateFeatureDefinition =
  | CandidateBooleanFeatureDefinition
  | CandidateNumberFeatureDefinition
  | CandidateEnumFeatureDefinition;

/**
 * The single source of truth for field names, groups, value constraints,
 * producer mappings, and missing-value semantics.
 */
export const CANDIDATE_FEATURE_DEFINITIONS = Object.freeze({
  // Shape — checkout/PR diff measurements.
  files_touched: {
    group: 'shape',
    kind: 'integer',
    minimum: 0,
    description: 'Number of files changed by the candidate.',
    nullMeaning: 'The candidate diff could not be enumerated.',
    source: 'Wavemill DifficultySignals.filesTouched.',
  },
  lines_added: {
    group: 'shape',
    kind: 'integer',
    minimum: 0,
    description: 'Number of added lines in the candidate diff.',
    nullMeaning: 'Directional diff statistics were unavailable.',
    source: 'PR additions or git numstat additions.',
  },
  lines_deleted: {
    group: 'shape',
    kind: 'integer',
    minimum: 0,
    description: 'Number of deleted lines in the candidate diff.',
    nullMeaning: 'Directional diff statistics were unavailable.',
    source: 'PR deletions or git numstat deletions.',
  },
  loc_touched: {
    group: 'shape',
    kind: 'integer',
    minimum: 0,
    description: 'Total added plus deleted lines in the candidate diff.',
    nullMeaning: 'The candidate diff could not be measured.',
    source: 'Wavemill DifficultySignals.locTouched.',
  },
  dependency_depth: {
    group: 'shape',
    kind: 'integer',
    minimum: 0,
    description: 'Maximum dependency-graph depth reached by changed modules.',
    nullMeaning: 'No supported dependency graph could be derived.',
    source: 'Wavemill DifficultySignals.dependencyDepth.',
  },
  module_hotspot_score: {
    group: 'shape',
    kind: 'number',
    minimum: 0,
    maximum: 100,
    description: 'Repository-history hotspot score for changed modules.',
    nullMeaning: 'Sufficient repository history was unavailable.',
    source: 'Wavemill DifficultySignals.moduleHotspotScore.',
  },
  diff_uncertain: {
    group: 'shape',
    kind: 'boolean',
    description:
      'Whether diff parsing produced internally suspicious measurements.',
    nullMeaning: 'No diff analysis was attempted.',
    source: 'Wavemill DifficultySignals.diffUncertain.',
  },

  // Static — tool results, never inferred from tool absence.
  type_errors: {
    group: 'static',
    kind: 'integer',
    minimum: 0,
    description: 'Type-check errors reported for the candidate.',
    nullMeaning: 'No supported type checker completed successfully.',
    source:
      'HOK-2806 static collector; legacy typecheckPassed is not an error count.',
  },
  lint_errors: {
    group: 'static',
    kind: 'integer',
    minimum: 0,
    description: 'Lint errors reported for the candidate.',
    nullMeaning: 'No supported linter completed successfully.',
    source:
      'HOK-2806 static collector; legacy lintDelta is not an error count.',
  },
  build_ok: {
    group: 'static',
    kind: 'boolean',
    description: 'Whether the configured build completed successfully.',
    nullMeaning: 'No build ran to a terminal result or collection failed.',
    source: 'Wavemill CI/build checks; CiOutcome.ran must be true.',
  },
  complexity_delta: {
    group: 'static',
    kind: 'number',
    description:
      'Candidate-minus-base change in the configured code-complexity metric.',
    nullMeaning:
      'No supported complexity analyzer completed on both revisions.',
    source: 'HOK-2806 static collector.',
  },

  // Test — test-diff and execution facts.
  tests_changed: {
    group: 'test',
    kind: 'boolean',
    description: 'Whether the candidate adds or modifies test files.',
    nullMeaning: 'Test files could not be classified from the diff.',
    source:
      'Wavemill TestsOutcome.added (which detects additions or modifications).',
  },
  test_pass_rate: {
    group: 'test',
    kind: 'number',
    minimum: 0,
    maximum: 1,
    description: 'Fraction of executed tests that passed.',
    nullMeaning: 'No supported test result completed with a measurable rate.',
    source: 'Wavemill TestsOutcome.passRate.',
  },
  test_runtime_seconds: {
    group: 'test',
    kind: 'number',
    minimum: 0,
    description: 'Elapsed seconds for the candidate test execution.',
    nullMeaning: 'Test runtime was not reported.',
    source: 'Wavemill TestsOutcome.durationSeconds.',
  },

  // Intent — exactly the established HokusaiTaskDescriptor vocabulary.
  task_type: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_TASK_TYPES,
    description: 'Coarse category of the requested change.',
    nullMeaning: 'No task category could be derived without guessing.',
    source: 'SDK deriveTaskDescriptor and Wavemill TaskDescriptor.signals.',
  },
  language: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_LANGUAGES,
    description: 'Dominant implementation language category.',
    nullMeaning: 'No supported dominant language could be derived.',
    source: 'SDK deriveTaskDescriptor and repository language signals.',
  },
  domain: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_DOMAINS,
    description: 'Coarse product or engineering domain category.',
    nullMeaning: 'No domain evidence was available; do not default to backend.',
    source: 'Wavemill TaskDescriptor.signals.learned.domain.',
  },
  complexity: {
    group: 'intent',
    kind: 'number',
    minimum: 0,
    maximum: 10,
    description:
      'Normalized estimated task complexity on the Hokusai 0–10 scale.',
    nullMeaning: 'Complexity could not be derived without a fallback.',
    source: 'SDK deriveTaskDescriptor and normalized Wavemill complexity.',
  },
  repo_size_bucket: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_REPO_SIZE_BUCKETS,
    description: 'Bucketed repository size.',
    nullMeaning: 'Repository size could not be measured.',
    source: 'SDK bucketRepositoryScale from repository file count.',
  },
  files_touched_bucket: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_FILES_TOUCHED_BUCKETS,
    description: 'Bucketed number of files changed by the candidate.',
    nullMeaning: 'The candidate diff could not be enumerated.',
    source: 'Existing HokusaiTaskDescriptor projection.',
  },
  description_length_bucket: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_DESCRIPTION_LENGTH_BUCKETS,
    description: 'Bucketed length of the locally inspected task description.',
    nullMeaning: 'No task description was available to classify locally.',
    source: 'Existing HokusaiTaskDescriptor projection.',
  },
  is_greenfield: {
    group: 'intent',
    kind: 'boolean',
    description:
      'Whether the task creates a new subsystem rather than changing one.',
    nullMeaning: 'The change kind could not be classified.',
    source: 'Wavemill HeuristicSignals.is_greenfield.',
  },
  is_migration: {
    group: 'intent',
    kind: 'boolean',
    description: 'Whether the task includes a schema or data migration.',
    nullMeaning: 'Migration intent could not be classified.',
    source: 'Wavemill HeuristicSignals.has_migration.',
  },
  requires_tests: {
    group: 'intent',
    kind: 'boolean',
    description: 'Whether the task intent requires test work.',
    nullMeaning: 'Test intent could not be classified.',
    source: 'Wavemill HeuristicSignals.has_tests and task contract.',
  },
  cross_service: {
    group: 'intent',
    kind: 'boolean',
    description: 'Whether the task spans multiple services or repositories.',
    nullMeaning: 'Service scope could not be classified.',
    source: 'Wavemill HeuristicSignals.cross_service.',
  },
  ui_heavy: {
    group: 'intent',
    kind: 'boolean',
    description: 'Whether UI work is a substantial part of the task.',
    nullMeaning: 'UI intent could not be classified.',
    source: 'Wavemill HeuristicSignals.has_ui.',
  },
  risk_level: {
    group: 'intent',
    kind: 'enum',
    values: HOKUSAI_RISK_LEVELS,
    description: 'Coarse locally derived implementation-risk category.',
    nullMeaning: 'Risk could not be classified from bounded derived signals.',
    source: 'Existing HokusaiTaskDescriptor risk projection.',
  },

  // Provenance — bounded pre-arbitration process facts, never identity.
  touched_out_of_scope_files: {
    group: 'provenance',
    kind: 'integer',
    minimum: 0,
    description:
      'Number of changed files outside the authoritative task scope.',
    nullMeaning: 'No task scope authority existed or the scope guard errored.',
    source: 'Wavemill ReviewScopeGuardResult.outOfScopePaths length.',
  },
  human_intervention_count: {
    group: 'provenance',
    kind: 'integer',
    minimum: 0,
    description: 'Number of recorded human interventions before arbitration.',
    nullMeaning: 'Intervention collection was unavailable.',
    source: 'Wavemill interventionCount/interventions.',
  },
  review_rounds: {
    group: 'provenance',
    kind: 'integer',
    minimum: 0,
    description: 'Number of distinct pre-arbitration human review rounds.',
    nullMeaning: 'Review history was unavailable.',
    source: 'Wavemill ReviewOutcome.rounds.',
  },
  change_requests: {
    group: 'provenance',
    kind: 'integer',
    minimum: 0,
    description: 'Number of pre-arbitration change-request reviews.',
    nullMeaning: 'Review history was unavailable.',
    source: 'Wavemill ReviewOutcome.changeRequests.',
  },
  self_review_iterations: {
    group: 'provenance',
    kind: 'integer',
    minimum: 0,
    description: 'Number of recorded automated self-review repair iterations.',
    nullMeaning: 'Self-review iteration telemetry was unavailable.',
    source: 'Wavemill ReviewOutcome.selfReviewIterations.',
  },
  agent_iterations: {
    group: 'provenance',
    kind: 'integer',
    minimum: 0,
    description:
      'Number of recorded implementation iterations before arbitration.',
    nullMeaning: 'Implementation iteration telemetry was unavailable.',
    source: 'Wavemill ReworkOutcome.agentIterations.',
  },
} as const satisfies Record<string, CandidateFeatureDefinition>);

export type CandidateFeatureName = keyof typeof CANDIDATE_FEATURE_DEFINITIONS;

type ValueForDefinition<TDefinition extends CandidateFeatureDefinition> =
  TDefinition extends CandidateBooleanFeatureDefinition
    ? boolean
    : TDefinition extends CandidateEnumFeatureDefinition<infer TValues>
      ? TValues[number]
      : number;

export type CandidateFeatureValues = {
  [TName in CandidateFeatureName]: ValueForDefinition<
    (typeof CANDIDATE_FEATURE_DEFINITIONS)[TName]
  > | null;
};

export type CandidateFeaturesV1 = {
  schema_version: typeof CANDIDATE_FEATURES_SCHEMA_VERSION;
} & CandidateFeatureValues;

type FieldForGroup<TGroup extends CandidateFeatureGroup> = {
  [TName in CandidateFeatureName]: (typeof CANDIDATE_FEATURE_DEFINITIONS)[TName]['group'] extends TGroup
    ? TName
    : never;
}[CandidateFeatureName];

export type CandidateFeatureProjection = Partial<CandidateFeatureValues>;
export type CandidateShapeFeatures = Partial<
  Pick<CandidateFeatureValues, FieldForGroup<'shape'>>
>;
export type CandidateStaticFeatures = Partial<
  Pick<CandidateFeatureValues, FieldForGroup<'static'>>
>;
export type CandidateTestFeatures = Partial<
  Pick<CandidateFeatureValues, FieldForGroup<'test'>>
>;
export type CandidateIntentFeatures = Partial<
  Pick<CandidateFeatureValues, FieldForGroup<'intent'>>
>;
export type CandidateProvenanceFeatures = Partial<
  Pick<CandidateFeatureValues, FieldForGroup<'provenance'>>
>;

function fieldsForGroup<TGroup extends CandidateFeatureGroup>(
  group: TGroup,
): readonly FieldForGroup<TGroup>[] {
  return Object.freeze(
    Object.entries(CANDIDATE_FEATURE_DEFINITIONS)
      .filter(([, definition]) => definition.group === group)
      .map(([name]) => name as FieldForGroup<TGroup>),
  );
}

export const CANDIDATE_FEATURE_SHAPE_FIELDS = fieldsForGroup('shape');
export const CANDIDATE_FEATURE_STATIC_FIELDS = fieldsForGroup('static');
export const CANDIDATE_FEATURE_TEST_FIELDS = fieldsForGroup('test');
export const CANDIDATE_FEATURE_INTENT_FIELDS = fieldsForGroup('intent');
export const CANDIDATE_FEATURE_PROVENANCE_FIELDS = fieldsForGroup('provenance');
export const CANDIDATE_FEATURE_FIELDS = Object.freeze(
  Object.keys(CANDIDATE_FEATURE_DEFINITIONS) as CandidateFeatureName[],
);

type JsonSchema = Readonly<Record<string, unknown>>;

function definitionJsonSchema(
  definition: CandidateFeatureDefinition,
  nullable: boolean,
): JsonSchema {
  let valueSchema: Record<string, unknown>;

  if (definition.kind === 'enum') {
    valueSchema = { type: 'string', enum: [...definition.values] };
  } else if (definition.kind === 'boolean') {
    valueSchema = { type: 'boolean' };
  } else {
    valueSchema = { type: definition.kind };
    if (definition.minimum !== undefined) {
      valueSchema.minimum = definition.minimum;
    }
    if (definition.maximum !== undefined) {
      valueSchema.maximum = definition.maximum;
    }
  }

  valueSchema.description = `${definition.description} Null means: ${definition.nullMeaning}`;

  return nullable ? { anyOf: [valueSchema, { type: 'null' }] } : valueSchema;
}

export const CANDIDATE_FEATURES_V1_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.hokus.ai/candidate_features/v1.json',
  title: 'Hokusai candidate_features/v1',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', ...CANDIDATE_FEATURE_FIELDS],
  properties: {
    schema_version: {
      type: 'string',
      const: CANDIDATE_FEATURES_SCHEMA_VERSION,
    },
    ...Object.fromEntries(
      CANDIDATE_FEATURE_FIELDS.map((name) => [
        name,
        definitionJsonSchema(CANDIDATE_FEATURE_DEFINITIONS[name], true),
      ]),
    ),
  },
}) satisfies JsonSchema;

export type CandidateFeaturesValidationResult =
  | { readonly ok: true; readonly value: CandidateFeaturesV1 }
  | { readonly ok: false; readonly errors: readonly HokusaiFieldError[] };

const CANDIDATE_FEATURE_FIELD_SET = new Set<string>(CANDIDATE_FEATURE_FIELDS);
const CANDIDATE_FEATURE_WIRE_FIELD_SET = new Set<string>([
  'schema_version',
  ...CANDIDATE_FEATURE_FIELDS,
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function fieldError(
  path: string,
  message: string,
  code: NonNullable<HokusaiFieldError['code']>,
): HokusaiFieldError {
  return { path, message, code };
}

function validateFeatureValue(
  name: CandidateFeatureName,
  value: unknown,
): HokusaiFieldError | undefined {
  if (value === null) {
    return undefined;
  }

  const definition: CandidateFeatureDefinition =
    CANDIDATE_FEATURE_DEFINITIONS[name];
  if (definition.kind === 'boolean') {
    return typeof value === 'boolean'
      ? undefined
      : fieldError(name, 'Expected a boolean or null.', 'invalid_type');
  }

  if (definition.kind === 'enum') {
    if (typeof value !== 'string') {
      return fieldError(
        name,
        'Expected a string enum value or null.',
        'invalid_type',
      );
    }
    return definition.values.includes(value)
      ? undefined
      : fieldError(
          name,
          `Expected one of: ${definition.values.join(', ')}.`,
          'invalid_value',
        );
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fieldError(
      name,
      'Expected a finite number or null.',
      'invalid_type',
    );
  }
  if (definition.kind === 'integer' && !Number.isInteger(value)) {
    return fieldError(name, 'Expected an integer or null.', 'invalid_type');
  }
  if (definition.minimum !== undefined && value < definition.minimum) {
    return fieldError(
      name,
      `Expected a value greater than or equal to ${definition.minimum}.`,
      'invalid_value',
    );
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    return fieldError(
      name,
      `Expected a value less than or equal to ${definition.maximum}.`,
      'invalid_value',
    );
  }
  return undefined;
}

export function validateCandidateFeaturesV1(
  input: unknown,
): CandidateFeaturesValidationResult {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        fieldError(
          '$',
          'Candidate features must be a plain object.',
          'invalid_type',
        ),
      ],
    };
  }

  const errors: HokusaiFieldError[] = [];

  for (const key of Object.keys(input)) {
    if (!CANDIDATE_FEATURE_WIRE_FIELD_SET.has(key)) {
      errors.push(
        fieldError(key, `Unknown candidate feature "${key}".`, 'invalid_value'),
      );
    }
  }

  if (!('schema_version' in input)) {
    errors.push(fieldError('schema_version', 'Field is required.', 'required'));
  } else if (input.schema_version !== CANDIDATE_FEATURES_SCHEMA_VERSION) {
    errors.push(
      fieldError(
        'schema_version',
        `Expected "${CANDIDATE_FEATURES_SCHEMA_VERSION}".`,
        typeof input.schema_version === 'string'
          ? 'invalid_value'
          : 'invalid_type',
      ),
    );
  }

  for (const name of CANDIDATE_FEATURE_FIELDS) {
    if (!(name in input)) {
      errors.push(fieldError(name, 'Field is required.', 'required'));
      continue;
    }
    const error = validateFeatureValue(name, input[name]);
    if (error) {
      errors.push(error);
    }
  }

  return errors.length === 0
    ? { ok: true, value: input as CandidateFeaturesV1 }
    : { ok: false, errors };
}

export class CandidateFeaturesBuildError extends Error {
  readonly errors: readonly HokusaiFieldError[];

  constructor(errors: readonly HokusaiFieldError[]) {
    super(
      `Cannot build ${CANDIDATE_FEATURES_SCHEMA_VERSION}: ${errors
        .map((error) => `${error.path}: ${error.message}`)
        .join('; ')}`,
    );
    this.name = 'CandidateFeaturesBuildError';
    this.errors = errors;
  }
}

/**
 * Merge producer projections into one deterministic, complete wire vector.
 * Later projections win when more than one producer supplies the same field.
 */
export function finalizeCandidateFeaturesV1(
  ...projections: readonly (CandidateFeatureProjection | undefined)[]
): CandidateFeaturesV1 {
  const candidate: Record<string, unknown> = {
    schema_version: CANDIDATE_FEATURES_SCHEMA_VERSION,
  };

  for (const name of CANDIDATE_FEATURE_FIELDS) {
    candidate[name] = null;
  }

  for (const projection of projections) {
    if (projection === undefined) {
      continue;
    }
    if (!isPlainObject(projection)) {
      throw new CandidateFeaturesBuildError([
        fieldError('$', 'Projection must be a plain object.', 'invalid_type'),
      ]);
    }
    for (const [name, value] of Object.entries(projection)) {
      if (!CANDIDATE_FEATURE_FIELD_SET.has(name)) {
        throw new CandidateFeaturesBuildError([
          fieldError(
            name,
            `Unknown candidate feature "${name}".`,
            'invalid_value',
          ),
        ]);
      }
      candidate[name] = value;
    }
  }

  const result = validateCandidateFeaturesV1(candidate);
  if (!result.ok) {
    throw new CandidateFeaturesBuildError(result.errors);
  }
  return result.value;
}

/** Internal schema primitive reused by the legacy descriptor schema. */
export function candidateFeatureValueJsonSchema(
  name: CandidateFeatureName,
  nullable = true,
): JsonSchema {
  return definitionJsonSchema(CANDIDATE_FEATURE_DEFINITIONS[name], nullable);
}
