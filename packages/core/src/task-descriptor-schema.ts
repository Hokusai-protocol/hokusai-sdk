import {
  CANDIDATE_FEATURE_INTENT_FIELDS,
  candidateFeatureValueJsonSchema,
} from './candidate-features.js';

/**
 * SDK-owned compatibility schema for the partial Model 30 task descriptor.
 * Candidate features use the same Intent vocabulary but require every key and
 * encode unavailable evidence as null; this legacy descriptor remains partial.
 */
export const HOKUSAI_TASK_DESCRIPTOR_V1_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.hokus.ai/hokusai_task_descriptor.v1.json',
  title: 'Hokusai task descriptor v1',
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    CANDIDATE_FEATURE_INTENT_FIELDS.map((name) => [
      name,
      candidateFeatureValueJsonSchema(name, false),
    ]),
  ),
});
