#!/usr/bin/env node
/** Protocol 1.2.0 measurement and fresh review packet (HOK-2822). Raw evidence stays local. */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { format } from 'prettier';
import { runAttribution } from './attribution-pass.mjs';
import {
  bodyAt,
  labelsAt,
  titleAt,
} from '../../packages/scan/dist/corpus/features.js';
import {
  detectBodyDisclosure,
  hasAiCodemodSubject,
  isUpstreamImportTitle,
} from '../../packages/scan/dist/attribution/disclosures.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const rate = (k, n) => (n ? k / n : null);
const pct = (value) =>
  value === null ? 'unavailable' : `${(value * 100).toFixed(2)}%`;
const AGENT_SAMPLE_FLOOR = 20;

/** Add the 1.2.0 rules to a frozen v1 row. A v1 positive is never removed. */
export function classifyV12(row, input, protocol) {
  const owner = protocol.owner_mappings[row.repo] ?? {};
  const login = input.authorLogin?.toLowerCase() ?? '';
  const rules = [];
  const bodyRule = detectBodyDisclosure(input.body);
  if (bodyRule && protocol.body_disclosure_rules.includes(bodyRule))
    rules.push(bodyRule);
  if (hasAiCodemodSubject(input.commitMessages ?? []))
    rules.push('ai_codemod_subject');
  if (
    (owner.agent_accounts ?? []).some((a) => a.toLowerCase() === login) ||
    (owner.agent_branch_prefixes ?? []).some((p) =>
      input.headRef?.startsWith(p),
    )
  )
    rules.push('owner_mapping');
  const stratum = row.positive
    ? 'v1_positive'
    : bodyRule && rules.includes(bodyRule)
      ? 'added_body_disclosure'
      : rules.includes('ai_codemod_subject')
        ? 'added_ai_codemod'
        : rules.includes('owner_mapping')
          ? 'added_owner_mapping'
          : row.genericBot
            ? 'bot_without_agent_evidence'
            : 'unmarked';
  return {
    repo: row.repo,
    pr_number: row.pr_number,
    v1_positive: row.positive,
    positive: row.positive || rules.length > 0,
    rules,
    stratum,
    inherited_upstream: isUpstreamImportTitle(input.title),
  };
}

export const sampleKey = (seed, row) =>
  sha(`${seed}|${row.stratum}|${row.repo}|${row.pr_number}`);

