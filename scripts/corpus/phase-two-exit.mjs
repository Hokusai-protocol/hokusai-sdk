#!/usr/bin/env node
/** HOK-2822: audit persisted corpus evidence without rescanning or fitting models. */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { format } from 'prettier';

const HORIZONS = [14, 30, 60];
const OUTCOMES = [
  'survived',
  'followup',
  'substantially_rewritten',
  'reverted',
];
const DAY = 86_400_000;
const rate = (k, n) => (n ? k / n : null);
const pct = (v) => (v === null ? 'unavailable' : `${(v * 100).toFixed(2)}%`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Hash the exact compressed bytes consumed, including concatenated gzip members. */
export async function readPinnedRows(path, expected, visit) {
  const hash = createHash('sha256');
  const tap = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const unzip = createGunzip();
  // Attach the handler immediately, even if the reader fails before the pipe does.
  const pumping = pipeline(createReadStream(path), tap, unzip);
  pumping.catch(() => {});
  let rows = 0;
  try {
    for await (const line of createInterface({
      input: unzip,
      crlfDelay: Infinity,
    })) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error('Invalid JSON in pinned corpus input');
      }
      visit(row);
      rows++;
    }
    await pumping;
  } catch (error) {
    unzip.destroy();
    await pumping.catch(() => {});
    throw error;
  }
  if (hash.digest('hex') !== expected.sha256 || rows !== expected.rows)
    throw new Error(
      'Corpus input digest or row count differs from committed manifest',
    );
  return rows;
}

const newMix = () =>
  Object.fromEntries(
    HORIZONS.map((h) => [
      h,
      {
        prs: 0,
        labelled: 0,
        missing: 0,
        outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, 0])),
        missing_reasons: {},
      },
    ]),
  );

function tally(mix, row) {
  const cell = mix[row.horizon_days];
  if (!cell) throw new Error('Unexpected S2 horizon');
  cell.prs++;
  const outcome = row.outcome.report_outcome;
  if (outcome === null) {
    cell.missing++;
    for (const code of row.outcome.reason_codes)
      cell.missing_reasons[code] = (cell.missing_reasons[code] ?? 0) + 1;
  } else {
    if (!OUTCOMES.includes(outcome)) throw new Error('Unexpected S2 outcome');
    cell.labelled++;
    cell.outcomes[outcome]++;
  }
}

function finishMix(mix) {
  for (const cell of Object.values(mix)) {
    cell.rates = Object.fromEntries(
      OUTCOMES.map((o) => [o, rate(cell.outcomes[o], cell.labelled)]),
    );
    cell.non_survival_rate = rate(
      cell.labelled - cell.outcomes.survived,
      cell.labelled,
    );
  }
  return mix;
}

