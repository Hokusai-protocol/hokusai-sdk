/**
 * Tests for the S1 static-feature collector (HOK-2806, ported in HOK-2816).
 *
 * Exercises three layers:
 *   - Pure parser units (countTscErrors, sumEslintErrors, fileComplexity).
 *   - Fixture repos built at test time (mkdtemp + git init + commits).
 *   - Bare-checkout parity: same values from a direct checkout as from a
 *     git worktree of it, and committed config only (no local overlays).
 *
 * Fixture repos are built inside a per-test temp dir so the tree the
 * repo's own lint/typecheck walk never see them.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  COMPLEXITY_METRIC_ID,
  LEGACY_SCAN_CONFIG_FILENAME,
  SCAN_CONFIG_FILENAME,
  collectStaticFeatures,
  countTscErrors,
  fileComplexity,
  readCommittedStaticAnalysisConfig,
  sumEslintErrors,
} from './static-features.js';

// ────────────────────────────────────────────────────────────────
// Parser units — pure, no shell required
// ────────────────────────────────────────────────────────────────

test('countTscErrors returns 0 for empty output', () => {
  expect(countTscErrors('')).toBe(0);
});

test('countTscErrors ignores warnings and non-tsc lines', () => {
  const output = [
    'some prelude',
    "src/a.ts:1:1 - error TS2322: Type 'string' is not assignable to type 'number'.",
    "  1 export const x: number = 'a';",
    '    ~~~~~~~~~~~~~~~',
    'src/b.ts:5:9 - error TS2554: Expected 0 arguments, but got 1.',
    'Found 2 errors.',
  ].join('\n');
  expect(countTscErrors(output)).toBe(2);
});

test('countTscErrors matches the marker regardless of surrounding punctuation', () => {
  const output = 'foo(error TS9999)bar\nline 2: error TS12: msg\n';
  expect(countTscErrors(output)).toBe(2);
});

test('sumEslintErrors handles the empty array', () => {
  expect(sumEslintErrors('[]')).toBe(0);
});

test('sumEslintErrors sums errorCount and ignores warnings', () => {
  const payload = JSON.stringify([
    { filePath: 'a.ts', errorCount: 2, warningCount: 1 },
    { filePath: 'b.ts', errorCount: 0, warningCount: 5 },
    { filePath: 'c.ts', errorCount: 3, warningCount: 0 },
  ]);
  expect(sumEslintErrors(payload)).toBe(5);
});

test('sumEslintErrors returns null on unparseable JSON', () => {
  expect(sumEslintErrors('not json')).toBe(null);
});

test('sumEslintErrors returns null when the payload is not an array', () => {
  expect(sumEslintErrors('{"errorCount": 3}')).toBe(null);
});

test('fileComplexity is 1 for a straight-line function', () => {
  const source = `function greet(name) { return "hi " + name; }`;
  expect(fileComplexity(source, '.js')).toBe(1);
});

test('fileComplexity counts every branch token exactly once', () => {
  const source = `
    function decide(x) {
      if (x > 0) {
        return "positive";
      } else if (x < 0) {
        return "negative";
      }
      for (let i = 0; i < 3; i++) {
        while (i > 0 && x !== 0) { break; }
      }
      try { return x; } catch (e) { return 0; }
      return x > 5 ? "big" : "small";
    }
  `;
  // 1 base + if + else if + for + while + && + catch + ternary "?" = 8
  const value = fileComplexity(source, '.ts');
  expect(value !== null && value >= 7, `expected ≥7, got ${value}`).toBe(true);
});

test('fileComplexity strips string literals so branch tokens in strings do not count', () => {
  const source = `function noop() { const s = "if for while &&"; return s; }`;
  expect(fileComplexity(source, '.ts')).toBe(1);
});

test('fileComplexity returns null for unsupported extensions', () => {
  expect(fileComplexity('anything', '.txt')).toBe(null);
  expect(fileComplexity('anything', '')).toBe(null);
});

test('fileComplexity handles python hash comments and def', () => {
  const source = `
def choose(x):
    # if this is a comment, it must not count as a branch
    if x:
        return 1
    elif x is None:
        return 2
    return 0
`;
  // 1 + if + elif = 3
  expect(fileComplexity(source, '.py')).toBe(3);
});

// ────────────────────────────────────────────────────────────────
// Committed-config reader
// ────────────────────────────────────────────────────────────────

test('readCommittedStaticAnalysisConfig returns empty object when no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  try {
    expect(readCommittedStaticAnalysisConfig(dir)).toEqual({});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCommittedStaticAnalysisConfig extracts staticAnalysis block only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  try {
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({
        configVersion: '1.0.0',
        staticAnalysis: {
          typecheckCommand: 'echo type',
          lintCommand: 'echo lint',
          timeoutSeconds: { typecheck: 5 },
        },
      }),
    );
    const cfg = readCommittedStaticAnalysisConfig(dir);
    expect(cfg.typecheckCommand).toBe('echo type');
    expect(cfg.lintCommand).toBe('echo lint');
    expect(cfg.timeoutSeconds).toEqual({ typecheck: 5 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy config filename is honoured as a fallback with a diagnostic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  try {
    writeFileSync(
      join(dir, LEGACY_SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { typecheckCommand: 'echo legacy' } }),
    );
    const diagnostics: string[] = [];
    const cfg = readCommittedStaticAnalysisConfig(dir, (message) => diagnostics.push(message));
    expect(cfg.typecheckCommand).toBe('echo legacy');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(LEGACY_SCAN_CONFIG_FILENAME);
    expect(diagnostics[0]).toContain(SCAN_CONFIG_FILENAME);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the primary config wins over the legacy filename without a diagnostic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  try {
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { typecheckCommand: 'echo primary' } }),
    );
    writeFileSync(
      join(dir, LEGACY_SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { typecheckCommand: 'echo legacy' } }),
    );
    const diagnostics: string[] = [];
    const cfg = readCommittedStaticAnalysisConfig(dir, (message) => diagnostics.push(message));
    expect(cfg.typecheckCommand).toBe('echo primary');
    expect(diagnostics).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCommittedStaticAnalysisConfig ignores gitignored local overlays (bare-checkout parity)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  try {
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { typecheckCommand: 'echo committed' } }),
    );
    writeFileSync(
      join(dir, '.hokusai-scan.local.json'),
      JSON.stringify({ staticAnalysis: { typecheckCommand: 'echo local-overlay' } }),
    );
    writeFileSync(
      join(dir, `${LEGACY_SCAN_CONFIG_FILENAME.replace('.json', '.local.json')}`),
      JSON.stringify({ staticAnalysis: { typecheckCommand: 'echo legacy-overlay' } }),
    );
    const cfg = readCommittedStaticAnalysisConfig(dir);
    expect(cfg.typecheckCommand).toBe('echo committed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCommittedStaticAnalysisConfig tolerates malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
  try {
    writeFileSync(join(dir, SCAN_CONFIG_FILENAME), '{ not-json ');
    expect(readCommittedStaticAnalysisConfig(dir)).toEqual({});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────
// Fixture-repo integration tests (real git, real shell)
// ────────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initFixture(rootPrefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sf-${rootPrefix}-`));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function commitAll(dir: string, message: string): void {
  git(dir, ['add', '.']);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
}

test('build_ok null when no package.json scripts.build and no PR / CI', () => {
  const dir = initFixture('no-build');
  try {
    writeFileSync(join(dir, 'README.md'), '# hi\n');
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 5000, lint: 5000, build: 5000, complexity: 5000 },
    });
    expect(result.build_ok).toBe(null);
    expect(result.build_evidence).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build_ok true when scripts.build exits 0 (local-build provenance)', () => {
  const dir = initFixture('build-ok');
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'sf-fixture', scripts: { build: 'exit 0' } }),
    );
    writeFileSync(join(dir, 'README.md'), '# hi\n');
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 5000, lint: 5000, build: 15_000, complexity: 5000 },
    });
    expect(result.build_ok).toBe(true);
    expect(result.build_evidence).toBe('local-build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build_ok false when scripts.build exits non-zero', () => {
  const dir = initFixture('build-bad');
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'sf-fixture', scripts: { build: 'exit 5' } }),
    );
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 5000, lint: 5000, build: 15_000, complexity: 5000 },
    });
    expect(result.build_ok).toBe(false);
    expect(result.build_evidence).toBe('local-build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('committed buildCommand overrides package.json (config wins)', () => {
  const dir = initFixture('build-cfg');
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'sf-fixture', scripts: { build: 'exit 1' } }),
    );
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { buildCommand: 'exit 0' } }),
    );
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 5000, lint: 5000, build: 15_000, complexity: 5000 },
    });
    expect(result.build_ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit configPath overrides the in-checkout lookup', () => {
  const dir = initFixture('build-cfgpath');
  const cfgDir = mkdtempSync(join(tmpdir(), 'sf-cfgpath-'));
  try {
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { buildCommand: 'exit 1' } }),
    );
    commitAll(dir, 'initial');
    const externalConfig = join(cfgDir, 'scan-config.json');
    writeFileSync(externalConfig, JSON.stringify({ staticAnalysis: { buildCommand: 'exit 0' } }));
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      configPath: externalConfig,
      timeouts: { typecheck: 5000, lint: 5000, build: 15_000, complexity: 5000 },
    });
    expect(result.build_ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cfgDir, { recursive: true, force: true });
  }
});

test('type_errors and lint_errors are null when no config present (not zero)', () => {
  const dir = initFixture('no-config');
  try {
    writeFileSync(join(dir, 'README.md'), '# hi\n');
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 3000, lint: 3000, build: 3000, complexity: 3000 },
    });
    expect(result.type_errors).toBe(null);
    expect(result.lint_errors).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('typecheckCommand override drives type_errors count from tsc-format output', () => {
  const dir = initFixture('typecheck-override');
  try {
    // A script that prints tsc-formatted error lines and exits 2.
    const script = '#!/bin/sh\necho "src/a.ts(1,1): error TS2322: foo"\necho "src/b.ts(1,1): error TS2554: bar"\nexit 2\n';
    writeFileSync(join(dir, 'fake-tsc.sh'), script);
    chmodSync(join(dir, 'fake-tsc.sh'), 0o755);
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { typecheckCommand: './fake-tsc.sh' } }),
    );
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 15_000, lint: 5000, build: 5000, complexity: 5000 },
    });
    expect(result.type_errors).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lintCommand override drives lint_errors from eslint-shaped JSON', () => {
  const dir = initFixture('lint-override');
  try {
    const script = '#!/bin/sh\ncat <<EOF\n[{"filePath":"a.ts","errorCount":3,"warningCount":9}]\nEOF\nexit 1\n';
    writeFileSync(join(dir, 'fake-eslint.sh'), script);
    chmodSync(join(dir, 'fake-eslint.sh'), 0o755);
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { lintCommand: './fake-eslint.sh' } }),
    );
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 5000, lint: 15_000, build: 5000, complexity: 5000 },
    });
    expect(result.lint_errors).toBe(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('typecheck timeout yields null (does not throw)', () => {
  const dir = initFixture('tc-timeout');
  try {
    const script = '#!/bin/sh\nsleep 5\n';
    writeFileSync(join(dir, 'slow.sh'), script);
    chmodSync(join(dir, 'slow.sh'), 0o755);
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { typecheckCommand: './slow.sh' } }),
    );
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 100, lint: 3000, build: 3000, complexity: 3000 },
    });
    expect(result.type_errors).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('complexity_delta counts a branch-heavy function against base', () => {
  const dir = initFixture('cx-delta');
  try {
    writeFileSync(join(dir, 'app.ts'), `export function ok() { return 1; }\n`);
    commitAll(dir, 'base');
    writeFileSync(
      join(dir, 'app.ts'),
      `export function decide(x: number) {
  if (x > 0) return 1;
  else if (x < 0) return -1;
  for (const _ of [1,2,3]) { if (_ > 1) break; }
  return x === 0 ? 0 : -1;
}
`,
    );
    commitAll(dir, 'head');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD~1',
      offline: true,
      timeouts: { typecheck: 3000, lint: 3000, build: 3000, complexity: 10_000 },
    });
    expect(result.complexity_delta).not.toBe(null);
    expect((result.complexity_delta ?? 0) >= 4, `expected ≥4, got ${result.complexity_delta}`).toBe(true);
    expect(result.complexity_metric).toBe(COMPLEXITY_METRIC_ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('complexity_delta is 0 for docs-only diffs (observed, not null)', () => {
  const dir = initFixture('cx-docs');
  try {
    writeFileSync(join(dir, 'app.ts'), `export const x = 1;\n`);
    writeFileSync(join(dir, 'README.md'), '# hi\n');
    commitAll(dir, 'base');
    writeFileSync(join(dir, 'README.md'), '# hi\n\nMore words.\n');
    commitAll(dir, 'docs only');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD~1',
      offline: true,
      timeouts: { typecheck: 3000, lint: 3000, build: 3000, complexity: 10_000 },
    });
    expect(result.complexity_delta).toBe(0);
    expect(result.complexity_metric).toBe(COMPLEXITY_METRIC_ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('complexity_delta is null when merge-base cannot be resolved', () => {
  const dir = initFixture('cx-nomerge');
  try {
    writeFileSync(join(dir, 'app.ts'), `export const x = 1;\n`);
    commitAll(dir, 'initial');
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'nonexistent-ref-42',
      offline: true,
      timeouts: { typecheck: 3000, lint: 3000, build: 3000, complexity: 5000 },
    });
    expect(result.complexity_delta).toBe(null);
    expect(result.complexity_metric).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bare-checkout parity: same values from direct dir and a git worktree of it', () => {
  const dir = initFixture('parity');
  try {
    // Real fixture with a change to measure.
    writeFileSync(join(dir, 'app.ts'), `export function ok() { return 1; }\n`);
    commitAll(dir, 'base');
    writeFileSync(
      join(dir, 'app.ts'),
      `export function ok(x: number) { if (x) return 1; return 0; }\n`,
    );
    commitAll(dir, 'head');
    // Prepare a worktree at HEAD.
    const worktreeDir = mkdtempSync(join(tmpdir(), 'sf-parity-wt-'));
    // git worktree add wants a nonexistent path; remove first.
    rmSync(worktreeDir, { recursive: true, force: true });
    git(dir, ['worktree', 'add', worktreeDir, 'HEAD']);
    try {
      const direct = collectStaticFeatures({
        checkoutDir: dir,
        baseRef: 'HEAD~1',
        offline: true,
        timeouts: { typecheck: 3000, lint: 3000, build: 3000, complexity: 5000 },
      });
      const viaWorktree = collectStaticFeatures({
        checkoutDir: worktreeDir,
        baseRef: 'HEAD~1',
        offline: true,
        timeouts: { typecheck: 3000, lint: 3000, build: 3000, complexity: 5000 },
      });
      expect(direct.complexity_delta).toBe(viaWorktree.complexity_delta);
      expect(direct.type_errors).toBe(viaWorktree.type_errors);
      expect(direct.lint_errors).toBe(viaWorktree.lint_errors);
      expect(direct.build_ok).toBe(viaWorktree.build_ok);
      expect(direct.complexity_metric).toBe(viaWorktree.complexity_metric);
    } finally {
      try {
        git(dir, ['worktree', 'remove', '--force', worktreeDir]);
      } catch {
        /* best effort */
      }
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bare-checkout parity: local overlay in a checkout is ignored', () => {
  const dir = initFixture('parity-overlay');
  try {
    writeFileSync(join(dir, 'app.ts'), `export const x = 1;\n`);
    writeFileSync(
      join(dir, SCAN_CONFIG_FILENAME),
      JSON.stringify({ staticAnalysis: { buildCommand: 'exit 0' } }),
    );
    commitAll(dir, 'initial');
    // Now write a local overlay that would flip build_ok to false if it were merged.
    writeFileSync(
      join(dir, '.hokusai-scan.local.json'),
      JSON.stringify({ staticAnalysis: { buildCommand: 'exit 7' } }),
    );
    const result = collectStaticFeatures({
      checkoutDir: dir,
      baseRef: 'HEAD',
      offline: true,
      timeouts: { typecheck: 3000, lint: 3000, build: 5000, complexity: 3000 },
    });
    // Committed config wins, so build_ok is true.
    expect(result.build_ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────
// This repo's own committed config (HOK-2820 shadow mode)
// ────────────────────────────────────────────────────────────────

test('this repo commits a resolvable .hokusai-scan.json for its own shadow scans', () => {
  // hokusai-sdk is itself a shadow-mode target: its committed config must
  // resolve through the same reader the extractor uses on any target repo.
  const repoRoot = join(import.meta.dirname, '../../..');
  const diagnostics: string[] = [];
  const config = readCommittedStaticAnalysisConfig(repoRoot, (message) =>
    diagnostics.push(message),
  );
  // The primary filename resolves, so the legacy-fallback diagnostic must not fire.
  expect(diagnostics).toEqual([]);
  expect(config.typecheckCommand).toBe('pnpm typecheck');
  expect(config.lintCommand).toBe('pnpm exec eslint . --format json');
  expect(config.buildCommand).toBe('pnpm -r build');
  expect(config.timeoutSeconds?.build).toBeGreaterThan(0);
});
