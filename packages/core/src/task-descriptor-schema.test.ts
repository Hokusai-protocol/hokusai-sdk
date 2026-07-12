import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  HokusaiLanguage,
  HokusaiTaskDescriptor,
} from './contribution/descriptor-types.js';
import { deriveTaskDescriptor } from './task-descriptor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = resolve(
  __dirname,
  '../../../../hokusai-data-pipeline/schema/hokusai_task_descriptor.v1.json',
);
const SCHEMA_PATH =
  process.env.HOKUSAI_TASK_DESCRIPTOR_SCHEMA ?? DEFAULT_SCHEMA_PATH;

const ALL_HOKUSAI_LANGUAGES: Record<HokusaiLanguage, true> = {
  python: true,
  typescript: true,
  javascript: true,
  go: true,
  rust: true,
  java: true,
  bash: true,
  multi: true,
  unknown: true,
};

function loadTaskDescriptorSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
}

function languageEnum(schema: Record<string, unknown>): string[] {
  const properties = schema.properties as Record<string, unknown>;
  const language = properties.language as Record<string, unknown>;
  return language.enum as string[];
}

describe('hokusai_task_descriptor.v1 schema', () => {
  it('keeps the schema language enum aligned with HokusaiLanguage', () => {
    const schemaLanguages = languageEnum(loadTaskDescriptorSchema()).sort();
    const typeLanguages = Object.keys(ALL_HOKUSAI_LANGUAGES).sort();

    expect(schemaLanguages).toEqual(typeLanguages);
  });

  it('accepts descriptors emitted by deriveTaskDescriptor', () => {
    const schema = loadTaskDescriptorSchema();
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const descriptor = deriveTaskDescriptor({
      taskText: 'Fix the flaky TypeScript integration test.',
      repositorySignals: {
        fileCount: 42,
        extensionCounts: { ts: 12 },
      },
    });

    expect(validate(descriptor)).toBe(true);
  });

  it('accepts the handwritten HokusaiTaskDescriptor contract', () => {
    const schema = loadTaskDescriptorSchema();
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const descriptor: HokusaiTaskDescriptor = {
      task_type: 'feature',
      language: 'typescript',
      domain: 'frontend',
      complexity: 5,
      repo_size_bucket: 'medium',
      files_touched_bucket: '2_5',
      description_length_bucket: 'medium',
      is_greenfield: false,
      is_migration: false,
      requires_tests: true,
      cross_service: false,
      ui_heavy: true,
      risk_level: 'medium',
    };

    expect(validate(descriptor)).toBe(true);
  });

  it('rejects the pre-HOK-2495 word complexity and display language drift', () => {
    const schema = loadTaskDescriptorSchema();
    const validate = new Ajv2020({ allErrors: true }).compile(schema);

    expect(
      validate({
        task_type: 'bugfix',
        language: 'TypeScript',
        complexity: 'standard',
      }),
    ).toBe(false);
    expect(
      validate.errors?.map((error: ErrorObject) => error.instancePath).sort(),
    ).toEqual(['/complexity', '/language']);
  });
});
