#!/usr/bin/env node
// Exports the PROPOSED arbiter_report/v2 schema and fixtures (HOK-2826 step 1)
// to fixtures/arbiter/report-v2/, separate from the vendored v1 directory so
// v1 consumers see no drift. --check fails on any byte difference.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ARBITER_REPORT_V2_INVARIANT_CODES,
  ARBITER_REPORT_V2_JSON_SCHEMA,
  ARBITER_REPORT_V2_SCHEMA_VERSION,
  validateArbiterReportV2,
} from '../packages/core/dist/index.js';
import { reportDraftFixtures } from '../packages/core/dist/fixtures/arbiter-report.js';
import { buildReportV2Fixture } from '../packages/core/dist/fixtures/arbiter-report-v2.js';
import {
  applyReportSuppression,
  wilsonInterval,
} from '../packages/scan/dist/index.js';

const check = process.argv.includes('--check');
const root = resolve('fixtures/arbiter/report-v2');
const coreSchemaPath = resolve(
  'packages/core/schemas/arbiter-report.v2.schema.json',
);
const stringify = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = new Map();

const bases = {
  retrospective: 'prediction',
  time_split: 'prediction',
  suppressed: 'sparse',
  unavailable: 'full',
};
const valid = {};
for (const [kind, base] of Object.entries(bases)) {
  const payload = buildReportV2Fixture(
    applyReportSuppression(reportDraftFixtures[base]()),
    kind,
    wilsonInterval,
  );
  const result = validateArbiterReportV2(payload);
  if (!result.ok)
    throw new Error(
      `v2 fixture ${kind} is invalid: ${JSON.stringify(result.errors.slice(0, 5))}`,
    );
  valid[kind] = payload;
  files.set(`${kind.replaceAll('_', '-')}.v2.json`, stringify(payload));
}
files.set(
  'arbiter-report.v2.schema.json',
  stringify(ARBITER_REPORT_V2_JSON_SCHEMA),
);

// Negative fixtures use a trimmed 24-PR base with floors of 3, so results are
// shown and every invariant is exercised without copying 100 PRs per case.
function trimmedV1(base) {
  const r = applyReportSuppression(reportDraftFixtures[base]());
  const n = 24;
  r.prs = r.prs.slice(0, n);
  r.coverage.prs_enumerated = n;
  r.coverage.prs_eligible = n;
  for (const h of r.coverage.labels_by_horizon) h.labelled = n;
  const agents = r.prs.filter(
    (pr) => pr.attribution.agent.status === 'agent',
  ).length;
  r.coverage.attribution.agent = {
    identified_agent: agents,
    identified_human_signal: 0,
    unknown: n - agents,
    rate: agents / n,
  };
  const harness = r.prs.filter((pr) => pr.attribution.harness.id).length;
  r.coverage.attribution.harness = {
    identified: harness,
    unknown: n - harness,
    rate: harness / n,
  };
  const exact = r.prs.filter((pr) => pr.attribution.exact_model.id).length;
  r.coverage.attribution.exact_model = {
    identified: exact,
    unknown: n - exact,
    rate: exact / n,
  };
  r.policy = { ...r.policy, min_cell_n: 3, min_reworked_for_retrospective: 3 };
  return r;
}
const small = {};
for (const kind of ['retrospective', 'time_split']) {
  small[kind] = buildReportV2Fixture(
    trimmedV1('prediction'),
    kind,
    wilsonInterval,
  );
  const result = validateArbiterReportV2(small[kind]);
  if (!result.ok)
    throw new Error(
      `trimmed v2 base ${kind} is invalid: ${JSON.stringify(result.errors.slice(0, 5))}`,
    );
  if (!small[kind].retrospective.results.some((x) => x.status === 'shown'))
    throw new Error(`trimmed v2 base ${kind} shows no result`);
}

