/**
 * Library golden parity — the extraction's acceptance test (REQ-F2).
 *
 * Each fixture under `fixtures/arbiter/scan/` was captured from the
 * PRE-extraction wavemill labeller/extractor at a pinned commit (see the
 * fixture README). This suite restores the bundled repo, runs @hokusai/scan
 * with the exact same inputs, and asserts BYTE-identical output. A mismatch
 * means wavemill-specific behaviour leaked or drifted during the port — fix
 * the port, never the fixture.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { extractCandidateFeatures } from './candidate-features.js';
import {
  serializeCandidateFeatures,
  serializeSurvivalLabels,
  sortMergedPrsForEmission,
} from './serialize.js';
import { execArgvCommand } from './shell-utils.js';
import {
  GIT_OUTPUT_MAX_BUFFER,
  enumerateMergedPrs,
  labelMergedPr,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
} from './survival-labeller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, '../../../fixtures/arbiter/scan');

interface GoldenInputs {
  case: string;
  github_repo: string;
  integration_branch: string;
  branches: string[];
  checkout_ref: string;
  pr_number: number;
  base_ref: string;
  as_of: string;
}

const caseNames = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

/** Restore a bundled fixture repo with local branches and no remotes. */
export function restoreFixtureRepo(caseDir: string, inputs: GoldenInputs): string {
  const repoDir = mkdtempSync(join(tmpdir(), `scan-golden-${inputs.case}-`));
  cleanups.push(repoDir);
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' });
  // Init on a branch name the bundle does not contain, or the fetch refuses
  // to update the checked-out ref.
  git(['init', '-q', '-b', '_restore']);
  git(['fetch', '-q', join(caseDir, 'repo.bundle'), 'refs/heads/*:refs/heads/*']);
  git(['checkout', '-q', inputs.checkout_ref]);
  return repoDir;
}

function readInputs(caseDir: string): GoldenInputs {
  return JSON.parse(readFileSync(join(caseDir, 'inputs.json'), 'utf-8')) as GoldenInputs;
}

function makeWorld(repoDir: string, inputs: GoldenInputs, asOf = inputs.as_of): {
  target: SurvivalLabellerTarget;
  deps: SurvivalLabellerDeps;
} {
  const [owner, repo] = inputs.github_repo.split('/') as [string, string];
  const target: SurvivalLabellerTarget = {
    owner,
    repo,
    integrationBranch: inputs.integration_branch,
    repoDir,
  };
  const pinned = new Date(asOf);
  const deps: SurvivalLabellerDeps = {
    runGit: (args) =>
      execArgvCommand('git', ['-C', repoDir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER }),
    github: { getPrMetadata: () => null, listCrossReferences: () => [] },
    now: () => pinned,
  };
  return { target, deps };
}

function labelAll(repoDir: string, inputs: GoldenInputs, asOf?: string): string {
  const { target, deps } = makeWorld(repoDir, inputs, asOf);
  const allMergedPrs = enumerateMergedPrs(target, deps);
  const rows = sortMergedPrsForEmission(allMergedPrs).flatMap((pr) =>
    labelMergedPr(target, deps, pr, { allMergedPrs, includeLinkedReferences: false }),
  );
  return serializeSurvivalLabels(rows);
}

function extractOne(repoDir: string, inputs: GoldenInputs): string {
  const features = extractCandidateFeatures({
    checkoutDir: repoDir,
    prNumber: inputs.pr_number,
    baseRef: inputs.base_ref,
    offline: true,
  });
  return serializeCandidateFeatures(features);
}

describe('golden parity with the pre-extraction labeller/extractor', () => {
  it('has the three curated fixture cases', () => {
    expect(caseNames).toEqual([
      'case-01-simple-merge',
      'case-02-followup-deletion',
      'case-03-empty-diff',
    ]);
    expect(existsSync(join(FIXTURES_ROOT, 'README.md'))).toBe(true);
  });

  for (const caseName of caseNames) {
    const caseDir = join(FIXTURES_ROOT, caseName);

    describe(caseName, () => {
      it('labeller output is byte-identical to the golden JSONL', () => {
        const inputs = readInputs(caseDir);
        const repoDir = restoreFixtureRepo(caseDir, inputs);
        const expected = readFileSync(join(caseDir, 'survival-labels.expected.jsonl'), 'utf-8');
        expect(labelAll(repoDir, inputs)).toBe(expected);
      });

      it('extractor output is byte-identical to the golden JSON', () => {
        const inputs = readInputs(caseDir);
        const repoDir = restoreFixtureRepo(caseDir, inputs);
        const expected = readFileSync(join(caseDir, 'candidate-features.expected.json'), 'utf-8');
        expect(extractOne(repoDir, inputs)).toBe(expected);
      });

      it('is deterministic: two runs produce identical bytes', () => {
        const inputs = readInputs(caseDir);
        const repoDir = restoreFixtureRepo(caseDir, inputs);
        expect(labelAll(repoDir, inputs)).toBe(labelAll(repoDir, inputs));
        expect(extractOne(repoDir, inputs)).toBe(extractOne(repoDir, inputs));
      });
    });
  }

  it('an --as-of inside the 30d horizon flips 30/60d rows to missing_horizon (case-01)', () => {
    const caseDir = join(FIXTURES_ROOT, 'case-01-simple-merge');
    const inputs = readInputs(caseDir);
    const repoDir = restoreFixtureRepo(caseDir, inputs);
    // PR #1 merged 2026-01-02; day merge+20 elapses only the 14d horizon.
    const rows = labelAll(repoDir, inputs, '2026-01-22T00:00:00Z')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        horizon_days: number;
        outcome: { report_outcome: string | null; reason_codes: string[] };
        envelope: { horizon_terminal_sha: string; merge_sha: string };
      });
    const h14 = rows.find((row) => row.horizon_days === 14);
    expect(h14?.outcome.report_outcome).toBe('survived');
    for (const horizon of [30, 60]) {
      const row = rows.find((entry) => entry.horizon_days === horizon);
      expect(row?.outcome.report_outcome).toBe(null);
      expect(row?.outcome.reason_codes).toEqual(['missing_horizon']);
      expect(row?.envelope.horizon_terminal_sha).toBe(row?.envelope.merge_sha);
    }
  });

  it('an --as-of past all cutoffs yields output identical to the golden as-of', () => {
    // Both instants are after every horizon cutoff AND after the branch tip,
    // so the terminal anchors agree; only computed_at could differ — and it
    // is pinned to the injected clock, so the difference is exactly that.
    const caseDir = join(FIXTURES_ROOT, 'case-01-simple-merge');
    const inputs = readInputs(caseDir);
    const repoDir = restoreFixtureRepo(caseDir, inputs);
    const later = labelAll(repoDir, inputs, '2026-06-01T00:00:00Z');
    const golden = readFileSync(join(caseDir, 'survival-labels.expected.jsonl'), 'utf-8');
    expect(later.replaceAll('2026-06-01T00:00:00.000Z', new Date(inputs.as_of).toISOString())).toBe(
      golden,
    );
  });
});
