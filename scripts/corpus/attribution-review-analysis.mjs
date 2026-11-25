#!/usr/bin/env node
/** Weighted analysis of a returned attribution review sheet (HOK-2822). Aggregates only. */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

export const VERDICTS = [
  'agent_evidence',
  'ordinary_automation',
  'no_evidence',
  'ambiguous',
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Join the returned sheet to the analysis-side strata; the sample must match exactly. */
export function joinReview(strata, labels, adjudication = []) {
  const byId = new Map(labels.map((row) => [row.id, row]));
  if (byId.size !== labels.length) throw new Error('Duplicate label id');
  if (
    strata.length !== labels.length ||
    strata.some((row) => !byId.has(row.id))
  )
    throw new Error('Returned sheet does not match the sample');
  const overrides = new Map(adjudication.map((row) => [row.id, row]));
  for (const id of overrides.keys())
    if (!byId.has(id)) throw new Error('Adjudicated id is not in the sample');
  return strata.map((row) => {
    const label = byId.get(row.id),
      override = overrides.get(row.id);
    for (const verdict of [label.verdict, override?.verdict])
      if (verdict !== undefined && !VERDICTS.includes(verdict))
        throw new Error('Unknown or missing verdict');
    if (!label.reviewer) throw new Error('Missing reviewer');
    return {
      stratum: row.stratum,
      cell: row.sampling_cell ?? `${row.repo}|${row.stratum}`,
      population: row.stratum_population,
      verdict: label.verdict,
      adjudicated_verdict: override?.verdict ?? label.verdict,
      inherited: label.evidence_scope === 'inherited_upstream',
    };
  });
}

/** 95% Wilson interval, for a pooled sample or as an unweighted indication. */
export function wilson(k, n) {
  if (!n) return null;
  const z = 1.959964,
    p = k / n,
    d = 1 + (z * z) / n,
    mid = p + (z * z) / (2 * n),
    half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (mid - half) / d), Math.min(1, (mid + half) / d)];
}

/** Stratified share of `verdict`, weighting each sampling cell by its population. */
export function weightedShare(rows, field, verdict) {
  const cells = new Map();
  for (const row of rows) {
    if (!cells.has(row.cell))
      cells.set(row.cell, { N: row.population, n: 0, k: 0 });
    const cell = cells.get(row.cell);
    cell.n += 1;
    if (row[field] === verdict) cell.k += 1;
  }
  let population = 0,
    count = 0,
    variance = 0,
    k = 0;
  for (const { N, n, k: hits } of cells.values()) {
    const p = hits / n;
    population += N;
    count += N * p;
    k += hits;
    if (n > 1 && N > n)
      variance += (N * N * (1 - n / N) * p * (1 - p)) / (n - 1);
  }
  return {
    estimate: count / population,
    standard_error: Math.sqrt(variance) / population,
    estimated_count: Math.round(count),
    raw: `${k}/${rows.length}`,
    raw_wilson95: wilson(k, rows.length),
  };
}

function summarize(rows, field) {
  const out = {};
  for (const stratum of [...new Set(rows.map((r) => r.stratum))].sort()) {
    const selected = rows.filter((r) => r.stratum === stratum);
    const cells = new Map(selected.map((r) => [r.cell, r.population]));
    out[stratum] = {
      sample: selected.length,
      sampling_cells: cells.size,
      population: [...cells.values()].reduce((a, b) => a + b, 0),
      verdicts: Object.fromEntries(
        VERDICTS.map((v) => [v, selected.filter((r) => r[field] === v).length]),
      ),
      agent_evidence_inherited_upstream: selected.filter(
        (r) => r[field] === 'agent_evidence' && r.inherited,
      ).length,
      weighted_agent_evidence: weightedShare(selected, field, 'agent_evidence'),
    };
  }
  return out;
}

export function analyzeReview(strata, labels, adjudication = []) {
  const rows = joinReview(strata, labels, adjudication);
  return {
    sample_size: rows.length,
    reviewer_count: new Set(labels.map((row) => row.reviewer)).size,
    as_labelled: summarize(rows, 'verdict'),
    adjudicated: adjudication.length
      ? {
          adjudicated_items: adjudication.length,
          changed_verdicts: rows.filter(
            (r) => r.verdict !== r.adjudicated_verdict,
          ).length,
          strata: summarize(rows, 'adjudicated_verdict'),
        }
      : null,
  };
}

/** Which rule-matched sample items the final verdicts confirm. */
export function ruleChecks(rows) {
  const out = {};
  for (const { rule, verdict } of rows) {
    if (!rule) continue;
    out[rule] ??= { matched: 0, agent_evidence: 0 };
    out[rule].matched += 1;
    if (verdict === 'agent_evidence') out[rule].agent_evidence += 1;
  }
  return out;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      strata: { type: 'string' },
      labels: { type: 'string' },
      adjudication: { type: 'string' },
      evidence: { type: 'string' },
      'protocol-version': { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (
    !values.strata ||
    !values.labels ||
    !values.out ||
    !values['protocol-version']
  )
    throw new Error('Supply --strata, --labels, --protocol-version and --out');
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const labels = read(values.labels),
    adjudication = values.adjudication ? read(values.adjudication).items : [];
  const report = {
    analysis_version: '1.0.0',
    protocol_version: values['protocol-version'],
    reviewer_type: 'independent_human',
    ...analyzeReview(read(values.strata), labels, adjudication),
    adjudicator: values.adjudication
      ? read(values.adjudication).adjudicator
      : null,
    inputs: {
      labels_sha256: sha(readFileSync(values.labels)),
      strata_sha256: sha(readFileSync(values.strata)),
      adjudication_sha256: values.adjudication
        ? sha(readFileSync(values.adjudication))
        : null,
    },
    notes: [
      'Weights are sampling-cell populations; raw sample fractions are not population rates.',
      'A cell with one sampled item, or with unanimous verdicts, contributes no estimated variance, so standard errors understate uncertainty.',
      'no_evidence does not establish human authorship.',
    ],
  };
  if (values.evidence) {
    const { detectBodyDisclosure, hasAiCodemodSubject } =
      await import('../../packages/scan/dist/attribution/disclosures.js');
    const final = new Map(labels.map((row) => [row.id, row.verdict]));
    for (const row of adjudication) final.set(row.id, row.verdict);
    report.disclosure_rule_checks = ruleChecks(
      readFileSync(values.evidence, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const item = JSON.parse(line);
          return {
            rule:
              detectBodyDisclosure(item.body_at_merge) ??
              (hasAiCodemodSubject(
                (item.commit_evidence ?? []).map((c) => c.message),
              )
                ? 'ai_codemod_subject'
                : null),
            verdict: final.get(item.id),
          };
        }),
    );
  }
  mkdirSync(values.out, { recursive: true });
  const name = `hok-2822-attribution-human-review-v${values['protocol-version']}.json`;
  writeFileSync(
    join(values.out, name),
    await format(JSON.stringify(report), { parser: 'json' }),
  );
  console.log(JSON.stringify(report, null, 2));
}