function invalid(name, code, path, mutate, base = 'retrospective') {
  const payload = structuredClone(small[base]);
  mutate(payload);
  const result = validateArbiterReportV2(payload);
  if (result.ok)
    throw new Error(`Invalid v2 fixture ${name} unexpectedly passed.`);
  if (
    code !== 'schema_violation' &&
    !result.errors.some((e) => e.message === code && e.path === path)
  )
    throw new Error(
      `Invalid v2 fixture ${name} missing ${code} at ${path}: ${JSON.stringify(result.errors.slice(0, 6))}`,
    );
  files.set(
    `invalid/${name}.json`,
    stringify({ expect: { code, path }, payload }),
  );
}
const scoredIndex = (r) =>
  r.prs.findIndex((pr) => pr.predictions[0]?.status === 'scored');
/** Make the repo-calibrated variant available, with a prediction for it on every PR. */
const enableRepoCalibration = (r, labelsObservedBy) => {
  r.retrospective.calibrations[1] = {
    ...r.retrospective.calibrations[1],
    version: '1.0.0',
    status: 'available',
    unavailable_reasons: [],
    threshold: { value: 0.5, comparison: 'gte' },
    fit: {
      method: 'isotonic',
      rows_merged_before: '2026-01-01T00:00:00Z',
      labels_observed_by: labelsObservedBy,
      n_rows: 50,
      n_positive: 10,
    },
  };
  for (const pr of r.prs)
    pr.predictions.push({ ...pr.predictions[0], calibration_ref: 'repo' });
};

invalid(
  'retrospective_status_mismatch',
  'retrospective_status_mismatch',
  'retrospective',
  (r) => {
    r.retrospective.status = 'unavailable';
  },
);
invalid(
  'reference_unknown',
  'reference_unknown',
  'retrospective.calibrations[0].head_ref',
  (r) => {
    r.retrospective.calibrations[0].head_ref = 'head-9';
  },
);
invalid(
  'reference_duplicate',
  'reference_duplicate',
  'retrospective.heads[1].head_ref',
  (r) => {
    r.retrospective.heads.push(structuredClone(r.retrospective.heads[0]));
  },
);
invalid(
  'result_key_duplicate',
  'result_key_duplicate',
  'retrospective.results[2]',
  (r) => {
    r.retrospective.results.push(structuredClone(r.retrospective.results[0]));
  },
);
invalid(
  'target_mismatch',
  'target_mismatch',
  'retrospective.results[0]',
  (r) => {
    r.retrospective.heads[0].target = 'cr-0.3.0';
  },
);
invalid(
  'split_membership_conflict',
  'split_membership_conflict',
  'retrospective.heads[0].training',
  (r) => {
    r.retrospective.heads[0].training.repo_membership = 'included';
  },
);
invalid(
  'training_cutoffs_out_of_order',
  'training_cutoffs_out_of_order',
  'retrospective.heads[0].training',
  (r) => {
    r.retrospective.heads[0].training.rows_merged_before =
      '2030-01-01T00:00:00Z';
  },
);
invalid(
  'prediction_before_split',
  'prediction_before_split',
  'prs[0].predictions[0]',
  (r) => {
    r.prs[0].predictions[0] = {
      calibration_ref: 'portable',
      status: 'scored',
      reason: null,
      score: 0.1,
      flagged: false,
    };
  },
  'time_split',
);
invalid(
  'calibration_rows_overlap',
  'calibration_rows_overlap',
  'prs[0].predictions[1]',
  (r) => {
    r.policy.min_local_calibration_labels = 10;
    enableRepoCalibration(r, r.prs[0].merged_at);
  },
);
invalid(
  'calibration_state_inconsistent',
  'calibration_state_inconsistent',
  'retrospective.calibrations[0]',
  (r) => {
    r.retrospective.calibrations[0].threshold = null;
  },
);
invalid(
  'local_calibration_below_minimum',
  'local_calibration_below_minimum',
  'retrospective.calibrations[1].fit',
  (r) => {
    enableRepoCalibration(r, '2026-01-02T00:00:00Z');
  },
);
invalid(
  'prediction_state_inconsistent',
  'prediction_state_inconsistent',
  'prs[0].predictions[0]',
  (r) => {
    r.prs[0].predictions[0].reason = 'dependency_bot';
  },
);
invalid(
  'prediction_coverage_mismatch',
  'prediction_coverage_mismatch',
  'prs[5].predictions',
  (r) => {
    r.prs[5].predictions = [];
  },
);
invalid(
  'flag_threshold_mismatch',
  'flag_threshold_mismatch',
  'prs[0].predictions[0]',
  (r) => {
    r.prs[scoredIndex(r)].predictions[0].flagged =
      !r.prs[scoredIndex(r)].predictions[0].flagged;
  },
);
invalid(
  'target_label_inconsistent',
  'target_label_inconsistent',
  'prs[5].targets',
  (r) => {
    r.prs[5].targets = [];
  },
);
invalid(
  'result_counts_not_reproducible',
  'result_counts_not_reproducible',
  'retrospective.results[0].counts',
  (r) => {
    r.retrospective.results[0].counts.tp += 1;
  },
);
invalid(
  'result_metric_mismatch',
  'result_metric_mismatch',
  'retrospective.results[0].precision',
  (r) => {
    const c = r.retrospective.results[0].precision;
    c.value = Math.round((c.value + 0.001) * 1e6) / 1e6;
    c.ci.high = Math.min(1, c.ci.high + 0.01);
  },
);
invalid(
  'zero_denominator_shown',
  'zero_denominator_shown',
  'retrospective.results[0].precision',
  (r) => {
    // No scored PR is flagged, so precision has no denominator but is still shown.
    r.retrospective.calibrations[0].threshold.value = 1;
    for (const pr of r.prs)
      if (pr.predictions[0].status === 'scored')
        pr.predictions[0].flagged = pr.predictions[0].score >= 1;
  },
);
invalid(
  'forbidden_prediction_title',
  'schema_violation',
  'prs[0].predictions[0].title',
  (r) => {
    r.prs[0].predictions[0].title = 'untrusted';
  },
);
invalid(
  'forbidden_head_path',
  'schema_violation',
  'retrospective.heads[0].path',
  (r) => {
    r.retrospective.heads[0].path = '/models/head.bin';
  },
);
invalid(
  'unknown_target',
  'schema_violation',
  'retrospective.results[0].target',
  (r) => {
    r.retrospective.results[0].target = 'had_defect';
  },
);
invalid('schema_version_v1', 'schema_violation', 'schema_version', (r) => {
  r.schema_version = 'arbiter_report/v1';
});
const missing = ARBITER_REPORT_V2_INVARIANT_CODES.filter(
  (code) => !files.has(`invalid/${code}.json`),
);
if (missing.length)
  throw new Error(`v2 invariant fixtures missing: ${missing.join(', ')}`);

