#!/usr/bin/env node
/**
 * Capture the @hokusai/scan golden parity fixtures from the PRE-EXTRACTION
 * wavemill labeller/extractor (HOK-2816).
 *
 * For each curated case this script:
 *   1. Builds a fully deterministic fixture git repository (pinned commit
 *      dates, authors, contents — SHAs are reproducible run over run).
 *   2. Bundles it to `fixtures/arbiter/scan/<case>/repo.bundle`.
 *   3. Runs wavemill's `shared/lib/{survival-labeller,candidate-features}.ts`
 *      at the given checkout (via wavemill's own tsx + node_modules) with a
 *      pinned clock and offline GitHub, writing
 *      `survival-labels.expected.jsonl` and
 *      `candidate-features.expected.json`.
 *   4. Records the wavemill commit SHA in `fixtures/arbiter/scan/README.md`.
 *
 * The golden tests then assert @hokusai/scan reproduces those bytes exactly.
 * Do NOT re-run this to make a failing test pass — a mismatch during the
 * port is a bug in the port. Re-capture only in a PR that deliberately bumps
 * SURVIVAL_LABELLER_VERSION / SURVIVAL_NORMALIZATION_VERSION.
 *
 * Usage: node scripts/capture-scan-golden.mjs --wavemill /path/to/wavemill
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(repoRoot, 'fixtures', 'arbiter', 'scan');

const wavemillFlag = process.argv.indexOf('--wavemill');
if (wavemillFlag === -1 || !process.argv[wavemillFlag + 1]) {
  console.error('usage: node scripts/capture-scan-golden.mjs --wavemill <path-to-wavemill-checkout>');
  process.exit(2);
}
const wavemillDir = path.resolve(process.argv[wavemillFlag + 1]);

const BASE_EPOCH = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const DAY = 86_400;
const at = (days, hours = 0) => BASE_EPOCH + days * DAY + hours * 3600;
const iso = (epoch) => new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Every horizon has elapsed by day 70 for merges in the first days. */
const AS_OF = '2026-03-12T00:00:00Z';

function makeGit(repoDir) {
  return (args, epoch = at(0), name = 'Test User', email = 'test@example.com') =>
    execFileSync('git', args, {
      cwd: repoDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: iso(epoch),
        GIT_COMMITTER_DATE: iso(epoch),
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
      },
    });
}

const numbered = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

function writeLines(repoDir, file, lines) {
  writeFileSync(path.join(repoDir, file), lines.join('\n') + '\n');
}

function mergePr(git, repoDir, prNumber, branch, mutate, mergeEpoch) {
  git(['checkout', '-q', '-b', branch, 'integ']);
  mutate();
  git(['add', '-A']);
  git(['commit', '-q', '-m', `${branch} work`], mergeEpoch - 3600);
  git(['checkout', '-q', 'integ']);
  git(
    ['merge', '--no-ff', '-q', '-m', `Merge pull request #${prNumber} from t/${branch}`, branch],
    mergeEpoch,
  );
}

/**
 * Case definitions. Each builder creates the full history on `main` + `integ`
 * plus one PR branch left in place for the extract side.
 */
