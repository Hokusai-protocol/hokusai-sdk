#!/usr/bin/env node
/**
 * Validate corpus S2 label files against the S2 schema before they leave the
 * machine (HOK-3266). Streams plain or gzipped JSONL, so multi-GB files never
 * load whole. Also checks the row count, and for a .gz the byte size, against
 * the neighbouring s2.summary.json when there is one: the size catches a label
 * file left over from an earlier run whose row count happens to match.
 *
 * Usage: node scripts/corpus/validate-s2.mjs <s2.jsonl[.gz]> [...]
 * Prints one JSON line per file; exits 1 if any row is invalid or counts disagree.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'packages/core/package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js');
const schema = JSON.parse(readFileSync(join(root, 'packages/core/schemas/arbiter-survival-label.schema.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

let failed = false;
for (const file of process.argv.slice(2)) {
  const input = file.endsWith('.gz') ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
  let ok = 0;
  let bad = 0;
  const errors = new Map();
  const versions = new Map();
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line) continue;
    const row = JSON.parse(line);
    const version = `${row.schema_version}/${row.envelope?.labeller_version}/${row.envelope?.integration_mode}`;
    versions.set(version, (versions.get(version) ?? 0) + 1);
    if (validate(row)) ok++;
    else {
      bad++;
      const key = `${validate.errors[0].instancePath} ${validate.errors[0].message}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
    }
  }
  const summaryPath = join(dirname(file), 's2.summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  const expected = summary?.rows ?? null;
  const countMatches = expected === null || expected === ok + bad;
  const expectedBytes = file.endsWith('.gz') ? (summary?.s2_gzip_bytes ?? null) : null;
  const bytes = statSync(file).size;
  const sizeMatches = expectedBytes === null || expectedBytes === bytes;
  if (bad || !countMatches || !sizeMatches) failed = true;
  console.log(JSON.stringify({ file, ok, bad, expected_rows: expected, bytes, expected_bytes: expectedBytes, versions: Object.fromEntries(versions), errors: Object.fromEntries(errors) }));
}
process.exit(failed ? 1 : 0);
