#!/usr/bin/env node
/** Fixed-cohort full attribution pass (HOK-2822). Raw review evidence stays local. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { format } from 'prettier';
import { readPinnedRows } from './phase-two-exit.mjs';
import { chunkNumbers } from '../../packages/scan/dist/corpus/feature-capture.js';
import { loadEvidenceChunk } from '../../packages/scan/dist/corpus/feature-run.js';
import { bodyAt, labelsAt } from '../../packages/scan/dist/corpus/features.js';
import {
  HARNESS_REGISTRY,
  MODEL_SIGNATURES,
} from '../../packages/scan/dist/attribution/engine.js';
import { detectBodyDisclosure } from '../../packages/scan/dist/attribution/disclosures.js';
import { extractMetadataBlock } from '../../packages/scan/dist/attribution/metadata-block.js';
import { isDependencyBotLogin } from '../../packages/scan/dist/attribution/agent-markers.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pct = (value) =>
  value === null ? 'unavailable' : `${(value * 100).toFixed(2)}%`;
const rate = (k, n) => (n ? k / n : null);
const bump = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Post-review sensitivity rules; never folded into the predeclared v1 result. */
export const exploratoryDisclosure = detectBodyDisclosure;

/** Every added signal is explicit; topic labels and generic bot status are excluded. */
export function classifyAttribution(feature, record, evidence, protocol) {
  const f = feature.features;
  const body = evidence ? bodyAt(evidence, feature.as_of) : null;
  const labels = evidence ? labelsAt(evidence, feature.as_of) : null;
  const metadata = extractMetadataBlock(body);
  const metadataHead =
    typeof metadata?.headsha === 'string'
      ? metadata.headsha.toLowerCase()
      : null;
  const headMatches =
    !!record.head_sha && metadataHead === record.head_sha.toLowerCase();
  const metadataUsable = !metadataHead || headMatches;
  const harness =
    metadataUsable &&
    typeof metadata?.harness === 'string' &&
    HARNESS_REGISTRY.includes(metadata.harness.toLowerCase())
      ? metadata.harness.toLowerCase()
      : null;
  const model =
    typeof metadata?.model === 'string' ? metadata.model.toLowerCase() : null;
  // A first-party executed-model claim must be bound to the actual PR head.
  const executedRoute =
    headMatches &&
    metadata?.executedroute?.toLowerCase() === 'coder' &&
    !!model &&
    MODEL_SIGNATURES.some((s) => model.startsWith(s));
  const mappedLabels = (labels ?? []).filter(
    (label) => protocol.label_semantics[label.toLowerCase()] === 'agent',
  );
  const owner = protocol.owner_mappings[feature.repo] ?? {};
  const ownerAccount = (owner.agent_accounts ?? []).some(
    (account) => account.toLowerCase() === record.author_login?.toLowerCase(),
  );
  const ownerBranch = (owner.agent_branch_prefixes ?? []).some((prefix) =>
    evidence?.head_ref?.startsWith(prefix),
  );
  const signals = {
    known_agent_account: f['segment.agent.marked_by_account'] === true,
    agent_branch: f['segment.agent.marked_by_branch'] === true,
    agent_commit_or_landing: f['segment.agent.marked_by_commit'] === true,
    agent_body: f['segment.agent.marked_by_body'] === true,
    explicit_agent_label: mappedLabels.length > 0,
    bound_executed_route: executedRoute,
    declared_harness_metadata: harness !== null,
    owner_mapping: ownerAccount || ownerBranch,
  };
  const baseline = f['feature.agent.marker_present'] === true;
  const positive = baseline || Object.values(signals).some(Boolean);
  const genericBot =
    /\[bot\]$/i.test(record.author_login ?? '') ||
    record.author_type?.toLowerCase() === 'bot';
  const stratum = baseline
    ? 'baseline_positive'
    : positive
      ? 'added_positive'
      : genericBot
        ? 'bot_without_agent_evidence'
        : 'unmarked';
  return {
    baseline,
    positive,
    signals,
    genericBot,
    dependencyBot: isDependencyBotLogin(record.author_login),
    stratum,
    harness,
    executedModel: executedRoute ? model : null,
    heuristicModel:
      typeof f['segment.agent.exact_model'] === 'string'
        ? f['segment.agent.exact_model']
        : null,
    bodyUnavailable: body === null,
    labelsUnavailable: labels === null,
    ambiguousLabels: (labels ?? []).filter((label) =>
      protocol.ambiguous_tool_labels.includes(label.toLowerCase()),
    ),
    mappedLabels,
    metadataHeadMismatch: metadataHead !== null && !headMatches,
  };
}