/** Pooled simple random sample per stratum, after removing excluded PRs. */
export function chooseFreshSample(rows, design, excluded = new Set()) {
  const out = [];
  for (const [stratum, n] of Object.entries(design.strata)) {
    const pool = rows
      .filter(
        (r) =>
          r.stratum === stratum && !excluded.has(`${r.repo}#${r.pr_number}`),
      )
      .map((r) => ({ ...r, key: sampleKey(design.seed, r) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    for (const row of pool.slice(0, n))
      out.push({
        ...row,
        sampling_cell: stratum,
        stratum_population: pool.length,
        stratum_sample: Math.min(n, pool.length),
      });
  }
  return out;
}

export function summarizeV12(rows) {
  const count = (test) => rows.filter(test).length;
  const byRule = {},
    strata = {};
  for (const row of rows) {
    strata[row.stratum] = (strata[row.stratum] ?? 0) + 1;
    if (!row.v1_positive)
      for (const rule of row.rules) byRule[rule] = (byRule[rule] ?? 0) + 1;
  }
  const union = count((r) => r.positive);
  return {
    eligible: rows.length,
    v1_union: count((r) => r.v1_positive),
    v1_2_union: union,
    added_unique: count((r) => r.positive && !r.v1_positive),
    v1_rate: rate(
      count((r) => r.v1_positive),
      rows.length,
    ),
    v1_2_rate: rate(union, rows.length),
    added_by_rule_overlapping: byRule,
    inherited_upstream_among_positives: count(
      (r) => r.positive && r.inherited_upstream,
    ),
    strata,
  };
}

export function renderV12(report) {
  const g = report.totals;
  const lines = [
    '# Attribution protocol 1.2.0 measurement (HOK-2822)',
    '',
    `Protocol \`${report.protocol_version}\`, SHA-256 \`${report.protocol_sha256}\`. Same cohort, window and denominator as protocol 1.0.0: ${g.eligible} PRs.`,
    '',
    `Frozen v1 union: **${g.v1_union}** (${pct(g.v1_rate)}). Protocol 1.2.0 union: **${g.v1_2_union}** (${pct(g.v1_2_rate)}), adding **${g.added_unique}** PRs.`,
    `Macro 1.2.0 coverage: **${pct(report.macro_v1_2_rate)}**. Repositories reaching 60%: **${report.repos_at_60_percent}**. Repositories with at least ${AGENT_SAMPLE_FLOOR} identified agent PRs: **${report.repos_with_agent_sample}** of ${report.repos.length}.`,
    '',
    'These are observable-evidence counts. The added rules were derived from the v1 review sample; their precision and the remaining miss rate are unmeasured until the fresh sample returns. Frozen feature rows and training inputs are unchanged.',
    '',
    '| Repo | Eligible | v1 union | 1.2.0 union | Added | 1.2.0 coverage | Inherited-upstream positives |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of report.repos)
    lines.push(
      `| ${r.repo} | ${r.eligible} | ${r.v1_union} | ${r.v1_2_union} | ${r.added_unique} | ${pct(r.v1_2_rate)} | ${r.inherited_upstream_among_positives} |`,
    );
  lines.push(
    '',
    '## Added PRs by rule',
    '',
    '| Rule | PRs added beyond v1 |',
    '|---|---:|',
  );
  for (const [rule, n] of Object.entries(g.added_by_rule_overlapping).sort(
    ([a], [b]) => a.localeCompare(b),
  ))
    lines.push(`| ${rule} | ${n} |`);
  lines.push(
    '',
    'A PR can match more than one rule; the union is deduplicated per PR.',
    '',
    `Positives with an inherited-upstream scope: **${g.inherited_upstream_among_positives}**. They stay in the union and are flagged, because their markers describe upstream work.`,
    '',
    '## Fresh review sample',
    '',
    '| Stratum | Population after excluding the v1 sample | Sampled |',
    '|---|---:|---:|',
  );
  for (const s of report.fresh_sample.strata)
    lines.push(`| ${s.stratum} | ${s.population} | ${s.sample} |`);
  lines.push(
    '',
    `**${report.fresh_sample.size}** PRs, drawn with seed \`${report.fresh_sample.seed}\`. The packet and unfilled sheet are private; independent labels are **pending**.`,
    '',
  );
  return lines.join('\n');
}

function packetMarkdown(items) {
  const lines = [
    '# Attribution audit: historical evidence (second sample)',
    '',
    `${items.length} items. Use the accompanying instructions. Fill the label sheet; return item IDs unchanged.`,
    '',
  ];
  for (const item of items)
    lines.push(
      `## Item ${item.id}`,
      '',
      `PR: ${item.pr_url}`,
      `Merged: ${item.merge_time}`,
      `Author account: ${item.author_login} (${item.author_type})`,
      `Branch: ${item.branch ?? '[unavailable]'}`,
      `Title at merge: ${item.title_at_merge ?? '[unavailable]'}`,
      `Labels at merge: ${JSON.stringify(item.labels_at_merge)}`,
      '',
      '### Historical body',
      '',
      item.body_at_merge ?? '[Historical body unavailable.]',
      '',
      '### Commit messages',
      '',
      ...(item.commit_evidence ?? []).flatMap((c) => [
        '```',
        `${c.author_name ?? ''} <${c.author_email ?? ''}>`,
        String(c.message).slice(0, 4000),
        '```',
      ]),
      '',
      '### Landing message',
      '',
      '```',
      item.landing_message || '[none captured]',
      '```',
      '',
    );
  return lines.join('\n');
}

export async function runV12({
  cacheDir,
  outDir,
  privateV1,
  privateOut,
  protocolPath,
}) {
  const protocol = json(protocolPath),
    root = 'fixtures/arbiter/corpus';
  const design = protocol.fresh_sample;
  const quota = Object.fromEntries(
    Object.entries(design.strata).map(([s, n]) => [s, n + 200]),
  );
  const rows = [],
    candidates = new Map(Object.keys(quota).map((s) => [s, []]));
  // The frozen v1 pass supplies rows; its own outputs are reproduced unchanged.
  await runAttribution({
    cacheDir,
    outDir: join(privateOut, 'v1-reproduction'),
    privateOut: privateV1,
    protocolPath: join(root, protocol.parent_protocol_file),
    onRow(row, { feature, record, evidence }) {
      const input = {
        authorLogin: record.author_login,
        headRef: evidence?.head_ref ?? null,
        body: evidence ? bodyAt(evidence, feature.as_of) : null,
        title: evidence ? titleAt(evidence, feature.as_of) : null,
        commitMessages: evidence?.commits.map((c) => c.message) ?? [],
      };
      const derived = classifyV12(row, input, protocol);
      rows.push(derived);
      const list = candidates.get(derived.stratum);
      if (!list) return;
      // Keep only the lowest keys, with room for the excluded v1 sample.
      list.push({
        key: sampleKey(design.seed, derived),
        feature,
        record,
        evidence,
        input,
      });
      if (list.length > quota[derived.stratum] * 2) {
        list.sort((a, b) => a.key.localeCompare(b.key));
        list.length = quota[derived.stratum];
      }
    },
  });
  const excluded = new Set(
    readFileSync(join(privateV1, 'review-evidence.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((item) => `${item.repo}#${item.pr_number}`),
  );
  const sample = chooseFreshSample(rows, design, excluded);
  const kept = new Map([...candidates.values()].flat().map((c) => [c.key, c]));
  const items = sample
    .map((row) => {
      const c = kept.get(row.key);
      if (!c) throw new Error('Sampled PR was not retained');
      const { feature: f, record: r, evidence: e, input } = c;
      const dir = join(cacheDir, row.repo.replace('/', '__'));
      let landing = '';
      if (!r.batched && /^[a-f0-9]{40}$/i.test(r.merge_sha))
        landing = execFileSync(
          'git',
          [
            '-C',
            join(dir, 'repo.git'),
            'show',
            '-s',
            '--format=%B',
            r.merge_sha,
          ],
          { encoding: 'utf8', maxBuffer: 2_000_000 },
        );
      return {
        id: sha(`${design.seed}|${row.repo}|${row.pr_number}`).slice(0, 20),
        pr_url: r.pr_url,
        repo: row.repo,
        pr_number: row.pr_number,
        merge_time: f.as_of,
        author_login: r.author_login,
        author_type: r.author_type,
        branch: input.headRef,
        title_at_merge: input.title,
        body_at_merge: input.body,
        labels_at_merge: e ? labelsAt(e, f.as_of) : null,
        commit_evidence: e?.commits ?? null,
        landing_message: landing,
        _row: row,
      };
    })
    // The auditor's files are ordered by id, which reveals no stratum.
    .sort((a, b) => a.id.localeCompare(b.id));
  const repos = [...new Set(rows.map((r) => r.repo))].map((repo) => ({
    repo,
    ...summarizeV12(rows.filter((r) => r.repo === repo)),
  }));
  const publicItems = items.map(({ _row, ...item }) => item);
  const sheet = JSON.stringify(
    publicItems.map(({ id, pr_url }) => ({
      id,
      pr_url,
      verdict: null,
      reviewer: null,
      note: null,
      evidence_scope: null,
    })),
    null,
    2,
  );
  const evidenceText =
    publicItems.map((item) => JSON.stringify(item)).join('\n') + '\n';
  const report = {
    measurement_version: '1.2.0',
    protocol_version: protocol.protocol_version,
    protocol_sha256: sha(readFileSync(protocolPath)),
    window: protocol.window,
    totals: summarizeV12(rows),
    macro_v1_2_rate:
      repos.reduce((sum, r) => sum + r.v1_2_rate, 0) / repos.length,
    repos_at_60_percent: repos.filter(
      (r) => r.eligible >= 20 && r.v1_2_rate >= 0.6,
    ).length,
    repos_with_agent_sample: repos.filter(
      (r) => r.v1_2_union >= AGENT_SAMPLE_FLOOR,
    ).length,
    fresh_sample: {
      seed: design.seed,
      size: items.length,
      excluded_v1_sample: excluded.size,
      strata: Object.keys(design.strata).map((stratum) => {
        const selected = sample.filter((r) => r.stratum === stratum);
        return {
          stratum,
          population: selected[0]?.stratum_population ?? 0,
          sample: selected.length,
        };
      }),
      unfilled_sheet_sha256: sha(sheet),
      evidence_sha256: sha(evidenceText),
      independent_human_validation: 'pending',
    },
    repos,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'hok-2822-attribution-v1.2.json'),
    await format(JSON.stringify(report), { parser: 'json' }),
  );
  writeFileSync(
    join(outDir, 'hok-2822-attribution-v1.2.md'),
    await format(renderV12(report), { parser: 'markdown' }),
  );
  mkdirSync(privateOut, { recursive: true, mode: 0o700 });
  const write = (name, text) =>
    writeFileSync(join(privateOut, name), text, { mode: 0o600 });
  write('HOK-2822-v2-auditor-evidence.jsonl', evidenceText);
  write('HOK-2822-v2-historical-evidence.md', packetMarkdown(publicItems));
  // Never overwrite a sheet the auditor may already have started.
  if (!existsSync(join(privateOut, 'HOK-2822-v2-auditor-labels.json')))
    write('HOK-2822-v2-auditor-labels.json', sheet);
  write(
    'review-strata.json',
    JSON.stringify(
      items.map(({ id, _row: r }) => ({
        id,
        repo: r.repo,
        stratum: r.stratum,
        sampling_cell: r.sampling_cell,
        stratum_population: r.stratum_population,
        stratum_sample: r.stratum_sample,
        rules: r.rules,
      })),
      null,
      2,
    ),
  );
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      'cache-dir': { type: 'string' },
      out: { type: 'string' },
      'private-v1': { type: 'string' },
      'private-out': { type: 'string' },
      protocol: {
        type: 'string',
        default:
          'fixtures/arbiter/corpus/hok-2822-attribution-protocol-v1.2.json',
      },
    },
  });
  for (const key of ['cache-dir', 'out', 'private-v1', 'private-out'])
    if (!values[key]) throw new Error(`Supply --${key}`);
  const report = await runV12({
    cacheDir: values['cache-dir'],
    outDir: values.out,
    privateV1: values['private-v1'],
    privateOut: values['private-out'],
    protocolPath: values.protocol,
  });
  console.log(
    JSON.stringify(
      { ...report.totals, fresh_sample: report.fresh_sample },
      null,
      2,
    ),
  );
}
