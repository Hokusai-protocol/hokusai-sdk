/**
 * Undoer attribution (labeller 1.4.0): the undo is credited to the commits
 * that changed the code, not to whoever (or whichever bot) authored the merge
 * commit that landed them, and identities match whole names, not substrings.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execArgvCommand } from './shell-utils.js';
import {
  GIT_OUTPUT_MAX_BUFFER,
  classifyCommitActor,
  enumerateMergedPrs,
  labelMergedPr,
  type MergedPrRef,
  type SurvivalLabellerDeps,
  type SurvivalLabellerTarget,
} from './survival-labeller.js';

const BASE_EPOCH = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const at = (days: number): number => BASE_EPOCH + days * 86_400;
const MERGE_BOT = ['merge-queue[bot]', 'bot@example.com'] as const;
const HUMAN = ['Devin Binnie', 'devin@example.com'] as const;

let repoDir: string;

function git(args: string[], epoch: number, [name, email]: readonly [string, string]): void {
  const iso = new Date(epoch * 1000).toISOString();
  execFileSync('git', args, {
    cwd: repoDir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso,
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
    },
  });
}

/** Branch from integ, commit `content` to app.txt as `author`, merge as the merge bot. */
function mergePr(prNumber: number, content: string, epoch: number, author: readonly [string, string]): void {
  git(['checkout', '-q', '-b', `pr${prNumber}`, 'integ'], epoch, author);
  writeFileSync(join(repoDir, 'app.txt'), content);
  git(['commit', '-q', '-am', `pr ${prNumber}`], epoch - 3600, author);
  git(['checkout', '-q', 'integ'], epoch, MERGE_BOT);
  git(['merge', '--no-ff', '-q', '-m', `Merge pull request #${prNumber} from t/pr${prNumber}`, `pr${prNumber}`], epoch, MERGE_BOT);
}

describe('undoer attribution', () => {
  let target: SurvivalLabellerTarget;
  let deps: SurvivalLabellerDeps;
  let prs: MergedPrRef[];

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'survival-attribution-'));
    git(['init', '-q', '-b', 'integ'], at(0), HUMAN);
    writeFileSync(join(repoDir, 'app.txt'), 'a\nb\nc\n');
    git(['add', '-A'], at(0), HUMAN);
    git(['commit', '-q', '-m', 'base'], at(0), HUMAN);
    mergePr(1, 'a\nB\nc\n', at(1), ['Alice', 'alice@example.com']);
    // A human named Devin edits PR #1's line; a merge bot lands it.
    mergePr(2, 'a\nB2\nc\n', at(3), HUMAN);

    target = { owner: 't', repo: 'r', integrationBranch: 'integ', repoDir };
    deps = {
      runGit: (args) => execArgvCommand('git', ['-C', repoDir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER }),
      github: { getPrMetadata: () => null, listCrossReferences: () => [] },
      now: () => new Date(at(25) * 1000),
    };
    prs = enumerateMergedPrs(target, deps);
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('credits the change author, not the merge bot that landed it', () => {
    const pr1 = prs.find((pr) => pr.prNumber === 1)!;
    const row = labelMergedPr(target, deps, pr1, { allMergedPrs: prs, horizons: [14] })[0]!;
    expect(row.outcome.followup).toBe(true);
    expect(row.outcome.undone_by).toBe('human');
  });

  it('matches agent identities whole and gives automation no vote', () => {
    const actor = (authorName: string, authorEmail = 'x@example.com', body = ''): string =>
      classifyCommitActor({ authorName, authorEmail, body });
    expect(actor('Devin Binnie')).toBe('human');
    expect(actor('Claude Martin')).toBe('human');
    expect(actor('Copilot', '198982749+Copilot@users.noreply.github.com')).toBe('agent');
    expect(actor('cursor[bot]')).toBe('agent');
    expect(actor('devin-ai-integration[bot]')).toBe('agent');
    expect(actor('Claude', 'noreply@anthropic.com')).toBe('agent');
    expect(actor('dependabot[bot]')).toBe('automation');
    expect(actor('craig[bot]')).toBe('automation');
    expect(actor('Kubernetes Prow Robot')).toBe('automation');
    expect(actor('PyTorch MergeBot')).toBe('automation');
    expect(actor('bors')).toBe('automation');
    expect(actor('Tim', 't@x.com', 'fix\n\nCo-authored-by: github-actions[bot] <gh@x.com>')).toBe('human');
    expect(actor('Tim', 't@x.com', 'fix\n\nCo-authored-by: Devin Binnie <d@x.com>')).toBe('human');
    expect(actor('Tim', 't@x.com', 'fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')).toBe('agent');
  });
});