const CASES = [
  {
    name: 'case-01-simple-merge',
    description:
      'One clean merged PR whose lines are never touched again: survived at every horizon.',
    prNumber: 1,
    checkoutRef: 'pr1',
    baseRef: 'main',
    branches: ['main', 'integ', 'pr1'],
    build(git, repoDir) {
      git(['init', '-q', '-b', 'main']);
      writeLines(repoDir, 'app.txt', numbered('app', 10));
      writeLines(repoDir, 'README.md', ['# case-01 fixture']);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'base'], at(0));
      git(['checkout', '-q', '-b', 'integ']);
      mergePr(git, repoDir, 1, 'pr1', () => {
        const lines = numbered('app', 10);
        lines[2] = 'app 3 CHANGED';
        lines[3] = 'app 4 CHANGED';
        writeLines(repoDir, 'app.txt', lines);
      }, at(1));
      // Unrelated later work inside every horizon window.
      writeLines(repoDir, 'other.txt', numbered('other', 3));
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'unrelated later work'], at(2));
    },
  },
  {
    name: 'case-02-followup-deletion',
    description:
      'PR #2 substantially rewritten by a human (line_range_followup, ratio 0.4); PR #3 exactly reverted by an agent.',
    prNumber: 2,
    checkoutRef: 'pr2',
    baseRef: 'main',
    branches: ['main', 'integ', 'pr2', 'pr3'],
    build(git, repoDir) {
      git(['init', '-q', '-b', 'main']);
      writeLines(repoDir, 'util.txt', numbered('util', 5));
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'base'], at(0));
      git(['checkout', '-q', '-b', 'integ']);
      mergePr(git, repoDir, 2, 'pr2', () => {
        writeLines(repoDir, 'feature.txt', numbered('feature', 10));
      }, at(1));
      mergePr(git, repoDir, 3, 'pr3', () => {
        const lines = numbered('util', 5);
        lines[1] = 'util 2 CHANGED';
        writeLines(repoDir, 'util.txt', lines);
      }, at(2));
      // Day 3: human rewrites feature.txt lines 1-6 (partial rewrite of PR #2).
      writeLines(repoDir, 'feature.txt', [
        ...numbered('rewritten', 6),
        ...numbered('feature', 10).slice(6),
      ]);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'harden feature'], at(3), 'Human Dev', 'human@example.com');
      // Day 4: agent-authored exact revert of PR #3's util.txt change.
      writeLines(repoDir, 'util.txt', numbered('util', 5));
      git(['add', '-A']);
      git(
        ['commit', '-q', '-m', 'revert util change\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
        at(4),
      );
    },
  },
  {
    name: 'case-03-empty-diff',
    description:
      'Whitespace-only PR: zero-line substrate, insufficient_line_range_substrate at every horizon.',
    prNumber: 4,
    checkoutRef: 'pr4',
    baseRef: 'main',
    branches: ['main', 'integ', 'pr4'],
    build(git, repoDir) {
      git(['init', '-q', '-b', 'main']);
      writeLines(repoDir, 'ws.txt', numbered('ws', 5));
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'base'], at(0));
      git(['checkout', '-q', '-b', 'integ']);
      mergePr(git, repoDir, 4, 'pr4', () => {
        writeLines(repoDir, 'ws.txt', numbered('ws', 5).map((line) => `  ${line}`));
      }, at(1));
    },
  },
];

const HARNESS = `
/**
 * Pre-extraction golden harness. Runs wavemill's labeller and extractor with
 * a pinned clock and offline GitHub against a fixture checkout, serializing
 * with the same canonical rules as @hokusai/scan's serialize.ts:
 * labels as compact JSONL (builder insertion order), candidate features as
 * 2-space JSON with keys sorted at every level, trailing newline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execArgvCommand } from './shared/lib/shell-utils.ts';
import {
  GIT_OUTPUT_MAX_BUFFER,
  enumerateMergedPrs,
  labelMergedPr,
} from './shared/lib/survival-labeller.ts';
import { extractCandidateFeatures } from './shared/lib/candidate-features.ts';

const [repoDir, inputsPath, labelsOut, featuresOut] = process.argv.slice(2);
const inputs = JSON.parse(readFileSync(inputsPath, 'utf-8'));
const [owner, repo] = inputs.github_repo.split('/');
const target = { owner, repo, integrationBranch: inputs.integration_branch, repoDir };
const asOf = new Date(inputs.as_of);
const deps = {
  runGit: (args) =>
    execArgvCommand('git', ['-C', repoDir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER }),
  github: { getPrMetadata: () => null, listCrossReferences: () => [] },
  now: () => asOf,
};

const allMergedPrs = enumerateMergedPrs(target, deps);
const prs = [...allMergedPrs].sort(
  (a, b) => a.mergedAtEpoch - b.mergedAtEpoch || a.prNumber - b.prNumber,
);
const rows = [];
for (const pr of prs) {
  rows.push(...labelMergedPr(target, deps, pr, { allMergedPrs, includeLinkedReferences: false }));
}
writeFileSync(labelsOut, rows.map((row) => JSON.stringify(row) + '\\n').join(''));

const features = extractCandidateFeatures({
  checkoutDir: repoDir,
  prNumber: inputs.pr_number,
  baseRef: inputs.base_ref,
  offline: true,
});
writeFileSync(featuresOut, JSON.stringify(features, Object.keys(features).sort(), 2) + '\\n');
`;

