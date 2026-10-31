import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { readGzipJsonlMembers, writeJsonl } from './cli.js';

const dir = mkdtempSync(join(tmpdir(), 'corpus-jsonl-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('writeJsonl', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ i, line_ranges: [{ path: `f${i}.ts` }] }));

  it('writes gzip members that read back as one JSONL stream', () => {
    const path = join(dir, 'rows.jsonl.gz');
    const written = writeJsonl(path, rows, { gzip: true, memberBytes: 200 });
    const raw = readFileSync(path);
    // Several members: each starts with the gzip magic bytes.
    expect(raw.toString('latin1').split('\x1f\x8b').length - 1).toBeGreaterThan(1);
    const text = gunzipSync(raw).toString('utf8');
    expect(text.trimEnd().split('\n').map((line) => JSON.parse(line) as unknown)).toEqual(rows);
    expect(written).toMatchObject({ bytes: Buffer.byteLength(text), writtenBytes: raw.length });
  });

  it('reads gzip members back one at a time', () => {
    const path = join(dir, 'members.jsonl.gz');
    writeJsonl(path, rows, { gzip: true, memberBytes: 200 });
    expect([...readGzipJsonlMembers(path)]).toEqual(rows);
  });

  it('writes plain JSONL without gzip', () => {
    const path = join(dir, 'rows.jsonl');
    const written = writeJsonl(path, rows);
    expect(readFileSync(path, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line) as unknown)).toEqual(rows);
    expect(written.bytes).toBe(written.writtenBytes);
  });
});