export async function auditRepo({
  repo,
  directory,
  s2Pin,
  featurePin,
  from,
  until,
  asOf,
  featureVersion,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error('Invalid repo identity');
  const prs = new Map();
  await readPinnedRows(
    join(directory, 'features.jsonl.gz'),
    featurePin,
    (row) => {
      if (
        row.repo !== repo ||
        row.manifest_version !== featureVersion ||
        !Number.isInteger(row.pr_number) ||
        prs.has(row.pr_number)
      )
        throw new Error('Invalid or duplicate feature identity/version');
      const at = Date.parse(row.as_of);
      if (!Number.isFinite(at)) throw new Error('Invalid feature merge time');
      const marker = row.features['feature.agent.marker_present'];
      if (marker !== null && typeof marker !== 'boolean')
        throw new Error('Invalid agent marker');
      prs.set(row.pr_number, {
        inWindow: at >= from && at < until,
        at,
        marker,
        family: row.features['feature.agent.tool_family'],
        exactModel: row.features['segment.agent.exact_model'],
        horizons: new Set(),
      });
    },
  );
  const full = newMix(),
    window = newMix();
  const versions = new Set();
  await readPinnedRows(join(directory, 's2.jsonl.gz'), s2Pin, (row) => {
    const prefix = `https://github.com/${repo}/pull/`;
    if (
      typeof row.prUrl !== 'string' ||
      !row.prUrl.startsWith(prefix) ||
      !/^\d+$/.test(row.prUrl.slice(prefix.length))
    )
      throw new Error('S2 repo identity mismatch');
    const pr = prs.get(Number(row.prUrl.slice(prefix.length)));
    if (!pr || pr.horizons.has(row.horizon_days))
      throw new Error('Unmatched or duplicate S2 PR/horizon');
    pr.horizons.add(row.horizon_days);
    if (
      pr.at + row.horizon_days * DAY > asOf &&
      row.outcome.report_outcome !== null
    )
      throw new Error('Observed outcome has an immature horizon');
    versions.add(
      `${row.schema_version}/${row.envelope.labeller_version}/${row.envelope.normalization_version}`,
    );
    tally(full, row);
    if (pr.inWindow) tally(window, row);
    if (pr.inWindow && row.horizon_days === 30)
      pr.eligible = row.outcome.report_outcome !== null;
  });
  if ([...prs.values()].some((pr) => pr.horizons.size !== HORIZONS.length))
    throw new Error('Missing S2 horizon');
  const selected = [...prs.values()].filter((pr) => pr.inWindow && pr.eligible);
  const agent = selected.filter((pr) => pr.marker === true).length;
  const exact = selected.filter(
    (pr) => typeof pr.exactModel === 'string',
  ).length;
  const families = {};
  for (const pr of selected)
    if (pr.marker === true && typeof pr.family === 'string')
      families[pr.family] = (families[pr.family] ?? 0) + 1;
  return {
    repo,
    versions: [...versions].sort(),
    full_history: finishMix(full),
    lookback: finishMix(window),
    attribution: {
      denominator: '30-day labelled PRs in merge-time lookback',
      eligible: selected.length,
      agent_marked: agent,
      unknown: selected.length - agent,
      evidence_unavailable: selected.filter((pr) => pr.marker === null).length,
      agent_marker_rate: rate(agent, selected.length),
      tool_families: families,
      heuristic_exact_model: exact,
      heuristic_exact_model_rate: rate(exact, selected.length),
      qualifies_volume: selected.length >= 20,
      reaches_marker_floor:
        selected.length >= 20 && agent / selected.length >= 0.6,
    },
  };
}

/** Marker coverage is evidence, not a substitute for the full R4 gate or manual precision. */
export function summarizeGate(repos) {
  const qualified = repos.filter((r) => r.attribution.qualifies_volume);
  const count = qualified.reduce((n, r) => n + r.attribution.eligible, 0);
  const marked = qualified.reduce((n, r) => n + r.attribution.agent_marked, 0);
  const rates = qualified.map((r) => r.lookback[30].rates.survived);
  return {
    label_call:
      rates.length >= 10
        ? rates.every((r) => r > 0.97)
          ? 'degenerate_by_program_rule'
          : 'nondegenerate_base_rates'
        : 'insufficient_repos',
    qualifying_external_repos: qualified.length,
    repos_at_marker_floor: qualified.filter(
      (r) => r.attribution.reaches_marker_floor,
    ).length,
    macro_agent_marker_coverage: qualified.length
      ? qualified.reduce((n, r) => n + r.attribution.agent_marker_rate, 0) /
        qualified.length
      : null,
    micro_agent_marker_coverage: rate(marked, count),
    attribution_gate: 'not_demonstrated',
    manually_validated_precision: null,
    rendered_report_gate: 'not_demonstrated_by_corpus_labels',
    internal_repo_gate: 'not_in_this_external_corpus',
    phase_two_exit: 'not_passed',
  };
}

export function renderAudit(report) {
  const lines = [
    '# Phase 2 exit evidence audit (HOK-2822)',
    '',
    `Source run: \`${report.source_run_id}\`. S2 observation cutoff: ${report.as_of}.`,
    `Merge-time lookback: [${report.window.from}, ${report.window.until}), ${report.window.days} days.`,
    'This retrospective slice of the predeclared corpus is reused evidence, not a newly predeclared attribution cohort or a live scan.',
    '',
    `**Label call:** ${report.gate.label_call}. **Phase 2 exit:** NOT PASSED.`,
    'Nondegenerate base rates establish variation, not predictive lift or defect validity. No model was fitted or evaluated by this audit.',
    '',
    '## S2 outcome rates by repo and horizon',
    '',
    'Rates use labelled PRs only; missing labels are counted separately. S2 non-survival includes ordinary follow-up and is not the corrective event target.',
    '',
    '| Repo | Convention | H | PRs | Labelled | Missing | Survived | Follow-up | Rewritten | Reverted |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const repo of report.repos)
    for (const h of HORIZONS) {
      const c = repo.lookback[h];
      lines.push(
        `| ${repo.repo} | ${repo.merge_convention} | ${h} | ${c.prs} | ${c.labelled} | ${c.missing} | ${OUTCOMES.map((o) => pct(c.rates[o])).join(' | ')} |`,
      );
    }
  lines.push(
    '',
    '## Attribution evidence in the same lookback',
    '',
    'Denominator: 30-day labelled PRs; at least 20 per qualifying repo. Unknown is not human. Exact-model markers are heuristic observations, not first-party execution evidence.',
    'This uses the audited merge-time marker columns. It does not include a new full five-signal attribution run, owner label mappings, or manual precision validation.',
    '',
    '| Repo | Eligible | Agent marked | Unknown | Marker coverage | Heuristic exact-model coverage |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const { repo, attribution: a } of report.repos)
    lines.push(
      `| ${repo} | ${a.eligible} | ${a.agent_marked} | ${a.unknown} | ${pct(a.agent_marker_rate)} | ${pct(a.heuristic_exact_model_rate)} |`,
    );
  lines.push(
    '',
    `Macro agent-marker coverage: **${pct(report.gate.macro_agent_marker_coverage)}**. Micro: **${pct(report.gate.micro_agent_marker_coverage)}**. Repos reaching 60%: **${report.gate.repos_at_marker_floor}** (six required for the full attribution gate).`,
    '',
    '## Outstanding acceptance evidence',
    '',
    '- At least 12 genuine Report v0 payloads rendered through the existing site renderer, with render receipts. This table is not those reports.',
    '- Wavemill/Hokusai internal reports, and an explicitly predeclared external attribution cohort spanning agent ecosystems and conventions.',
    '- Full agent-or-harness signal coverage and precision from a manually validated sample; do not lower the 60% threshold or select a successful sample after inspecting outcomes.',
    '- Exact-model coverage remains separate; model comparisons and routing claims stay suppressed without sufficient coverage and evidence.',
    '',
    'The full-history counts are preserved in the JSON audit, separately from the 180-day slice. Existing HOK-3268 convention findings remain applicable; the generic scanner is not certified for every corpus enumerator convention by this audit.',
    '',
  );
  return lines.join('\n');
}

export async function runAudit({
  cacheDir,
  cohortPath,
  runPath,
  featurePath,
  outDir,
  days = 180,
}) {
  if (!Number.isInteger(days) || days <= 0)
    throw new Error('Lookback must be positive integer days');
  const cohort = readJson(cohortPath),
    run = readJson(runPath),
    features = readJson(featurePath);
  if (
    run.cohort_manifest_sha256 !== digest(readFileSync(cohortPath)) ||
    features.cohort_manifest_sha256 !== run.cohort_manifest_sha256
  )
    throw new Error('Cohort digest differs from source manifests');
  const until = Date.parse(cohort.window.merged_until),
    from = until - days * DAY,
    asOf = Date.parse(run.as_of);
  if (
    ![until, from, asOf].every(Number.isFinite) ||
    from < Date.parse(cohort.window.merged_from) ||
    asOf < until
  )
    throw new Error('Requested lookback is outside persisted corpus coverage');
  const kept = [...cohort.repos, ...(cohort.alternates ?? [])]
    .filter((r) => r.status === 'kept')
    .sort((a, b) => a.repo.localeCompare(b.repo));
  const repos = [];
  for (const entry of kept) {
    const s2Pin = run.inputs.find(
      (r) => r.repo === entry.repo && r.file === 's2.jsonl.gz',
    );
    const featurePin = features.repos.find((r) => r.repo === entry.repo);
    if (!s2Pin || !featurePin) throw new Error('Missing pinned input');
    const result = await auditRepo({
      repo: entry.repo,
      directory: join(cacheDir, entry.repo.replace('/', '__')),
      s2Pin,
      featurePin,
      from,
      until,
      asOf,
      featureVersion: features.manifest_version,
    });
    repos.push({
      ...result,
      merge_convention:
        entry.observed_merge_convention ?? entry.expected_merge_convention,
    });
    process.stderr.write(`Audited ${entry.repo}\n`);
  }
  const report = {
    audit_version: '1.0.0',
    issue: 'HOK-2822',
    source_run_id: run.run_id,
    as_of: run.as_of,
    source_manifest_sha256: digest(readFileSync(runPath)),
    feature_manifest_sha256: digest(readFileSync(featurePath)),
    feature_version: features.manifest_version,
    window: {
      from: new Date(from).toISOString(),
      until: new Date(until).toISOString(),
      days,
    },
    gate: summarizeGate(repos),
    repos,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'hok-2822-exit-audit.json'),
    await format(JSON.stringify(report), { parser: 'json' }),
  );
  writeFileSync(
    join(outDir, 'hok-2822-exit-audit.md'),
    await format(renderAudit(report), { parser: 'markdown' }),
  );
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        'cache-dir': { type: 'string' },
        out: { type: 'string' },
        cohort: {
          type: 'string',
          default: 'fixtures/arbiter/corpus/hok-3022-cohort.json',
        },
        'run-manifest': {
          type: 'string',
          default: 'fixtures/arbiter/corpus/hok-3022-run-manifest.json',
        },
        'feature-manifest': {
          type: 'string',
          default: 'fixtures/arbiter/corpus/hok-3023-feature-run-manifest.json',
        },
        'lookback-days': { type: 'string', default: '180' },
      },
    });
    if (!values['cache-dir'] || !values.out)
      throw new Error('Usage: phase-two-exit.mjs --cache-dir PATH --out PATH');
    const report = await runAudit({
      cacheDir: values['cache-dir'],
      outDir: values.out,
      cohortPath: values.cohort,
      runPath: values['run-manifest'],
      featurePath: values['feature-manifest'],
      days: Number(values['lookback-days']),
    });
    console.log(JSON.stringify(report.gate, null, 2));
  } catch (error) {
    console.error(`Exit audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
