import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  auditRepo,
  readPinnedRows,
  summarizeGate,
  renderAudit,
  runAudit,
} from './phase-two-exit.mjs';

test('end-to-end output reproduces and rejects a changed cohort', async (t) => {
  const f = fixture(t);
  const pins = f.pin();
  const cacheDir = join(f.directory, 'cache');
  mkdirSync(join(cacheDir, 'test__repo'), { recursive: true });
  for (const file of ['features.jsonl.gz', 's2.jsonl.gz'])
    writeFileSync(
      join(cacheDir, 'test__repo', file),
      readFileSync(join(f.directory, file)),
    );
  const cohortPath = join(f.directory, 'cohort.json');
  const runPath = join(f.directory, 'run.json');
  const featurePath = join(f.directory, 'feature-run.json');
  writeFileSync(
    cohortPath,
    JSON.stringify({
      window: { merged_from: '2026-01-01', merged_until: '2026-08-01' },
      repos: [
        {
          repo: 'test/repo',
          status: 'kept',
          observed_merge_convention: 'squash',
        },
      ],
    }),
  );
  const cohortHash = createHash('sha256')
    .update(readFileSync(cohortPath))
    .digest('hex');
  writeFileSync(
    runPath,
    JSON.stringify({
      run_id: 'test-run',
      as_of: '2026-11-01',
      cohort_manifest_sha256: cohortHash,
      inputs: [{ repo: 'test/repo', file: 's2.jsonl.gz', ...pins.s2Pin }],
    }),
  );
  writeFileSync(
    featurePath,
    JSON.stringify({
      cohort_manifest_sha256: cohortHash,
      manifest_version: 'test/1',
      repos: [{ repo: 'test/repo', ...pins.featurePin }],
    }),
  );
  const options = {
    cacheDir,
    cohortPath,
    runPath,
    featurePath,
    outDir: join(f.directory, 'out'),
  };
  await runAudit(options);
  const before = ['json', 'md'].map((ext) =>
    readFileSync(join(options.outDir, `hok-2822-exit-audit.${ext}`), 'utf8'),
  );
  await runAudit(options);
  assert.deepEqual(
    ['json', 'md'].map((ext) =>
      readFileSync(join(options.outDir, `hok-2822-exit-audit.${ext}`), 'utf8'),
    ),
    before,
  );
  writeFileSync(cohortPath, '{}');
  await assert.rejects(runAudit(options), /Cohort digest/);
});

function pinned(path, rows) {
  const bytes = gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path, bytes);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    rows: rows.length,
  };
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hok-2822-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const times = [
    '2026-01-31T00:00:00Z',
    '2026-02-01T00:00:00Z',
    '2026-02-02T00:00:00Z',
    '2026-08-01T00:00:00Z',
  ];
  const features = times.map((at, i) => ({
    repo: 'test/repo',
    pr_number: i + 1,
    as_of: at,
    manifest_version: 'test/1',
    features: {
      'feature.agent.marker_present': i === 1 ? true : null,
      'feature.agent.tool_family': i === 1 ? 'codex' : null,
      'segment.agent.exact_model': null,
    },
  }));
  const labels = times.flatMap((_, i) =>
    [14, 30, 60].map((h) => ({
      prUrl: `https://github.com/test/repo/pull/${i + 1}`,
      horizon_days: h,
      schema_version: '1.1.0',
      envelope: { labeller_version: '1.4.0', normalization_version: '1.0.0' },
      outcome: {
        report_outcome: i === 2 ? null : i === 1 ? 'followup' : 'survived',
        reason_codes: i === 2 ? ['inaccessible_history'] : [],
      },
    })),
  );
  const params = {
    repo: 'test/repo',
    directory,
    featureVersion: 'test/1',
    from: Date.parse(times[1]),
    until: Date.parse(times[3]),
    asOf: Date.parse('2026-11-01'),
  };
  const pin = () => ({
    ...params,
    featurePin: pinned(join(directory, 'features.jsonl.gz'), features),
    s2Pin: pinned(join(directory, 's2.jsonl.gz'), labels),
  });
  return { directory, labels, features, pin };
}

