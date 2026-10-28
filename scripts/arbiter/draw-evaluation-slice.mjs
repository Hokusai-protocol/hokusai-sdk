#!/usr/bin/env node
/**
 * Draw the private evaluation slice for the Rework Risk gate (HOK-3028 §4)
 * and print only its commitment hash.
 *
 * The slice is drawn mechanically, so per-repo base rates already seen in
 * HOK-3267/3268 cannot steer it:
 *   1. Repos: the cohort's runnable repos, split into three size bands by
 *      enumerated PR count (terciles), each band ordered by
 *      sha256(salt ‖ repo). The first REPOS_PER_BAND of each band form the
 *      slice; the rest of each band's order is the replacement order if
 *      HOK-3268 later drops a slice repo.
 *   2. Window: PRs merged in the last WINDOW_MONTHS months of the cohort
 *      window. If the slice has fewer than MIN_POSITIVES corrective
 *      positives at 30 days under the current labels, the window extends
 *      back EXTEND_MONTHS at a time, up to the whole cohort window.
 *      §4's power check is applied again at scoring, on the pinned target.
 *
 * The salt is generated here (32 random bytes) unless --salt is given. The
 * manifest is written, mode 0600, to --out, which must be outside this
 * repository. stdout gets the SHA-256 of the manifest file's exact bytes
 * and a power pass/fail only: never the repos, window or counts, so the
 * person or agent tuning arms need not learn the slice.
 *
 * Usage:
 *   node scripts/arbiter/draw-evaluation-slice.mjs \
 *     --cohort <hok-3022-cohort.json> --corpus <cache dir> --out <private path> [--salt <hex>]
 *
 * Verify later: sha256sum <manifest> must equal §4's holdout_sha256, and
 * re-running with the published salt must reproduce the same repos.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const PROCEDURE_VERSION = '1.0.0';
const REPOS_PER_BAND = 2;
const WINDOW_MONTHS = 6;
const EXTEND_MONTHS = 3;
const MIN_POSITIVES = 500;
const HORIZON_SECONDS = 30 * 86_400;
const RUNNABLE = new Set(['kept', 'pending_exception', 'unmeasured']);

const { values } = parseArgs({
  options: { cohort: { type: 'string' }, corpus: { type: 'string' }, out: { type: 'string' }, salt: { type: 'string' } },
  strict: true,
});
if (!values.cohort || !values.corpus || !values.out) {
  console.error('usage: draw-evaluation-slice.mjs --cohort <json> --corpus <dir> --out <private path> [--salt <hex>]');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(values.out);
const outDir = realpathSync(path.dirname(out));
if (outDir === repoRoot || outDir.startsWith(`${repoRoot}${path.sep}`)) {
  console.error('error: --out must be outside the repository; the manifest stays private until the result is published');
  process.exit(2);
}
if (existsSync(out)) {
  console.error(`error: ${out} exists; refusing to overwrite a drawn slice`);
  process.exit(2);
}
if (values.salt && !/^[0-9a-f]{64}$/.test(values.salt)) {
  console.error('error: --salt must be 64 lowercase hex characters');
  process.exit(2);
}

const cohortBytes = readFileSync(values.cohort);
const cohort = JSON.parse(cohortBytes.toString('utf8'));
const salt = values.salt ?? randomBytes(32).toString('hex');
const corpusDir = (repo) => path.join(values.corpus, repo.replace('/', '__'));

const sizes = cohort.repos
  .filter((r) => RUNNABLE.has(r.status))
  .map((r) => ({ repo: r.repo, prs: JSON.parse(readFileSync(path.join(corpusDir(r.repo), 'enumeration.json'), 'utf8')).prs }))
  .sort((a, b) => a.prs - b.prs || a.repo.localeCompare(b.repo));
if (sizes.length < 3 * REPOS_PER_BAND + 3) {
  console.error(`error: ${sizes.length} runnable repos is too few to hold out ${3 * REPOS_PER_BAND}`);
  process.exit(2);
}

const draw = (repo) => createHash('sha256').update(`${salt}\0${repo}`).digest('hex');
const bands = ['small', 'medium', 'large'].map((name, i) => {
  const members = sizes.slice(Math.floor((i * sizes.length) / 3), Math.floor(((i + 1) * sizes.length) / 3));
  const order = members.map((m) => m.repo).sort((a, b) => draw(a).localeCompare(draw(b)));
  return { band: name, slice: order.slice(0, REPOS_PER_BAND), replacement_order: order.slice(REPOS_PER_BAND) };
});
const repos = bands.flatMap((b) => b.slice).sort();

// Distinct originals in the slice with an accepted fix within 30 days, under the labels on disk.
const originalsWithFix = repos.flatMap((repo) => {
  const pairs = gunzipSync(readFileSync(path.join(corpusDir(repo), 'repair_pairs.jsonl.gz')))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const fixed = new Map();
  for (const p of pairs) if (p.lag_seconds <= HORIZON_SECONDS) fixed.set(p.original.pr_url, Date.parse(p.original.merged_at));
  return [...fixed.values()];
});

const until = new Date(`${cohort.window.merged_until}T00:00:00Z`);
const earliest = new Date(`${cohort.window.merged_from}T00:00:00Z`);
const monthsBefore = (date, months) => {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d < earliest ? earliest : d;
};
let months = WINDOW_MONTHS;
let from = monthsBefore(until, months);
const positivesIn = (start) => originalsWithFix.filter((t) => t >= start.getTime() && t < until.getTime()).length;
while (positivesIn(from) < MIN_POSITIVES && from > earliest) {
  months += EXTEND_MONTHS;
  from = monthsBefore(until, months);
}
const powered = positivesIn(from) >= MIN_POSITIVES;

const manifest = {
  procedure: 'hok-3028-evaluation-slice',
  procedure_version: PROCEDURE_VERSION,
  rules: { repos_per_band: REPOS_PER_BAND, window_months: WINDOW_MONTHS, extend_months: EXTEND_MONTHS, min_positives_30d: MIN_POSITIVES },
  cohort_manifest_sha256: createHash('sha256').update(cohortBytes).digest('hex'),
  salt,
  repos,
  bands,
  time_window: { merged_from: from.toISOString().slice(0, 10), merged_until: cohort.window.merged_until },
  drawn_at: new Date().toISOString(),
};
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
writeFileSync(out, bytes, { mode: 0o600, flag: 'wx' });

console.log(`holdout_sha256 = ${createHash('sha256').update(bytes).digest('hex')}`);
console.log(`power check (≥${MIN_POSITIVES} positives at 30d, current labels): ${powered ? 'pass' : 'FAIL: whole window is underpowered; do not freeze'}`);
console.log(`manifest written to ${out} (mode 0600). Store it privately; do not commit, upload or paste it.`);
