/**
 * Node-only session file discovery: explicit roots, session-id matching,
 * and path-free diagnostics.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readSessionFiles } from './node-fs.js';

const root = mkdtempSync(join(tmpdir(), 'hokusai-node-fs-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readSessionFiles', () => {
  it('matches .jsonl files by session id across nested roots, never by recency', () => {
    const claudeDir = join(root, 'projects', '-encoded-project');
    const codexDir = join(root, 'sessions', '2026', '01', '01');
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(claudeDir, 'session-aaaa.jsonl'), 'claude-content');
    writeFileSync(join(claudeDir, 'session-zzzz.jsonl'), 'other-session');
    writeFileSync(join(claudeDir, 'notes.txt'), 'not jsonl');
    writeFileSync(
      join(codexDir, 'rollout-2026-01-01T00-00-00-session-bbbb.jsonl'),
      'codex-content',
    );

    const result = readSessionFiles({
      roots: [root],
      sessionIds: ['session-aaaa', 'session-bbbb'],
    });
    expect(result.diagnostics).toEqual({});
    expect(result.files).toHaveLength(2);
    expect(result.files.map((file) => file.sessionId).sort()).toEqual([
      'session-aaaa',
      'session-bbbb',
    ]);
    expect(result.files.map((file) => file.content).sort()).toEqual([
      'claude-content',
      'codex-content',
    ]);
  });

  it('a missing root degrades to a count-only diagnostic, never a path', () => {
    const result = readSessionFiles({
      roots: [join(root, 'does-not-exist')],
      sessionIds: ['session-aaaa'],
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual({ unreadable_file: 1 });
    expect(JSON.stringify(result)).not.toContain('does-not-exist');
  });

  it('oversized files are skipped with a count', () => {
    const dir = join(root, 'oversized');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session-cccc.jsonl'), 'x'.repeat(64));
    const result = readSessionFiles({
      roots: [dir],
      sessionIds: ['session-cccc'],
      maxFileBytes: 16,
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual({ oversized_file: 1 });
  });
});
