#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ARBITER_REPORT_INVARIANT_CODES,
  ARBITER_REPORT_SCHEMA_VERSION,
  ARBITER_REPORT_V1_JSON_SCHEMA,
  validateArbiterReportV1,
} from '../packages/core/dist/index.js';
import { reportDraftFixtures } from '../packages/core/dist/fixtures/arbiter-report.js';
import { applyReportSuppression } from '../packages/scan/dist/index.js';

const check = process.argv.includes('--check');
const root = resolve('fixtures/arbiter/report');
const stringify = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = new Map();
const valid = Object.fromEntries(
  Object.entries(reportDraftFixtures).map(([name, build]) => [
    name,
    applyReportSuppression(build()),
  ]),
);
for (const [name, value] of Object.entries(valid))
  files.set(`${name.replaceAll('_', '-')}.v1.json`, stringify(value));
files.set(
  'arbiter-report.v1.schema.json',
  stringify(ARBITER_REPORT_V1_JSON_SCHEMA),
);

function invalid(name, code, path, mutate, base = 'full') {
  const payload = structuredClone(valid[base]);
  // Keep negative fixtures small while retaining a valid, unsuppressed
  // 20-PR baseline. Copying the 240-PR happy path into every failure case adds
  // hundreds of thousands of redundant lines to both repositories.
  payload.prs = payload.prs.slice(0, 20);
  payload.coverage.prs_enumerated = 20;
  payload.coverage.prs_eligible = 20;
  for (const horizon of payload.coverage.labels_by_horizon)
    horizon.labelled = 20;
  payload.coverage.attribution.agent = {
    identified_agent: 20,
    identified_human_signal: 0,
    unknown: 0,
    rate: 1,
  };
  payload.coverage.attribution.harness = { identified: 20, unknown: 0, rate: 1 };
  payload.coverage.attribution.exact_model = { identified: 20, unknown: 0, rate: 1 };
  for (const method of payload.coverage.attribution.methods) method.count = 20;
  for (const section of Object.values(payload.aggregates))
    for (const row of section.rows)
      for (const [key, value] of Object.entries(row))
        if (key === 'cell' || key === 'ratio' || key.endsWith('_rate')) value.n = 20;
  if (payload.cost) {
    payload.cost.actual.prs_priced = 20;
    payload.cost.actual.prs_unknown = 0;
    payload.cost.actual.total_usd = 25;
    payload.cost.estimated.prs_priced = 20;
    payload.cost.estimated.prs_unknown = 0;
    payload.cost.estimated.total_usd = 22;
  }
  if (!validateArbiterReportV1(payload).ok)
    throw new Error(`Invalid fixture baseline ${name} is not valid.`);
  mutate(payload);
  const result = validateArbiterReportV1(payload);
  if (result.ok)
    throw new Error(
      `Invalid fixture ${name} unexpectedly passed core validation.`,
    );
  if (
    code !== 'schema_violation' &&
    !result.errors.some((e) => e.message === code)
  )
    throw new Error(
      `Invalid fixture ${name} missing ${code}: ${JSON.stringify(result.errors)}`,
    );
  files.set(
    `invalid/${name}.json`,
    stringify({ expect: { code, path }, payload }),
  );
}
invalid(
  'suppressed_cell_has_value',
  'suppressed_cell_has_value',
  'aggregates.survival_by_horizon.rows[0].cell',
  (r) => {
    r.aggregates.survival_by_horizon.rows[0].cell.suppressed = true;
    r.aggregates.survival_by_horizon.rows[0].cell.suppression_reasons = [
      'n_below_floor',
    ];
  },
);
invalid(
  'shown_cell_missing_value',
  'shown_cell_missing_value',
  'aggregates.survival_by_horizon.rows[0].cell',
  (r) => {
    r.aggregates.survival_by_horizon.rows[0].cell.value = null;
  },
);
invalid(
  'ci_out_of_order',
  'ci_out_of_order',
  'aggregates.survival_by_horizon.rows[0].cell',
  (r) => {
    r.aggregates.survival_by_horizon.rows[0].cell.ci.low = 0.9;
  },
);
invalid(
  'section_status_mismatch',
  'section_status_mismatch',
  'aggregates.survival_by_horizon',
  (r) => {
    r.aggregates.survival_by_horizon.status = 'suppressed';
  },
);
invalid(
  'prediction_without_provenance',
  'prediction_without_provenance',
  'prs[0].prediction',
  (r) => {
    r.prs[0].prediction = {
      basis: 'out_of_sample_prediction',
      score: 0.5,
      flagged: true,
    };
  },
);
invalid(
  'descriptive_section_with_prediction_cell',
  'descriptive_section_with_prediction_cell',
  'aggregates.survival_by_horizon.rows[0].cell',
  (r) => {
    r.aggregates.survival_by_horizon.rows[0].cell.basis =
      'out_of_sample_prediction';
  },
);
invalid(
  'cta_without_exact_model',
  'cta_without_exact_model',
  'eligibility.model_routing_cta',
  (r) => {
    r.eligibility.exact_model_table = false;
  },
);
invalid(
  'model_table_ineligible_but_shown',
  'model_table_ineligible_but_shown',
  'aggregates.survival_by_model',
  (r) => {
    r.eligibility.exact_model_table = false;
    r.eligibility.model_routing_cta = false;
  },
);
invalid(
  'cost_adjusted_needs_actual_cost',
  'cost_adjusted_needs_actual_cost',
  'eligibility.cost_adjusted_by_model',
  (r) => {
    r.cost.actual.suppressed = true;
    r.cost.actual.total_usd = null;
    r.cost.actual.suppression_reasons = ['cost_coverage_below_floor'];
  },
);
invalid('coverage_sum_mismatch', 'coverage_sum_mismatch', 'coverage', (r) => {
  r.coverage.attribution.agent.unknown++;
});
invalid(
  'horizon_not_declared',
  'horizon_not_declared',
  'aggregates.survival_by_horizon.rows[0].horizon_days',
  (r) => {
    r.aggregates.survival_by_horizon.rows[0].horizon_days = 14;
  },
);
invalid(
  'horizons_not_ascending',
  'horizons_not_ascending',
  'scan.horizons_days',
  (r) => {
    r.scan.horizons_days = [30, 14];
  },
);
invalid(
  'feature_bucket_mismatch',
  'feature_bucket_mismatch',
  'aggregates.risk_ratios.rows[0].bucket',
  (r) => {
    r.aggregates.risk_ratios.rows[0].bucket = 'q1';
  },
);
invalid(
  'labels_horizon_mismatch',
  'labels_horizon_mismatch',
  'prs[0].labels',
  (r) => {
    r.prs[0].labels = [];
  },
);
invalid(
  'label_outcome_inconsistent',
  'label_outcome_inconsistent',
  'prs[0].labels[0].outcome.report_outcome',
  (r) => {
    r.prs[0].labels[0].outcome.report_outcome = 'reverted';
  },
);
invalid(
  'cost_sum_forbidden',
  'schema_violation',
  'cost.total_cost_usd',
  (r) => {
    r.cost.total_cost_usd = 2;
  },
);
invalid('unknown_key_title', 'schema_violation', 'title', (r) => {
  r.title = 'untrusted';
});
invalid(
  'branch_with_newline',
  'schema_violation',
  'scan.integration_branch',
  (r) => {
    r.scan.integration_branch = 'auto/\nintegration';
  },
);
invalid(
  'forbidden_line_ranges',
  'schema_violation',
  'prs[0].labels[0].line_ranges',
  (r) => {
    r.prs[0].labels[0].line_ranges = [];
  },
);
invalid('schema_version_v2', 'schema_violation', 'schema_version', (r) => {
  r.schema_version = 'arbiter_report/v2';
});
invalid('repo_dotdot', 'schema_violation', 'repo.name', (r) => {
  r.repo.name = '..';
});
if (
  !ARBITER_REPORT_INVARIANT_CODES.every((code) =>
    files.has(`invalid/${code}.json`),
  )
)
  throw new Error('An invariant fixture is missing.');

