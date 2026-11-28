#!/usr/bin/env node
/**
 * Probe the Rework Risk example-report candidates (HOK-3515 step 1).
 *
 * Reads `fixtures/arbiter/example-reports/manifest.json`. For every candidate:
 *   1. Exclusion first. A repo in any corpus manifest the manifest lists, or
 *      in the optional private hashed list, is ineligible with the single
 *      reason `in_training_or_holdout` and is not probed. The reason is the
 *      same for development and evaluation-slice repos, and the slice
 *      manifest is never read, so the output does not say which are held out.
 *   2. Otherwise it is measured on GitHub with the cohort probe's code
 *      (scripts/corpus/lib/github-probe.mjs) over a window ending
 *      `horizon_days` before `--as-of`, and judged by `decideExample` from
 *      @hokusai/scan against the manifest thresholds.
 *
 * Results are written after every repo, so an interrupted run resumes with
 * `--retry-errors` (re-probes errors and repos not yet probed). The output
 * holds public repo metrics only. The hashed list's path and contents are
 * never written; only its SHA-256 is.
 *
 * Usage:
 *   node scripts/example-reports/probe.mjs [--manifest <json>] [--as-of <iso>]
 *     [--exclude-hashes <private json>] [--repo owner/name] [--retry-errors]
 *     [--out <json>] [--no-write]
 * Requires `gh` authenticated and `pnpm --filter @hokusai/scan build`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DEFAULT_REPORT_POLICY,
  EXAMPLE_SELECTION_VERSION,
  EXCLUDED_REASON,
  TrainingExclusion,
  decideExample,
  parseExampleManifest,
} from '../../packages/scan/dist/index.js';
import { canonicalRepo, probeRepo } from '../corpus/lib/github-probe.mjs';

const PROBE_VERSION = '0.1.0';
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const { values } = parseArgs({
  options: {
    manifest: {
      type: 'string',
      default: 'fixtures/arbiter/example-reports/manifest.json',
    },
    'as-of': { type: 'string' },
    'exclude-hashes': { type: 'string' },
    repo: { type: 'string' },
    'retry-errors': { type: 'boolean', default: false },
    out: {
      type: 'string',
      default: 'fixtures/arbiter/example-reports/probe.json',
    },
    'no-write': { type: 'boolean', default: false },
  },
  strict: true,
});

const resolve = (p) => path.resolve(repoRoot, p);
const sha256File = (p) =>
  createHash('sha256').update(readFileSync(p)).digest('hex');
const manifestPath = resolve(values.manifest);
const outputPath = resolve(values.out);
const manifest = parseExampleManifest(
  JSON.parse(readFileSync(manifestPath, 'utf8')),
  DEFAULT_REPORT_POLICY.min_reworked_for_retrospective,
);

const exclusion = new TrainingExclusion();
const corpusManifests = manifest.exclude_corpus_manifests.map((rel) => {
  exclusion.addCorpusManifest(JSON.parse(readFileSync(resolve(rel), 'utf8')));
  return { path: rel, sha256: sha256File(resolve(rel)) };
});
let hashedListSha256 = null;
if (values['exclude-hashes']) {
  const p = path.resolve(values['exclude-hashes']);
  exclusion.addHashedList(JSON.parse(readFileSync(p, 'utf8')));
  hashedListSha256 = sha256File(p);
}

const asOf = values['as-of'] ? new Date(values['as-of']) : new Date();
if (Number.isNaN(asOf.getTime()))
  throw new Error(`bad --as-of ${values['as-of']}`);
const day = 86_400_000;
const until = new Date(asOf.getTime() - manifest.horizon_days * day);
const window = {
  merged_from: new Date(until.getTime() - manifest.window_days * day)
    .toISOString()
    .slice(0, 10),
  merged_until: until.toISOString().slice(0, 10),
};

const previous =
  existsSync(outputPath) && (values['retry-errors'] || values.repo)
    ? JSON.parse(readFileSync(outputPath, 'utf8'))
    : null;
const done = new Map((previous?.results ?? []).map((r) => [r.repo, r]));
const targets = manifest.candidates.filter((c) => {
  if (values.repo) return c.repo === values.repo;
  if (values['retry-errors'])
    return !done.has(c.repo) || done.get(c.repo).error;
  return true;
});
if (values.repo && targets.length === 0)
  throw new Error(`${values.repo} is not a candidate in ${values.manifest}`);

function write() {
  if (values['no-write']) return;
  const results = manifest.candidates
    .map((c) => done.get(c.repo))
    .filter(Boolean);
  const eligible = results.filter((r) => r.eligible).length;
  const output = {
    probe_version: PROBE_VERSION,
    selection_version: EXAMPLE_SELECTION_VERSION,
    manifest_version: manifest.manifest_version,
    manifest_sha256: sha256File(manifestPath),
    probed_at: new Date().toISOString(),
    as_of: asOf.toISOString(),
    window,
    thresholds: manifest.thresholds,
    exclusion: {
      corpus_manifests: corpusManifests,
      hashed_list_sha256: hashedListSha256,
    },
    summary: {
      candidates: manifest.candidates.length,
      probed: results.length,
      eligible,
      errors: results.filter((r) => r.error).length,
    },
    results,
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}

if (!values.repo && !values['retry-errors']) done.clear();
for (const candidate of targets) {
  const base = {
    repo: candidate.repo,
    batch: candidate.batch,
    role: candidate.role,
  };
  if (exclusion.has(candidate.repo)) {
    done.set(candidate.repo, {
      ...base,
      eligible: false,
      reasons: [EXCLUDED_REASON],
    });
    write();
    continue;
  }
  process.stderr.write(`probing ${candidate.repo}\n`);
  const started = Date.now();
  try {
    // Exclusion is checked under the current name too, so a renamed corpus repo cannot slip in.
    const canonical = canonicalRepo(candidate.repo);
    if (canonical.toLowerCase() !== candidate.repo.toLowerCase()) {
      const reasons = exclusion.has(canonical)
        ? [EXCLUDED_REASON]
        : [`renamed: now ${canonical}; update the manifest`];
      done.set(candidate.repo, { ...base, eligible: false, reasons });
      write();
      continue;
    }
    const probed = probeRepo(candidate.repo, {
      window,
      defaultBranchAliases: candidate.default_branch_aliases ?? [],
    });
    const decision = decideExample(
      {
        archived: probed.archived,
        observed_merge_convention: probed.observed_merge_convention,
        metrics: probed.metrics,
      },
      manifest.thresholds,
      false,
    );
    done.set(candidate.repo, {
      ...base,
      ...decision,
      ...probed,
      probe_wall_ms: Date.now() - started,
    });
  } catch (error) {
    done.set(candidate.repo, {
      ...base,
      eligible: false,
      error: String(error.message ?? error).split('\n')[0],
    });
  }
  write();
}

const pct = (v) =>
  v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`;
const rows = [
  '| repo | batch | role | PRs/yr | reverts/yr | convention | base=default | PR-mapped | PR# in subject | agent | verdict |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
for (const c of manifest.candidates) {
  const r = done.get(c.repo);
  if (!r) continue;
  if (r.error)
    rows.push(
      `| ${r.repo} | ${r.batch} | ${r.role} | error: ${r.error.slice(0, 80)} ||||||| ✗ |`,
    );
  else if (!r.metrics)
    rows.push(
      `| ${r.repo} | ${r.batch} | ${r.role} | | | | | | | | ✗ ${r.reasons.join('; ')} |`,
    );
  else {
    const m = r.metrics;
    rows.push(
      `| ${r.repo} | ${r.batch} | ${r.role} | ${m.merged_prs_per_year} | ${m.revert_prs_per_year} | ${r.observed_merge_convention} | ${pct(m.base_is_default_share)} | ${pct(m.pr_mapped_commit_share)} | ${m.pr_number_in_subject_share == null ? '–' : pct(m.pr_number_in_subject_share)} | ${pct(m.agent_share)} | ${r.eligible ? '✓' : `✗ ${r.reasons.join('; ')}`} |`,
    );
  }
}
process.stdout.write(`${rows.join('\n')}\n`);
