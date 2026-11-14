import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { REWORK_RISK_FEATURE_MANIFEST_VERSION } from '@hokusai/core';
import { runCorpusCli } from './cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const conformance = JSON.parse(
  readFileSync(join(here, '../../../../fixtures/arbiter/rework-risk/leakage-conformance.json'), 'utf8'),
) as { cases: { name: string; columns: string[]; allow_segments: boolean; expect_codes: string[] }[] };

const dir = mkdtempSync(join(tmpdir(), 'feature-audit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function audit(args: string[]) {
  let stdout = '';
  let stderr = '';
  const { exitCode } = runCorpusCli('corpus-feature-audit', args, {
    writeStdout: (text) => { stdout += text; },
    writeStderr: (text) => { stderr += text; },
    cwd: dir,
  });
  return { exitCode, stdout, stderr };
}

describe('corpus-feature-audit', () => {
  it.each(conformance.cases.map((item, index) => [item.name, item, index] as const))('%s', (_name, item, index) => {
    const file = `columns-${index}.json`;
    writeFileSync(join(dir, file), JSON.stringify(item.columns));
    const { exitCode, stdout } = audit(['--columns', file, ...(item.allow_segments ? ['--allow-segments'] : [])]);
    const result = JSON.parse(stdout) as { manifest_version: string; ok: boolean; errors: { code: string }[] };
    expect(result.errors.map((error) => error.code)).toEqual(item.expect_codes);
    expect(result.ok).toBe(item.expect_codes.length === 0);
    expect(exitCode).toBe(item.expect_codes.length === 0 ? 0 : 1);
    expect(result.manifest_version).toBe(REWORK_RISK_FEATURE_MANIFEST_VERSION);
  });

  it('prints the manifest', () => {
    const { exitCode, stdout } = audit(['--print-manifest']);
    expect(exitCode).toBe(0);
    expect((JSON.parse(stdout) as { manifest_version: string }).manifest_version).toBe(REWORK_RISK_FEATURE_MANIFEST_VERSION);
  });

  it('exits 2 on bad input rather than passing it', () => {
    writeFileSync(join(dir, 'empty.json'), '[]');
    writeFileSync(join(dir, 'object.json'), '{"columns":[]}');
    expect(audit([]).exitCode).toBe(2);
    expect(audit(['--columns', 'missing.json']).exitCode).toBe(2);
    expect(audit(['--columns', 'empty.json']).exitCode).toBe(2);
    expect(audit(['--columns', 'object.json']).exitCode).toBe(2);
    expect(audit(['--unknown']).exitCode).toBe(2);
  });
});
