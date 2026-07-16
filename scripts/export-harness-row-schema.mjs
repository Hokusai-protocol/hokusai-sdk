import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  HARNESS_OUTCOME_ROW_FIELDS,
  HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
} from '../packages/core/dist/index.js';

const outputPath = resolve(
  'examples/litellm-integration/tests/fixtures/harness_outcome_row_schema.json',
);

const forbiddenKeys = [
  'messages',
  'prompt',
  'input',
  'content',
  'system',
  'tools',
  'tool_calls',
  'tool_choice',
  'functions',
  'function_call',
  'completion',
  'response',
  'choices',
  'text',
];

const payload = {
  schemaVersion: HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
  fields: [...HARNESS_OUTCOME_ROW_FIELDS],
  forbiddenKeys,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

process.stdout.write(`Wrote ${outputPath}\n`);