const expected = Object.fromEntries(
  [...files].map(([name, body]) => [name, hash(body)]),
);
const provenancePath = resolve(root, 'PROVENANCE.json');
if (check) {
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (
    provenance.schema_version !== ARBITER_REPORT_V2_SCHEMA_VERSION ||
    JSON.stringify(provenance.files) !== JSON.stringify(expected)
  )
    throw new Error('v2 report fixture provenance drift.');
  for (const [name, body] of files)
    if (readFileSync(resolve(root, name), 'utf8') !== body)
      throw new Error(`v2 report fixture drift: ${name}`);
  if (
    readFileSync(coreSchemaPath, 'utf8') !==
    files.get('arbiter-report.v2.schema.json')
  )
    throw new Error('Core v2 report JSON Schema drift.');
} else {
  for (const [name, body] of files) {
    const path = resolve(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  writeFileSync(coreSchemaPath, files.get('arbiter-report.v2.schema.json'));
  writeFileSync(
    provenancePath,
    stringify({
      status: 'proposed',
      schema_version: ARBITER_REPORT_V2_SCHEMA_VERSION,
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      command: 'pnpm export:arbiter-report',
      files: expected,
    }),
  );
}
console.log(
  check
    ? 'Arbiter report v2 fixtures current.'
    : 'Arbiter report v2 fixtures exported.',
);