function main() {
  const wavemillSha = execFileSync('git', ['-C', wavemillDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  }).trim();

  const workDir = mkdtempSync(path.join(tmpdir(), 'scan-golden-'));
  const harnessPath = path.join(wavemillDir, `.hokusai-golden-harness.${process.pid}.mts`);
  writeFileSync(harnessPath, HARNESS);

  try {
    for (const testCase of CASES) {
      const repoDir = path.join(workDir, testCase.name);
      mkdirSync(repoDir, { recursive: true });
      const git = makeGit(repoDir);
      testCase.build(git, repoDir);
      git(['checkout', '-q', testCase.checkoutRef]);

      const caseDir = path.join(outRoot, testCase.name);
      mkdirSync(caseDir, { recursive: true });

      git(['bundle', 'create', path.join(caseDir, 'repo.bundle'), '--all']);

      const inputs = {
        case: testCase.name,
        description: testCase.description,
        github_repo: `golden/${testCase.name}`,
        integration_branch: 'integ',
        branches: testCase.branches,
        checkout_ref: testCase.checkoutRef,
        pr_number: testCase.prNumber,
        base_ref: testCase.baseRef,
        as_of: AS_OF,
      };
      const inputsPath = path.join(caseDir, 'inputs.json');
      writeFileSync(inputsPath, `${JSON.stringify(inputs, null, 2)}\n`);

      execFileSync(
        'npx',
        [
          'tsx',
          harnessPath,
          repoDir,
          inputsPath,
          path.join(caseDir, 'survival-labels.expected.jsonl'),
          path.join(caseDir, 'candidate-features.expected.json'),
        ],
        { cwd: wavemillDir, stdio: 'inherit' },
      );
      console.log(`captured ${testCase.name}`);
    }

    const readme = `# @hokusai/scan golden parity fixtures (HOK-2816)

Captured from the PRE-EXTRACTION wavemill labeller/extractor so the extracted
package can be proven byte-identical to what wavemill emitted.

- **Source wavemill commit:** \`${wavemillSha}\`
- **Pinned clock (\`--as-of\`):** \`${AS_OF}\`
- **Capture command:** \`node scripts/capture-scan-golden.mjs --wavemill <wavemill checkout at that SHA>\`

Each case directory contains:

| File | Contents |
| --- | --- |
| \`repo.bundle\` | \`git bundle --all\` of a deterministic synthetic fixture repo |
| \`inputs.json\` | The exact scan inputs (repo identity, branch, PR, base ref, as-of) |
| \`survival-labels.expected.jsonl\` | Labeller output: one JSON row per (PR, horizon), PRs oldest-first |
| \`candidate-features.expected.json\` | Extractor output: canonical sorted-key JSON |

To restore a fixture repo without any remote state:

\`\`\`sh
git init -b _restore work && git -C work fetch <case>/repo.bundle 'refs/heads/*:refs/heads/*'
git -C work checkout <inputs.json .checkout_ref>
\`\`\`

The equivalent standalone CLI invocations (see \`packages/scan/src/cli.test.ts\`):

\`\`\`sh
hokusai-scan label --repo work --integration-branch integ \\
  --github-repo <inputs.json .github_repo> --as-of <inputs.json .as_of> --offline --out -
hokusai-scan extract --repo work --pr <inputs.json .pr_number> \\
  --base-ref <inputs.json .base_ref> --offline --out -
\`\`\`

**Never re-capture to make a failing test pass.** A mismatch during a port is
a bug in the port; diff the port against the wavemill source at the SHA above.
Re-capture only in a PR that deliberately changes labeller behaviour and bumps
\`SURVIVAL_LABELLER_VERSION\` / \`SURVIVAL_NORMALIZATION_VERSION\`.
`;
    writeFileSync(path.join(outRoot, 'README.md'), readme);
    console.log(`recorded wavemill SHA ${wavemillSha}`);
  } finally {
    rmSync(harnessPath, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
