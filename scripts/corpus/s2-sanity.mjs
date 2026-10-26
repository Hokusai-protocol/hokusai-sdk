#!/usr/bin/env node
/**
 * Per repo × horizon sanity stats over labelled corpus repos (HOK-3268).
 * Streams each <cache>/<owner>__<repo>/s2.jsonl.gz plus the local prs.jsonl
 * (landing mix only; raw PR text is never read out) and prints one JSON object:
 * outcome mix, rework rate (1 − survival among labelled rows) with a 95% Wilson
 * interval, reason-code counts, follow-up split (line-range only / linked
 * reference only / both), undone_by mix, and why rows were left unlabelled.
 *
 * Usage: node scripts/corpus/s2-sanity.mjs <cache-dir> > sanity.json
 */
import { createReadStream, readdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';
const root = process.argv[2];
const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z*z/n, c = p + z*z/(2*n), m = z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n)); return [(c-m)/d, (c+m)/d]; };
const out = {};
for (const dir of readdirSync(root)) {
  const f = join(root, dir, 's2.jsonl.gz'); if (!existsSync(f)) continue;
  const landed = {};
  for await (const l of createInterface({ input: createReadStream(join(root, dir, 'prs.jsonl')) })) { if (!l) continue; const r = JSON.parse(l); landed[r.landed_by] = (landed[r.landed_by] ?? 0) + 1; }
  const H = {};
  for await (const l of createInterface({ input: createReadStream(f).pipe(createGunzip()), crlfDelay: Infinity })) {
    if (!l) continue;
    const r = JSON.parse(l), o = r.outcome, h = (H[r.horizon_days] ??= { rows: 0, mix: {}, reasons: {}, undone_by: {}, nullReasons: {}, onlyLinked: 0, onlyRange: 0, both: 0 });
    h.rows++;
    const ro = o.report_outcome ?? 'unlabelled';
    h.mix[ro] = (h.mix[ro] ?? 0) + 1;
    for (const c of o.reason_codes) h.reasons[c] = (h.reasons[c] ?? 0) + 1;
    if (ro === 'unlabelled') for (const c of o.reason_codes) h.nullReasons[c] = (h.nullReasons[c] ?? 0) + 1;
    if (ro !== 'survived' && ro !== 'unlabelled') h.undone_by[String(o.undone_by)] = (h.undone_by[String(o.undone_by)] ?? 0) + 1;
    const L = o.reason_codes.includes('linked_issue_or_pr'), R = o.reason_codes.includes('line_range_followup');
    if (ro === 'followup') { if (L && R) h.both++; else if (L) h.onlyLinked++; else if (R) h.onlyRange++; }
  }
  for (const h of Object.values(H)) {
    const n = h.rows - (h.mix.unlabelled ?? 0), k = n - (h.mix.survived ?? 0);
    h.labelled = n; h.rework = k / n; h.rework_ci = wilson(k, n);
  }
  out[dir] = { landed, horizons: H };
  process.stderr.write(dir + ' ');
}
console.log(JSON.stringify(out));