const expected = Object.fromEntries(
  [...files].map(([name, body]) => [name, hash(body)]),
);
const provenancePath = resolve(root, 'PROVENANCE.json');
const coreSchemaPath = resolve(
  'packages/core/schemas/arbiter-report.v1.schema.json',
);
if (check) {
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (
    provenance.schema_version !== ARBITER_REPORT_SCHEMA_VERSION ||
    JSON.stringify(provenance.files) !== JSON.stringify(expected)
  )
    throw new Error('Report fixture provenance drift.');
  for (const [name, body] of files)
    if (readFileSync(resolve(root, name), 'utf8') !== body)
      throw new Error(`Report fixture drift: ${name}`);
  if (
    readFileSync(coreSchemaPath, 'utf8') !==
    files.get('arbiter-report.v1.schema.json')
  )
    throw new Error('Core report JSON Schema drift.');
} else {
  for (const [name, body] of files) {
    const path = resolve(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  writeFileSync(coreSchemaPath, files.get('arbiter-report.v1.schema.json'));
  const provenance = {
    sdk_version: '0.4.0',
    schema_version: ARBITER_REPORT_SCHEMA_VERSION,
    source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    dirty: true,
    command: 'pnpm export:arbiter-report',
    files: expected,
  };
  writeFileSync(provenancePath, stringify(provenance));
}
console.log(
  check
    ? 'Arbiter report fixtures current.'
    : 'Arbiter report fixtures exported.',
);
