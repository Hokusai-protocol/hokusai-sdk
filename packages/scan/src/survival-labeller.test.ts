/**
 * Fixture-driven tests for the repo-agnostic survival labeller (HOK-2805,
 * ported in HOK-2816).
 *
 * Builds one disposable git history (integration branch `integ`, never
 * `main`) covering: clean survival, exact revert (agent-attributed), partial
 * rewrite (human-attributed), formatter-only forward churn, rename-only
 * forward churn, whitespace-only PR substrate, squash-merge enumeration,
 * same-task redispatch, linked follow-up (mocked GitHub), pre-merge human
 * correction, unelapsed horizons, and inaccessible history. Every emitted
 * label is validated against the frozen v1.0.0 JSON Schema.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { canonicalSerialize, type ArbiterSurvivalLabelV1 } from '@hokusai/core';
import { execArgvCommand } from './shell-utils.js';
import {
  GIT_OUTPUT_MAX_BUFFER,
  classifyCommitActor,
  enumerateMergedPrs,
  labelMergedPr,
  summarizeLabels,
  type MergedPrRef,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
} from './survival-labeller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../../core/schemas/arbiter-survival-label.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')));

const BASE_EPOCH = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const DAY = 86_400;
const at = (days: number, hours = 0): number => BASE_EPOCH + days * DAY + hours * 3600;

let repoDir: string;
let target: SurvivalLabellerTarget;
let deps: SurvivalLabellerDeps;
let gitCalls: string[][];
let allPrs: MergedPrRef[];

function git(args: string[], epoch = at(0), name = 'Test User', email = 'test@example.com'): string {
  const iso = new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_DATE: iso,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
    },
  });
}

function write(path: string, lines: string[]): void {
  writeFileSync(join(repoDir, path), lines.join('\n') + '\n');
}

const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

function mergePr(
  prNumber: number,
  branch: string,
  mutate: () => void,
  mergeEpoch: number,
  subject?: string,
): void {
  git(['checkout', '-q', '-b', branch, 'integ']);
  mutate();
  git(['add', '-A']);
  git(['commit', '-q', '-m', `${branch} work`], mergeEpoch - 3600);
  git(['checkout', '-q', 'integ']);
  git(
    ['merge', '--no-ff', '-q', '-m', subject ?? `Merge pull request #${prNumber} from t/${branch}`, branch],
    mergeEpoch,
  );
}

function prByNumber(n: number): MergedPrRef {
  const ref = allPrs.find((pr) => pr.prNumber === n);
  expect(ref, `fixture PR #${n} not found`).toBeDefined();
  return ref as MergedPrRef;
}

function label(pr: MergedPrRef, extra: Parameters<typeof labelMergedPr>[3] = {}): ArbiterSurvivalLabelV1[] {
  const labels = labelMergedPr(target, deps, pr, { allMergedPrs: allPrs, ...extra });
  for (const row of labels) {
    expect(
      validateSchema(row),
      `schema-invalid label: ${JSON.stringify(validateSchema.errors)}`,
    ).toBeTruthy();
  }
  return labels;
}

const h14 = (labels: ArbiterSurvivalLabelV1[]): ArbiterSurvivalLabelV1 => {
  const row = labels.find((l) => l.horizon_days === 14);
  expect(row).toBeDefined();
  return row as ArbiterSurvivalLabelV1;
};

describe('survival-labeller', () => {
  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'survival-labeller-'));
    git(['init', '-q', '-b', 'integ']);

    // Day 0: base tree.
    write('app.txt', numbered('app', 10));
    write('util.txt', numbered('util', 5));
    write('fmt.txt', numbered('fmt', 5));
    write('ren.txt', numbered('ren', 5));
    write('ws.txt', numbered('ws', 5));
    write('other.txt', numbered('other', 3));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base'], at(0));

    // PR #1 (survived): modify app.txt lines 3-4. Merged day 1.
    mergePr(1, 'pr1', () => {
      const lines = numbered('app', 10);
      lines[2] = 'app 3 CHANGED';
      lines[3] = 'app 4 CHANGED';
      write('app.txt', lines);
    }, at(1));

    // PR #2 (exact revert later): modify util.txt line 2. Merged day 2.
    mergePr(2, 'pr2', () => {
      const lines = numbered('util', 5);
      lines[1] = 'util 2 CHANGED';
      write('util.txt', lines);
    }, at(2));

    // PR #3 (partial rewrite later): add feature.txt (10 lines). Merged day 3.
    mergePr(3, 'pr3', () => {
      write('feature.txt', numbered('feature', 10));
    }, at(3));

    // PR #4 (formatter-only forward churn): modify fmt.txt lines 1-2. Merged day 3+6h.
    mergePr(4, 'pr4', () => {
      const lines = numbered('fmt', 5);
      lines[0] = 'fmt 1 CHANGED';
      lines[1] = 'fmt 2 CHANGED';
      write('fmt.txt', lines);
    }, at(3, 6));

    // PR #6 (whitespace-only substrate): reindent ws.txt. Merged day 4.
    mergePr(6, 'pr6', () => {
      write('ws.txt', numbered('ws', 5).map((line) => `  ${line}`));
    }, at(4));

    // PR #5 (renamed later): modify ren.txt line 1. Merged day 4+6h.
    mergePr(5, 'pr5', () => {
      const lines = numbered('ren', 5);
      lines[0] = 'ren 1 CHANGED';
      write('ren.txt', lines);
    }, at(4, 6));

    // Day 4+12h: agent-authored exact revert of PR #2's util.txt change.
    write('util.txt', numbered('util', 5));
    git(['add', '-A']);
    git(
      ['commit', '-q', '-m', 'revert util change\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>'],
      at(4, 12),
    );

    // Day 5: squash-style landing of PR #7 (same-task redispatch source).
    write('redis.txt', numbered('redis', 4));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'HOK-99: first try (#7)'], at(5));

    // PR #9 (linked follow-up via mocked GitHub): add link.txt. Merged day 5+6h.
    mergePr(9, 'pr9', () => {
      write('link.txt', numbered('link', 3));
    }, at(5, 6));

    // Day 6: human rewrites feature.txt lines 1-6 (partial rewrite of PR #3).
    write('feature.txt', [...numbered('rewritten', 6), ...numbered('feature', 10).slice(6)]);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'harden feature'], at(6), 'Human Dev', 'human@example.com');

    // Day 6+12h: formatter-only reindent of PR #4's changed lines.
    const fmtLines = numbered('fmt', 5);
    fmtLines[0] = '    fmt 1 CHANGED';
    fmtLines[1] = '    fmt 2 CHANGED';
    write('fmt.txt', fmtLines);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'reformat fmt.txt'], at(6, 12));

    // Day 7: pure rename of ren.txt.
    git(['mv', 'ren.txt', 'renamed.txt']);
    git(['commit', '-q', '-m', 'move ren.txt'], at(7));

    // Day 8: squash-style landing of PR #8 re-dispatching HOK-99.
    write('other.txt', [...numbered('other', 3), 'other 4']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'HOK-99: second try (#8)'], at(8));

    target = { owner: 't', repo: 'r', integrationBranch: 'integ', repoDir };
    gitCalls = [];
    deps = {
      runGit: (args) => {
        gitCalls.push([...args]);
        return execArgvCommand('git', ['-C', repoDir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      },
      github: {
        getPrMetadata: () => null,
        listCrossReferences: (prNumber) =>
          prNumber === 9
            ? [{ createdAtEpoch: at(10), url: 'https://github.com/t/r/issues/500' }]
            : [],
      },
      // Day 25: every 14-day horizon has elapsed, no 30/60-day horizon has.
      now: () => new Date(at(25) * 1000),
    };
    allPrs = enumerateMergedPrs(target, deps);
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('enumerates merge and squash landings from first-parent history', () => {
    const numbers = allPrs.map((pr) => pr.prNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const squash = prByNumber(7);
    expect(squash.headSha).toBe(squash.mergeSha);
    expect(prByNumber(1).prUrl).toBe('https://github.com/t/r/pull/1');
    expect(prByNumber(1).headSha).not.toBe(prByNumber(1).mergeSha);
  });

  it('labels an untouched change as survived with ratio 1', () => {
    const row = h14(label(prByNumber(1)));
    expect(row.outcome.report_outcome).toBe('survived');
    expect(row.outcome.survival_ratio).toBe(1);
    expect(row.outcome.reverted).toBe(false);
    expect(row.outcome.followup).toBe(false);
    expect(row.outcome.undone_by).toBe(null);
    expect(row.outcome.reason_codes).toEqual(['no_evidence']);
    expect(row.line_ranges).toHaveLength(1);
    expect(row.line_ranges[0]?.new).toEqual({ start: 3, end: 4, sha: prByNumber(1).mergeSha });
    expect(row.line_ranges[0]?.old).toEqual({ start: 3, end: 4, sha: prByNumber(1).parentSha });
  });

  it('labels an exact restoration as reverted, attributed to the agent', () => {
    const row = h14(label(prByNumber(2)));
    expect(row.outcome.report_outcome).toBe('reverted');
    expect(row.outcome.reverted).toBe(true);
    expect(row.outcome.survival_ratio).toBe(0);
    expect(row.outcome.undone_by).toBe('agent');
    expect(row.outcome.reason_codes).toContain('exact_revert');
  });

  it('labels a partial rewrite below threshold, attributed to the human', () => {
    const row = h14(label(prByNumber(3)));
    expect(row.outcome.report_outcome).toBe('substantially_rewritten');
    expect(row.outcome.survival_ratio).toBe(0.4);
    expect(row.outcome.reverted).toBe(false);
    expect(row.outcome.followup).toBe(true);
    expect(row.outcome.undone_by).toBe('human');
    expect(row.outcome.reason_codes).toContain('substantial_rewrite');
    expect(row.outcome.reason_codes).toContain('line_range_followup');
  });

  it('ignores formatter-only forward churn', () => {
    const row = h14(label(prByNumber(4)));
    expect(row.outcome.report_outcome).toBe('survived');
    expect(row.outcome.survival_ratio).toBe(1);
    expect(row.outcome.undone_by).toBe(null);
  });

  it('follows renames without counting the move as an undo', () => {
    const row = h14(label(prByNumber(5)));
    expect(row.outcome.report_outcome).toBe('survived');
    expect(row.outcome.survival_ratio).toBe(1);
  });

  it('emits insufficient_line_range_substrate for a whitespace-only PR', () => {
    const row = h14(label(prByNumber(6)));
    expect(row.outcome.report_outcome).toBe(null);
    expect(row.outcome.reason_codes).toEqual(['insufficient_line_range_substrate']);
    expect(row.line_ranges).toEqual([]);
    expect(row.outcome.survival_ratio).toBe(null);
  });

  it('flags same-task redispatch as followup without inventing an undoer', () => {
    const row = h14(label(prByNumber(7)));
    expect(row.outcome.report_outcome).toBe('followup');
    expect(row.outcome.survival_ratio).toBe(1);
    expect(row.outcome.undone_by).toBe(null);
    expect(row.outcome.reason_codes).toEqual(['task_redispatch']);
    // The redispatching PR itself has no later same-task landing.
    expect(h14(label(prByNumber(8))).outcome.report_outcome).toBe('survived');
  });

  it('flags a post-merge cross-reference as linked followup', () => {
    const row = h14(label(prByNumber(9)));
    expect(row.outcome.report_outcome).toBe('followup');
    expect(row.outcome.reason_codes).toEqual(['linked_issue_or_pr']);
    expect(row.outcome.survival_ratio).toBe(1);
  });

  it('treats pre-merge human correction as followup provenance, not survival evidence', () => {
    const row = h14(label(prByNumber(1), { preMergeHumanEdit: true }));
    expect(row.outcome.report_outcome).toBe('followup');
    expect(row.outcome.survival_ratio).toBe(1);
    expect(row.outcome.reverted).toBe(false);
    expect(row.outcome.undone_by).toBe('human');
    expect(row.outcome.reason_codes).toEqual(['pre_merge_human_edit']);
  });

  it('emits missing_horizon for unelapsed horizons, anchored at merge_sha', () => {
    const rows = label(prByNumber(1));
    for (const horizon of [30, 60]) {
      const row = rows.find((l) => l.horizon_days === horizon);
      expect(row).toBeDefined();
      expect(row?.outcome.report_outcome).toBe(null);
      expect(row?.outcome.reason_codes).toEqual(['missing_horizon']);
      expect(row?.envelope.horizon_terminal_sha).toBe(row?.envelope.merge_sha);
    }
  });

  it('emits inaccessible_history when the anchors cannot be read', () => {
    const bogus: MergedPrRef = {
      prNumber: 999,
      prUrl: 'https://github.com/t/r/pull/999',
      mergeSha: 'f'.repeat(40),
      parentSha: 'e'.repeat(40),
      headSha: 'f'.repeat(40),
      mergedAtEpoch: at(1),
      subject: 'Merge pull request #999 from t/ghost',
    };
    const row = h14(label(bogus));
    expect(row.outcome.report_outcome).toBe(null);
    expect(row.outcome.reason_codes).toEqual(['inaccessible_history']);
  });

  it('rejects main as an integration branch and never traverses it', () => {
    expect(() => enumerateMergedPrs({ ...target, integrationBranch: 'main' }, deps)).toThrow(
      /rejected/,
    );
    gitCalls = [];
    label(prByNumber(2));
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const call of gitCalls) {
      expect(call.includes('main'), `git invoked with main: ${call.join(' ')}`).toBe(false);
    }
  });

  it('classifies commit actors from author identity and trailers', () => {
    expect(classifyCommitActor({ authorName: 'dependabot[bot]', authorEmail: 'x@y', body: '' })).toBe('agent');
    expect(
      classifyCommitActor({ authorName: 'Tim', authorEmail: 't@x.com', body: 'fix\n\nCo-Authored-By: Claude <n@a.com>' }),
    ).toBe('agent');
    expect(classifyCommitActor({ authorName: 'Tim', authorEmail: 't@x.com', body: 'fix' })).toBe('human');
  });

  it('summarizes base rates by horizon without hiding extremes', () => {
    const rows = allPrs.flatMap((pr) => label(pr));
    const summary = summarizeLabels('t/r', rows);
    expect(summary.totalRows).toBe(rows.length);
    const bucket14 = summary.horizons['14'];
    expect(bucket14).toBeDefined();
    expect(bucket14?.rows).toBe(allPrs.length);
    expect(bucket14?.missing).toBe(1); // whitespace-only PR #6
    expect(bucket14?.reverted).toBe(1);
    expect(bucket14?.substantially_rewritten).toBe(1);
    expect(bucket14?.followup).toBe(2);
    expect(bucket14?.survived).toBe(4);
    expect(bucket14?.survival_rate).toBe(0.5);
    expect(summary.horizons['30']?.missing).toBe(allPrs.length);
  });

  it('is reproducible at a fixed terminal SHA and records a new anchor afterwards', () => {
    const first = label(prByNumber(1));
    const second = label(prByNumber(1));
    expect(first.map((l) => canonicalSerialize(l)).join('\n')).toBe(
      second.map((l) => canonicalSerialize(l)).join('\n'),
    );
    const previousTerminal = h14(first).envelope.horizon_terminal_sha;

    // Advance the integration branch inside the horizon window: the label
    // must record the new deterministic terminal anchor.
    write('extra.txt', ['extra 1']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'later work'], at(9));
    const third = label(prByNumber(1));
    const newTerminal = h14(third).envelope.horizon_terminal_sha;
    expect(newTerminal).not.toBe(previousTerminal);
    expect(h14(third).outcome.report_outcome).toBe('survived');
  });
});
