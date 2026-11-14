// Export the technical_task_router_row/v4 field contract (HOK-3412) for
// non-TypeScript writers (the Python LiteLLM / OpenHands examples move to v4
// in HOK-3384). `--check` fails when the committed fixture is stale.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  CONTRIBUTION_FORBIDDEN_KEYS,
  MODEL_EVIDENCE_KINDS,
  RECOMMENDATION_COPY_KEYS,
  ROUTE_OVERRIDE_SOURCES,
  ROUTE_ROLES,
  STAGE_EXECUTION_FIELDS,
  STAGE_EXECUTION_STAGES,
  STAGE_TO_ROLE,
  TASK_COST_FORBIDDEN_KEYS,
  TASK_COST_HARNESSES,
  TASK_COST_SUMMARY_SCHEMA_VERSION,
  TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V4,
  TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS,
} from '../packages/core/dist/index.js';

const outputPath = resolve(
  'examples/litellm-integration/tests/fixtures/technical_task_router_row_v4_schema.json',
);

const payload = {
  schemaVersion: TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V4,
  fields: [...TECHNICAL_TASK_ROUTER_ROW_V4_FIELDS],
  stageExecution: {
    fields: [...STAGE_EXECUTION_FIELDS],
    stages: [...STAGE_EXECUTION_STAGES],
    stageToRole: { ...STAGE_TO_ROLE },
    modelEvidence: [...MODEL_EVIDENCE_KINDS],
    taskCost: {
      schemaVersion: TASK_COST_SUMMARY_SCHEMA_VERSION,
      harnesses: [...TASK_COST_HARNESSES],
      forbiddenKeys: [...TASK_COST_FORBIDDEN_KEYS].sort(),
    },
  },
  comparisonGroup: { fields: ['id', 'role_varied'], roles: [...ROUTE_ROLES] },
  overrides: { roles: [...ROUTE_ROLES], sources: [...ROUTE_OVERRIDE_SOURCES] },
  forbiddenKeys: [...CONTRIBUTION_FORBIDDEN_KEYS].sort(),
  recommendationCopyKeys: [...RECOMMENDATION_COPY_KEYS],
};
const rendered = `${JSON.stringify(payload, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== rendered) {
    process.stderr.write(`${outputPath} is stale. Run: pnpm export:schemas\n`);
    process.exit(1);
  }
  process.stdout.write(`${outputPath} is current.\n`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}
