import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const schemaSource = await readFile(resolve('packages/core/src/contribution/schema.ts'), 'utf8');

const schemaVersionMatch = schemaSource.match(
  /HARNESS_OUTCOME_ROW_SCHEMA_VERSION\s*=\s*'([^']+)'/,
);
if (!schemaVersionMatch) {
  throw new Error('Unable to find HARNESS_OUTCOME_ROW_SCHEMA_VERSION in core schema source');
}

const fieldsMatch = schemaSource.match(
  /HARNESS_OUTCOME_ROW_FIELDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s+as const\)/,
);
if (!fieldsMatch) {
  throw new Error('Unable to find HARNESS_OUTCOME_ROW_FIELDS in core schema source');
}

const harnessOutcomeRowFields = [...fieldsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
if (harnessOutcomeRowFields.length === 0) {
  throw new Error('HARNESS_OUTCOME_ROW_FIELDS did not contain any exported fields');
}

const outputPaths = [
  resolve('examples/litellm-integration/tests/fixtures/harness_outcome_row_schema.json'),
  resolve('examples/openhands-integration/tests/fixtures/harness_outcome_row_schema.json'),
];

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
  schemaVersion: schemaVersionMatch[1],
  fields: harnessOutcomeRowFields,
  forbiddenKeys,
};

const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;

for (const outputPath of outputPaths) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializedPayload, 'utf8');
}

process.stdout.write(serializedPayload);
