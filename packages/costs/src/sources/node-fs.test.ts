import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DiagnosticTally } from './correlation.js';
import { discoverJsonlBlobs } from './node-fs.js';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hokusai-costs-node-fs-'));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('discoverJsonlBlobs', () => {
  it('returns blobs whose basename matches an allowed session id', async () => {
    const dir = join(root, 'happy');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'session-a.jsonl'), '{"a":1}\n');
    await writeFile(join(dir, 'session-b.jsonl'), '{"b":1}\n');
    await writeFile(join(dir, 'session-foreign.jsonl'), '{"c":1}\n');
    const blobs = await discoverJsonlBlobs({
      roots: [dir],
      allowedSessionIds: ['session-a', 'session-b'],
    });
    expect(blobs.map((b) => b.blob).sort()).toEqual([
      '{"a":1}\n',
      '{"b":1}\n',
    ]);
  });

  it('bumps `unreadable_file` when a root directory does not exist', async () => {
    const tally = new DiagnosticTally();
    const blobs = await discoverJsonlBlobs({
      roots: [join(root, 'does-not-exist')],
      allowedSessionIds: ['session-a'],
      tally,
    });
    expect(blobs).toHaveLength(0);
    expect(tally.toArray().find((d) => d.code === 'unreadable_file')?.count).toBe(1);
  });

  it('bumps `input_truncated` when maxFiles is exceeded', async () => {
    const dir = join(root, 'cap');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'session-a.jsonl'), 'a\n');
    await writeFile(join(dir, 'session-b.jsonl'), 'b\n');
    await writeFile(join(dir, 'session-c.jsonl'), 'c\n');
    const tally = new DiagnosticTally();
    const blobs = await discoverJsonlBlobs({
      roots: [dir],
      allowedSessionIds: ['session-a', 'session-b', 'session-c'],
      maxFiles: 2,
      tally,
    });
    expect(blobs).toHaveLength(2);
    expect(tally.toArray().find((d) => d.code === 'input_truncated')?.count).toBe(1);
  });

  it('ignores non-directory roots without throwing', async () => {
    const dir = join(root, 'file-root');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'not-a-dir.jsonl');
    await writeFile(filePath, 'x\n');
    const blobs = await discoverJsonlBlobs({
      roots: [filePath],
      allowedSessionIds: ['not-a-dir'],
    });
    expect(blobs).toHaveLength(0);
  });
});