function snippets(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      /assisted.by|co.authored.by|generated.with|authored (by|with)|written (by|with)|codex\/tasks|devin.ai\/sessions|claude.ai\/code|cursor.com\/(agents|background)|wavemill.meta|model\s*[=:]/i.test(
        lines[i],
      )
    )
      out.push(
        lines
          .slice(Math.max(0, i - 1), i + 3)
          .join('\n')
          .slice(0, 900),
      );
  }
  return [...new Set(out)].slice(0, 5);
}

export function chooseSample(rows, protocol) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.repo}|${row.stratum}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, group]) => {
      const n = protocol.sample_per_repo_stratum[group[0].stratum];
      return [...group]
        .sort((a, b) =>
          sha(
            `${protocol.seed}|${a.repo}|${a.stratum}|${a.pr_number}`,
          ).localeCompare(
            sha(`${protocol.seed}|${b.repo}|${b.stratum}|${b.pr_number}`),
          ),
        )
        .slice(0, n)
        .map((r) => ({
          ...r,
          stratum_population: group.length,
          stratum_sample: Math.min(n, group.length),
        }));
    });
}

export function summarizeAttribution(rows) {
  const keys = [
    'known_agent_account',
    'agent_branch',
    'agent_commit_or_landing',
    'agent_body',
    'explicit_agent_label',
    'bound_executed_route',
    'declared_harness_metadata',
    'owner_mapping',
  ];
  const signalCounts = Object.fromEntries(keys.map((key) => [key, 0])),
    additions = Object.fromEntries(keys.map((key) => [key, 0])),
    strata = {};
  for (const row of rows) {
    bump(strata, row.stratum);
    for (const [key, value] of Object.entries(row.signals))
      if (value) {
        bump(signalCounts, key);
        if (!row.baseline) bump(additions, key);
      }
  }
  const n = rows.length,
    base = rows.filter((r) => r.baseline).length,
    positive = rows.filter((r) => r.positive).length;
  return {
    eligible: n,
    baseline_marked: base,
    full_union: positive,
    added_unique: positive - base,
    baseline_rate: rate(base, n),
    full_union_rate: rate(positive, n),
    signal_counts: signalCounts,
    additional_by_signal_overlapping: additions,
    strata,
    generic_bot_authors: rows.filter((r) => r.genericBot).length,
    bot_without_agent_evidence: rows.filter((r) => r.genericBot && !r.positive)
      .length,
    dependency_bot_without_agent_evidence: rows.filter(
      (r) => r.dependencyBot && !r.positive,
    ).length,
    legacy_union_if_every_bot_counted: rows.filter(
      (r) => r.positive || r.genericBot,
    ).length,
    harness_metadata: rows.filter((r) => r.harness !== null).length,
    bound_executed_model: rows.filter((r) => r.executedModel !== null).length,
    heuristic_exact_model: rows.filter((r) => r.heuristicModel !== null).length,
    unavailable_body: rows.filter((r) => r.bodyUnavailable).length,
    unavailable_labels: rows.filter((r) => r.labelsUnavailable).length,
    conflicting_metadata_head: rows.filter((r) => r.metadataHeadMismatch)
      .length,
  };
}

