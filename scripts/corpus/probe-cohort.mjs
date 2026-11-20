#!/usr/bin/env node
/**
 * Probe the HOK-3022 cohort before any label run.
 *
 * The manifest predeclares repos and their expected merge conventions from
 * memory; this measures them. For every repo (cohort + alternates) it asks the
 * GitHub GraphQL API, never a clone, for:
 *   - merged PRs in the last 12 months of the window, reverts, closed-unmerged
 *   - a 100-PR sample spread over the window: base branch, fix signals,
 *     closing-issue links, backports, agent attribution
 *   - a 100-commit default-branch sample: share mapped to a merged PR
 * and checks the manifest's `selection_thresholds`. Results go to
 * `fixtures/arbiter/corpus/hok-3022-probe.json`; a markdown table goes to
 * stdout. PR bodies and commit messages are read in memory only and never
 * written (decision-record contract §4.3).
 *
 * Usage: node scripts/corpus/probe-cohort.mjs [--repo owner/name] [--retry-errors] [--no-write]
 * Requires `gh` authenticated and `pnpm --filter @hokusai/scan build`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeRepo } from './lib/github-probe.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const manifestPath = path.join(
  repoRoot,
  'fixtures/arbiter/corpus/hok-3022-cohort.json',
);
const outputPath = path.join(
  repoRoot,
  'fixtures/arbiter/corpus/hok-3022-probe.json',
);
const PROBE_VERSION = '0.1.0';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

function checkThresholds(m, t) {
  const failures = [];
  if (m.merged_prs_per_year < t.min_merged_prs_per_year)
    failures.push(
      `merged_prs_per_year ${m.merged_prs_per_year} < ${t.min_merged_prs_per_year}`,
    );
  if ((m.base_is_default_share ?? 0) < t.min_base_is_default_share)
    failures.push(
      `base_is_default_share ${m.base_is_default_share} < ${t.min_base_is_default_share}`,
    );
  if ((m.pr_mapped_commit_share ?? 0) < t.min_pr_mapped_commit_share)
    failures.push(
      `pr_mapped_commit_share ${m.pr_mapped_commit_share} < ${t.min_pr_mapped_commit_share}`,
    );
  if ((m.fix_signal_share ?? 0) < t.min_fix_signal_share)
    failures.push(
      `fix_signal_share ${m.fix_signal_share} < ${t.min_fix_signal_share}`,
    );
  return failures;
}

function markdownTable(results) {
  const rows = [
    '| repo | PRs/yr | reverts/yr | convention | base=default | PR-mapped commits | fix signal | closes issue | agent | ignore-revs | verdict |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const pct = (value) =>
    value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`;
  for (const r of results) {
    if (r.error) {
      rows.push(
        `| ${r.repo} | error: ${r.error.split('\n')[0].slice(0, 80)} |||||||||| ✗ |`,
      );
      continue;
    }
    const m = r.metrics;
    rows.push(
      `| ${r.repo} | ${m.merged_prs_per_year} | ${m.revert_prs_per_year} | ${r.observed_merge_convention} | ${pct(m.base_is_default_share)} | ${pct(m.pr_mapped_commit_share)} | ${pct(m.fix_signal_share)} | ${pct(m.closes_issue_share)} | ${pct(m.agent_share)} | ${r.has_blame_ignore_revs ? 'yes' : 'no'} | ${r.failures.length ? `✗ ${r.failures.join('; ')}` : '✓'} |`,
    );
  }
  return rows.join('\n');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const only = argValue('--repo');
const retryErrors = process.argv.includes('--retry-errors');
const previous =
  (retryErrors || only) && existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf8'))
    : null;
const failed = new Set(
  previous?.results.filter((r) => r.error).map((r) => r.repo) ?? [],
);
const targets = [
  ...manifest.repos.map((r) => r.repo),
  ...manifest.alternates.map((r) => r.repo),
].filter(
  (repo) => (!only || repo === only) && (!retryErrors || failed.has(repo)),
);
const results = [];
for (const repo of targets) {
  process.stderr.write(`probing ${repo}\n`);
  try {
    const entry = [...manifest.repos, ...manifest.alternates].find(
      (r) => r.repo === repo,
    );
    const probed = probeRepo(repo, {
      window: manifest.window,
      defaultBranchAliases: entry?.default_branch_aliases ?? [],
    });
    results.push({
      ...probed,
      failures: checkThresholds(probed.metrics, manifest.selection_thresholds),
    });
  } catch (error) {
    results.push({ repo, error: error.message });
  }
}

// --retry-errors and --repo re-probe a subset and merge it back into the last results in place.
const merged = previous
  ? previous.results.map((r) => results.find((x) => x.repo === r.repo) ?? r)
  : results;
if (!process.argv.includes('--no-write')) {
  const output = {
    probe_version: PROBE_VERSION,
    manifest_version: manifest.manifest_version,
    probed_at: new Date().toISOString(),
    window: manifest.window,
    thresholds: manifest.selection_thresholds,
    results: merged,
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}
process.stdout.write(`${markdownTable(merged)}\n`);
