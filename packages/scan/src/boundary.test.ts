/**
 * Mechanical enforcement of "explicit inputs only in the scanner core"
 * (REQ-F5, no-fork guarantee).
 *
 * The core modules may not read ambient process state — no `process.env`,
 * no `process.cwd`, no homedir/user probing — and may not reference the
 * pre-extraction home outside two frozen literals:
 *   - the legacy committed-config filename (read-only migration fallback)
 *   - the complexity metric id (a trained-model contract, kept verbatim)
 *
 * When this test fires, the fix is to add the leaked dependency to the
 * typed inputs (`inputs.ts` / `SurvivalLabellerDeps`), never to relax the
 * assertion or add a lint suppression.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));

/** The pure scanner core: every input must be explicit. */
const CORE_FILES = [
  'candidate-features.ts',
  'contract.ts',
  'diff-parsing.ts',
  'inputs.ts',
  'serialize.ts',
  'shell-utils.ts',
  'static-features.ts',
  'survival-labeller.ts',
];

/** Ambient reads forbidden inside the core files. */
const FORBIDDEN_PATTERNS = [
  /process\.env/,
  /process\.cwd/,
  /homedir/,
  /userInfo/,
  /process\.argv/,
];

/** The only pre-extraction-home literals allowed to remain, per file. */
const ALLOWED_LEGACY_LITERALS: Record<string, string[]> = {
  'static-features.ts': ['.wavemill-config.json', 'wavemill-cyclomatic/v1'],
};

describe('scanner core boundary', () => {
  for (const file of CORE_FILES) {
    it(`${file} reads no ambient process state`, () => {
      const source = readFileSync(join(srcDir, file), 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          pattern.test(source),
          `${file} matches forbidden pattern ${pattern} — make the dependency an explicit input`,
        ).toBe(false);
      }
    });

    it(`${file} carries no pre-extraction-home references beyond the frozen literals`, () => {
      let source = readFileSync(join(srcDir, file), 'utf-8');
      for (const literal of ALLOWED_LEGACY_LITERALS[file] ?? []) {
        source = source.split(literal).join('');
      }
      expect(
        /wavemill/i.test(source),
        `${file} references the pre-extraction home outside the allowed literals`,
      ).toBe(false);
    });
  }

  it('the allowed legacy literals each appear exactly once', () => {
    for (const [file, literals] of Object.entries(ALLOWED_LEGACY_LITERALS)) {
      const source = readFileSync(join(srcDir, file), 'utf-8');
      for (const literal of literals) {
        expect(
          source.split(literal).length - 1,
          `${literal} must appear exactly once in ${file}`,
        ).toBe(1);
      }
    }
  });

  it('only the ambient shells touch process.env', () => {
    const allowed = new Set(['default-deps.ts', 'cli.ts', 'cli-core.ts', 'action-entry.ts']);
    for (const file of readdirSync(srcDir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || allowed.has(file)) continue;
      const source = readFileSync(join(srcDir, file), 'utf-8');
      expect(
        /process\.env/.test(source),
        `${file} reads process.env but is not an ambient shell module`,
      ).toBe(false);
    }
  });
});