test('half-open lookback, missing outcomes and eligible attribution denominator', async (t) => {
  const { pin } = fixture(t);
  const result = await auditRepo(pin());
  assert.equal(result.full_history[30].prs, 4);
  assert.equal(result.lookback[30].prs, 2);
  assert.equal(result.lookback[30].missing, 1);
  assert.equal(result.lookback[30].rates.followup, 1);
  assert.equal(result.lookback[30].rates.survived, 0);
  assert.equal(result.attribution.eligible, 1);
  assert.equal(result.attribution.agent_marker_rate, 1);
  assert.equal(result.attribution.qualifies_volume, false);
});

test('reject changed pinned bytes and row counts', async (t) => {
  const { directory } = fixture(t);
  const file = join(directory, 'rows.gz');
  const pin = pinned(file, [{ safe: 1 }]);
  await assert.rejects(
    readPinnedRows(file, { ...pin, sha256: '0'.repeat(64) }, () => {}),
    /digest or row count/,
  );
  await assert.rejects(
    readPinnedRows(file, { ...pin, rows: 2 }, () => {}),
    /digest or row count/,
  );
});

test('reject duplicate PR/horizon and unmatched identities', async (t) => {
  const f = fixture(t);
  f.labels.push(f.labels[0]);
  await assert.rejects(auditRepo(f.pin()), /duplicate S2/);
  f.labels.pop();
  f.labels[0].prUrl = 'https://github.com/other/repo/pull/1';
  await assert.rejects(auditRepo(f.pin()), /identity mismatch/);
});

test('reject missing horizons, immature observed labels and incompatible features', async (t) => {
  const f = fixture(t);
  f.labels.pop();
  await assert.rejects(auditRepo(f.pin()), /Missing S2 horizon/);
  const params = f.pin();
  await assert.rejects(
    auditRepo({ ...params, asOf: Date.parse('2026-02-03') }),
    /immature/,
  );
  await assert.rejects(
    auditRepo({ ...params, featureVersion: 'wrong' }),
    /identity\/version/,
  );
});

test('unknown markers do not become human signals or observed negatives', async (t) => {
  const f = fixture(t);
  f.features[1].features['feature.agent.marker_present'] = null;
  const r = await auditRepo(f.pin());
  assert.equal(r.attribution.agent_marked, 0);
  assert.equal(r.attribution.unknown, 1);
  assert.equal(r.attribution.evidence_unavailable, 1);
  assert.equal(r.lookback[30].labelled, 1);
});

test('macro/micro coverage and 20-PR floor; a marker count never closes missing gates', () => {
  const repo = (eligible, marked, survived) => ({
    repo: 'test/repo',
    lookback: { 30: { rates: { survived } } },
    attribution: {
      eligible,
      agent_marked: marked,
      agent_marker_rate: marked / eligible,
      qualifies_volume: eligible >= 20,
      reaches_marker_floor: eligible >= 20 && marked / eligible >= 0.6,
    },
  });
  const gate = summarizeGate([
    repo(20, 20, 0.5),
    repo(100, 0, 0.5),
    repo(19, 19, 1),
  ]);
  assert.equal(gate.macro_agent_marker_coverage, 0.5);
  assert.equal(gate.micro_agent_marker_coverage, 1 / 6);
  assert.equal(gate.qualifying_external_repos, 2);
  assert.equal(gate.repos_at_marker_floor, 1);
  assert.equal(gate.label_call, 'insufficient_repos');
  const strong = summarizeGate(
    Array.from({ length: 10 }, () => repo(20, 20, 0.98)),
  );
  assert.equal(strong.label_call, 'degenerate_by_program_rule');
  assert.equal(strong.phase_two_exit, 'not_passed');
  assert.equal(strong.manually_validated_precision, null);
  assert.equal(strong.attribution_gate, 'not_demonstrated');
  assert.match(
    renderAudit({
      source_run_id: 'test',
      as_of: '2026-01-01',
      window: { from: 'a', until: 'b', days: 180 },
      repos: [],
      gate: strong,
    }),
    /This table is not those reports/,
  );
});