export function renderAttribution(report) {
  const g = report.totals;
  const lines = [
    '# Full attribution evidence pass (HOK-2822)',
    '',
    `Protocol \`${report.protocol_version}\`, SHA-256 \`${report.protocol_sha256}\`. Same 18 repositories and fixed window as the baseline audit.`,
    `Denominator: ${g.eligible} PRs with non-null 30-day labels, merged in [${report.window.from}, ${report.window.until}).`,
    '',
    `Frozen baseline: **${pct(g.baseline_rate)}**. Full agent-or-harness union: **${pct(g.full_union_rate)}**, adding **${g.added_unique}** distinct PRs.`,
    `Macro full-union coverage: **${pct(report.macro_full_union_rate)}**. Repositories reaching 60%: **${report.repos_at_60_percent}**.`,
    '',
    'This measures observable attribution, not the true fraction of agent-written code or detector recall. Unknown remains unknown. No model performance was evaluated.',
    '',
    '| Repo | Eligible | Baseline | Full union | Added | Coverage | Bot without agent evidence | Unavailable body | Unavailable labels |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of report.repos)
    lines.push(
      `| ${r.repo} | ${r.eligible} | ${r.baseline_marked} | ${r.full_union} | ${r.added_unique} | ${pct(r.full_union_rate)} | ${r.bot_without_agent_evidence} | ${r.unavailable_body} | ${r.unavailable_labels} |`,
    );
  lines.push(
    '',
    '## Signal contributions',
    '',
    '| Signal | All identified PRs | Additional PRs beyond baseline |',
    '|---|---:|---:|',
  );
  for (const [key, n] of Object.entries(g.signal_counts).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    lines.push(
      `| ${key} | ${n} | ${g.additional_by_signal_overlapping[key] ?? 0} |`,
    );
  lines.push(
    '',
    'Signals overlap; their counts must not be summed. The union is deduplicated per PR.',
    '',
    `Counting every generic bot as an agent would yield ${g.legacy_union_if_every_bot_counted} identified PRs (${pct(rate(g.legacy_union_if_every_bot_counted, g.eligible))}). **${g.bot_without_agent_evidence}** bot-authored PRs have no agent evidence, including ${g.dependency_bot_without_agent_evidence} known dependency-bot PRs. They remain separate.`,
    '',
    `Known harness metadata: ${g.harness_metadata}. Head-bound executed-model metadata: ${g.bound_executed_model}. Heuristic exact-model observations: ${g.heuristic_exact_model}. These are distinct measurements.`,
    '',
    `Private stratified review packet: **${report.review_sample_size}** PRs. Sampling and populations are recorded locally; independent human precision is **pending**.`,
    'No repo-specific owner mappings were supplied. Only explicit generation/authorship/assistance label names count; bare AI/tool-topic labels do not. The policy is fixed in the protocol, not inferred from outcomes.',
    '',
    '## Exploratory disclosure extension (post-review)',
    '',
    `The fixed review sample exposed missed generic AI declarations, checked disclosure forms and named documentation-agent signatures. Separately declared extension 1.1.0 adds ${report.exploratory_extension.added_unique} PRs, for ${report.exploratory_extension.union} observed PRs (${pct(report.exploratory_extension.rate)}).`,
    'These rules were selected after the sample review. This sensitivity result is not independent validation, does not change the predeclared v1 union or sample membership, and does not modify frozen training features.',
    '',
    '## Gate recommendation',
    '',
    'The retained 60%-in-six-repos gate is not met by this evidence. Propose replacing the all-PR attribution percentage as a prerequisite for general-repo reports with: honest measured coverage and unknowns; independently validated attribution precision; and sufficient observed agent sample size for any agent-specific analysis. Keep exact-model reporting and routing gates separate. This is a proposal requiring a program decision, not an adopted threshold change.',
    '',
    'The 12 rendered Report v0 receipts and independent human review remain separate acceptance work. HOK-2822 stays In Progress.',
    '',
  );
  return lines.join('\n');
}

export async function runAttribution({
  cacheDir,
  outDir,
  privateOut,
  protocolPath,
  onRow,
}) {
  const protocol = json(protocolPath),
    root = 'fixtures/arbiter/corpus';
  const baseline = json(join(root, protocol.baseline));
  const source = json(join(root, 'hok-3022-run-manifest.json'));
  const features = json(join(root, 'hok-3023-feature-run-manifest.json'));
  if (
    JSON.stringify(protocol.window) !==
    JSON.stringify({ from: baseline.window.from, until: baseline.window.until })
  )
    throw new Error('Protocol window differs from pinned baseline');
  const from = Date.parse(protocol.window.from),
    until = Date.parse(protocol.window.until);
  mkdirSync(privateOut, { recursive: true, mode: 0o700 });
  if (
    spawnSync('git', ['-C', privateOut, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).status === 0
  )
    throw new Error('Private review evidence must be outside a git work tree');
  const summaries = [],
    allDerived = [],
    reviewItems = [],
    provenance = [],
    unavailable = [];
  for (const repoBase of baseline.repos) {
    const repo = repoBase.repo,
      dir = join(cacheDir, repo.replace('/', '__'));
    const byNumber = new Map(),
      eligible = new Set();
    const fPin = features.repos.find((r) => r.repo === repo);
    const sPin = source.inputs.find(
      (r) => r.repo === repo && r.file === 's2.jsonl.gz',
    );
    await readPinnedRows(join(dir, 'features.jsonl.gz'), fPin, (row) => {
      byNumber.set(row.pr_number, row);
    });
    await readPinnedRows(join(dir, 's2.jsonl.gz'), sPin, (row) => {
      if (row.horizon_days !== 30 || row.outcome.report_outcome === null)
        return;
      const number = Number(row.prUrl.split('/').at(-1)),
        feature = byNumber.get(number);
      if (!feature)
        throw new Error('S2 identity is absent from pinned features');
      const at = Date.parse(feature.as_of);
      if (at >= from && at < until) eligible.add(number);
    });
    if (eligible.size !== repoBase.attribution.eligible)
      throw new Error('Eligibility changed from baseline');
    const recordsBytes = readFileSync(join(dir, 'prs.jsonl'));
    const records = new Map(
      recordsBytes
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const row = JSON.parse(line);
          return [row.pr_number, row];
        }),
    );
    const evidenceHash = createHash('sha256'),
      rows = [],
      privateByNumber = new Map();
    for (const chunk of chunkNumbers([...byNumber.keys()])) {
      if (!chunk.some((n) => eligible.has(n))) continue;
      for (const kind of ['evidence', 'timeline']) {
        const file = join(
          dir,
          'feature-evidence',
          kind,
          `${chunk[0]}-${chunk.at(-1)}.json.gz`,
        );
        evidenceHash.update(`${kind}:${chunk[0]}:${chunk.at(-1)}:`);
        evidenceHash.update(existsSync(file) ? readFileSync(file) : 'missing');
      }
      let evidence;
      try {
        evidence = loadEvidenceChunk(dir, chunk).evidence;
      } catch {
        evidence = new Map();
        unavailable.push({ repo, chunk, reason: 'missing_capture' });
      }
      for (const number of chunk) {
        if (!eligible.has(number)) continue;
        const f = byNumber.get(number),
          r = records.get(number),
          e = evidence.get(number) ?? null;
        if (
          !r ||
          r.repo !== repo ||
          r.merge_sha !== f.merge_sha ||
          Date.parse(r.merged_at) !== Date.parse(f.as_of)
        )
          throw new Error(
            'Cached PR identity differs from frozen feature identity',
          );
        if (e?.merged_at && Date.parse(e.merged_at) !== Date.parse(f.as_of))
          throw new Error('Historical evidence cutoff mismatch');
        const result = classifyAttribution(f, r, e, protocol);
        const row = { repo, pr_number: number, ...result };
        row.exploratoryDisclosure = exploratoryDisclosure(
          e ? bodyAt(e, f.as_of) : null,
        );
        rows.push(row);
        // Later protocols derive their own measurement from the same frozen rows.
        onRow?.(row, { feature: f, record: r, evidence: e });
        privateByNumber.set(number, { f, r, e });
      }
    }
    const summary = summarizeAttribution(rows);
    if (summary.baseline_marked !== repoBase.attribution.agent_marked)
      throw new Error('Frozen marker baseline changed');
    summaries.push({ repo, ...summary });
    allDerived.push(...rows);
    for (const row of chooseSample(rows, protocol)) {
      const { f, r, e } = privateByNumber.get(row.pr_number);
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
      const body = e ? bodyAt(e, f.as_of) : null;
      reviewItems.push({
        ...row,
        id: sha(`${protocol.seed}|${repo}|${row.pr_number}`).slice(0, 20),
        pr_url: r.pr_url,
        merge_time: f.as_of,
        author_login: r.author_login,
        author_type: r.author_type,
        branch: e?.head_ref ?? null,
        labels_at_merge: e ? labelsAt(e, f.as_of) : null,
        excerpts: snippets(
          [
            body ?? '',
            ...(e?.commits.map(
              (c) => `${c.author_name} <${c.author_email}>\n${c.message}`,
            ) ?? []),
            landing,
          ].join('\n'),
        ),
        body_at_merge: body,
        commit_evidence: e?.commits ?? null,
        landing_message: landing,
        independent_human_verdict: null,
        independent_human_reviewer: null,
      });
    }
    provenance.push({
      repo,
      prs_sha256: sha(recordsBytes),
      evidence_sha256: evidenceHash.digest('hex'),
      feature_sha256: fPin.sha256,
      s2_sha256: sPin.sha256,
    });
    process.stderr.write(
      `Measured ${repo}: ${summary.full_union}/${summary.eligible}, added ${summary.added_unique}\n`,
    );
  }
  const totals = summarizeAttribution(allDerived);
  const report = {
    measurement_version: '1.0.0',
    protocol_version: protocol.protocol_version,
    protocol_sha256: sha(readFileSync(protocolPath)),
    baseline_sha256: sha(readFileSync(join(root, protocol.baseline))),
    source_run_id: source.run_id,
    window: protocol.window,
    totals,
    macro_full_union_rate:
      summaries.reduce((sum, r) => sum + r.full_union_rate, 0) /
      summaries.length,
    repos_at_60_percent: summaries.filter(
      (r) => r.eligible >= 20 && r.full_union_rate >= 0.6,
    ).length,
    review_sample_size: reviewItems.length,
    independent_human_precision: null,
    exploratory_extension: {
      ...json(join(root, 'hok-2822-attribution-extension.json')),
      sha256: sha(
        readFileSync(join(root, 'hok-2822-attribution-extension.json')),
      ),
      added_unique: allDerived.filter(
        (r) => !r.positive && r.exploratoryDisclosure !== null,
      ).length,
      union: allDerived.filter(
        (r) => r.positive || r.exploratoryDisclosure !== null,
      ).length,
      rate: rate(
        allDerived.filter((r) => r.positive || r.exploratoryDisclosure !== null)
          .length,
        allDerived.length,
      ),
      repos: summaries.map((r) => {
        const selected = allDerived.filter((row) => row.repo === r.repo);
        const added = selected.filter(
          (row) => !row.positive && row.exploratoryDisclosure !== null,
        ).length;
        return {
          repo: r.repo,
          added_unique: added,
          union: r.full_union + added,
          eligible: r.eligible,
          rate: rate(r.full_union + added, r.eligible),
        };
      }),
    },
    missing_capture_batches: unavailable.length,
    repos: summaries,
    provenance,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'hok-2822-full-attribution.json'),
    await format(JSON.stringify(report), { parser: 'json' }),
  );
  writeFileSync(
    join(outDir, 'hok-2822-full-attribution.md'),
    await format(renderAttribution(report), { parser: 'markdown' }),
  );
  writeFileSync(
    join(privateOut, 'review-evidence.jsonl'),
    reviewItems.map((r) => JSON.stringify(r)).join('\n') + '\n',
    { mode: 0o600 },
  );
  writeFileSync(
    join(privateOut, 'derived-attribution.jsonl'),
    allDerived.map((r) => JSON.stringify(r)).join('\n') + '\n',
    { mode: 0o600 },
  );
  writeFileSync(
    join(privateOut, 'missing-captures.json'),
    JSON.stringify(unavailable, null, 2),
    { mode: 0o600 },
  );
  if (!existsSync(join(privateOut, 'review-labels.json')))
    writeFileSync(
      join(privateOut, 'review-labels.json'),
      JSON.stringify(
        reviewItems.map(
          ({ id, repo, stratum, stratum_population, stratum_sample }) => ({
            id,
            repo,
            stratum,
            stratum_population,
            stratum_sample,
            verdict: null,
            reviewer: null,
            note: null,
          }),
        ),
        null,
        2,
      ),
      { mode: 0o600 },
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
      'private-out': { type: 'string' },
      protocol: {
        type: 'string',
        default: 'fixtures/arbiter/corpus/hok-2822-attribution-protocol.json',
      },
    },
  });
  if (!values['cache-dir'] || !values.out || !values['private-out'])
    throw new Error('Supply --cache-dir, --out and --private-out');
  const report = await runAttribution({
    cacheDir: values['cache-dir'],
    outDir: values.out,
    privateOut: values['private-out'],
    protocolPath: values.protocol,
  });
  console.log(
    JSON.stringify(
      {
        ...report.totals,
        review_sample_size: report.review_sample_size,
        missing_capture_batches: report.missing_capture_batches,
      },
      null,
      2,
    ),
  );
}
