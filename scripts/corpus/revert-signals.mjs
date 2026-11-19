#!/usr/bin/env node
/**
 * Revert-signal collector for the revert-signal study (rs-1.0.0,
 * docs/arbiter/revert-signal-study.md §3). For each sampled revert it records
 * the seven signals as true, false or null (missing), from evidence.jsonl, the
 * sample's candidates and public GitHub data via `gh api`.
 *
 * Output stays in the private sample directory: signals.jsonl, one row per
 * item, plus a cache of GitHub responses under signals-cache/ so a rerun is
 * free. stdout carries aggregate counts only, never repo names or PR URLs.
 *
 * Run it before the person's sheet comes back; the signal definitions are
 * fixed by the plan and must not change after labels are seen.
 *
 * Usage:
 *   node scripts/corpus/revert-signals.mjs --sample <private dir>
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { sample: { type: 'string' } } });
if (!values.sample) {
  console.error('usage: revert-signals.mjs --sample <private dir>');
  process.exit(2);
}
const dir = values.sample;
const cacheDir = join(dir, 'signals-cache');
mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

// §3 `breakage_text`: the regex tried on the HOK-3269 audited reverts, unchanged.
const BREAKAGE =
  /\b(break(s|ing)?|broke(n)?|fail(s|ed|ing|ures?)?|regress\w*|bug|crash\w*|panic\w*|error\w*|flak\w*|leak\w*|incorrect|wrong|issue with|problem|caus(es|ed|ing)|perf\w*|slow\w*|ci\b|red\b|test\w*)\b/i;
const BUG_LABEL = /bug|regression|crash|broken|flak|defect|incident/i;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

let apiCalls = 0;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function gh(path) {
  const key = createHash('sha256').update(path).digest('hex').slice(0, 24);
  const file = join(cacheDir, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  let out;
  for (let attempt = 0; ; attempt++) {
    // The search API allows 30 requests a minute.
    if (path.startsWith('search/')) sleep(2500);
    try {
      apiCalls++;
      out = { ok: true, data: JSON.parse(execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] })) };
      break;
    } catch (error) {
      const msg = String(error.stderr ?? error.message);
      if (/rate limit/i.test(msg) && attempt < 5) {
        sleep(65_000);
        continue;
      }
      if (/rate limit/i.test(msg)) throw new Error('GitHub rate limit hit repeatedly; rerun later (responses so far are cached)');
      out = { ok: false, status: /HTTP (\d+)/.exec(msg)?.[1] ?? 'error' };
      break;
    }
  }
  writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
  return out;
}

const parseUrl = (url) => {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(pull|commit)\/([0-9a-f]+|\d+)/.exec(url);
  return m ? { owner: m[1], repo: m[2], kind: m[3], id: m[4] } : null;
};

/** The revert's text with git trailers and quoted subjects removed, as on the HOK-3269 items. */
function revertText(fix) {
  const text = `${fix.title ?? ''}\n${fix.body ?? ''}`
    .split('\n')
    .filter((l) => !/^\s*(this reverts commit|reverts \S+#\d+|>)/i.test(l))
    .join('\n');
  return text.replace(/revert\s*"[^"]*"/gi, '');
}

function prInfo(owner, repo, number) {
  const r = gh(`repos/${owner}/${repo}/pulls/${number}`);
  if (!r.ok) return null;
  return { author: r.data.user?.login ?? null, merged_at: r.data.merged_at, merge_sha: r.data.merge_commit_sha, title: r.data.title, additions: r.data.additions, deletions: r.data.deletions };
}

function prFiles(owner, repo, number) {
  const r = gh(`repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
  return r.ok ? r.data.map((f) => f.filename).sort() : null;
}

function revertAuthor(fixUrl) {
  const u = parseUrl(fixUrl);
  if (!u) return null;
  if (u.kind === 'pull') return prInfo(u.owner, u.repo, u.id)?.author ?? null;
  const r = gh(`repos/${u.owner}/${u.repo}/commits/${u.id}`);
  return r.ok ? (r.data.author?.login ?? null) : null;
}

/** §3 `ci_red_after_merge`: any check run or commit status on the merge commit concluded failure. */
function ciRed(owner, repo, sha) {
  if (!sha) return null;
  const runs = gh(`repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`);
  const status = gh(`repos/${owner}/${repo}/commits/${sha}/status`);
  const runList = runs.ok ? (runs.data.check_runs ?? []) : [];
  const statuses = status.ok ? (status.data.statuses ?? []) : [];
  if (!runList.length && !statuses.length) return null;
  return runList.some((r) => r.conclusion === 'failure') || statuses.some((s) => s.state === 'failure');
}

/** §3 `linked_bug`: the revert references an issue with a bug/regression label, or one opened between merge and revert. */
function linkedBug(owner, repo, text, mergedAt, revertedAt) {
  const refs = new Set();
  for (const m of text.matchAll(new RegExp(`(?:^|[\\s(])#(\\d+)\\b|github\\.com/${owner}/${repo}/issues/(\\d+)`, 'gi'))) refs.add(m[1] ?? m[2]);
  let unreadable = 0;
  for (const n of refs) {
    const r = gh(`repos/${owner}/${repo}/issues/${n}`);
    if (!r.ok) {
      unreadable++;
      continue;
    }
    if (r.data.pull_request) continue;
    const labels = (r.data.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
    const opened = Date.parse(r.data.created_at);
    if (labels.some((l) => BUG_LABEL.test(l))) return true;
    if (opened >= Date.parse(mergedAt) && opened <= Date.parse(revertedAt)) return true;
  }
  // Every reference unreadable: unknown rather than false.
  return refs.size && unreadable === refs.size ? null : false;
}

/** §3 `relanded_unchanged`: within 60 days of the revert, a PR re-applies the original with the same files and a line diff within 10%. */
function relandedUnchanged(owner, repo, original, number, revertedAt) {
  const files = prFiles(owner, repo, number);
  if (!files || !original) return null;
  const lines = (original.additions ?? 0) + (original.deletions ?? 0);
  const from = new Date(Date.parse(revertedAt)).toISOString().slice(0, 10);
  const until = new Date(Date.parse(revertedAt) + 60 * DAY).toISOString().slice(0, 10);
  const words = (original.title ?? '').replace(/["#()[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const queries = [`repo:${owner}/${repo} is:pr is:merged merged:${from}..${until} ${number}`, `repo:${owner}/${repo} is:pr is:merged merged:${from}..${until} in:title "${words}"`];
  const seen = new Set();
  for (const q of queries) {
    const r = gh(`search/issues?q=${encodeURIComponent(q)}&per_page=20`);
    if (!r.ok) continue;
    for (const hit of r.data.items ?? []) {
      if (hit.number === Number(number) || seen.has(hit.number)) continue;
      seen.add(hit.number);
      if (/^\s*revert/i.test(hit.title)) continue;
      const other = prInfo(owner, repo, hit.number);
      const otherFiles = prFiles(owner, repo, hit.number);
      if (!other || !otherFiles) continue;
      const otherLines = (other.additions ?? 0) + (other.deletions ?? 0);
      const sameFiles = otherFiles.length === files.length && otherFiles.every((f, i) => f === files[i]);
      if (sameFiles && lines > 0 && Math.abs(otherLines - lines) <= 0.1 * lines) return true;
    }
  }
  return false;
}

const sample = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'));
const evidence = new Map(
  readFileSync(join(dir, 'evidence.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((e) => [e.item_id, e]),
);

const rows = [];
for (const item of sample.items) {
  const reverts = item.candidates.filter((c) => c.proxy === 'revert' && c.status === 'accepted').sort((a, b) => a.lag_days - b.lag_days);
  const cand = reverts[0];
  const ev = evidence.get(item.item_id);
  const fix = ev?.fixes.find((f) => f.url === cand.fix_url) ?? null;
  const u = parseUrl(item.pr_url);
  const original = prInfo(u.owner, u.repo, u.id);
  const mergedAt = original?.merged_at ?? ev?.original.merged_at;
  const revertedAt = fix?.merged_at ?? (mergedAt ? new Date(Date.parse(mergedAt) + cand.lag_days * DAY).toISOString() : null);
  const text = fix ? revertText(fix) : null;
  const reverter = revertAuthor(cand.fix_url);
  rows.push({
    item_id: item.item_id,
    revert_url: cand.fix_url,
    signals: {
      breakage_text: text === null ? null : BREAKAGE.test(text),
      bot_reason_public_ci: reverts.some((c) => c.revert_reason === 'public_ci' || c.revert_reason === 'autorevert'),
      ci_red_after_merge: ciRed(u.owner, u.repo, original?.merge_sha),
      linked_bug: text === null || !mergedAt || !revertedAt ? null : linkedBug(u.owner, u.repo, `${fix.title ?? ''}\n${fix.body ?? ''}`, mergedAt, revertedAt),
      fast_revert: cand.lag_days * DAY <= 48 * HOUR,
      other_reverter: original?.author && reverter ? original.author !== reverter : null,
      relanded_unchanged: revertedAt ? relandedUnchanged(u.owner, u.repo, original, u.id, revertedAt) : null,
    },
  });
}

writeFileSync(join(dir, 'signals.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
const summary = {};
for (const name of Object.keys(rows[0].signals)) {
  const v = rows.map((r) => r.signals[name]);
  summary[name] = { true: v.filter((x) => x === true).length, false: v.filter((x) => x === false).length, missing: v.filter((x) => x === null).length };
}
console.log(JSON.stringify({ items: rows.length, api_calls: apiCalls, signals: summary }));
