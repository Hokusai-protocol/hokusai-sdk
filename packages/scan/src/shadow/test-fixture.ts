/**
 * Test-only fixture: builds a temp git repo with scripted first-parent
 * merges (`Merge pull request #N …`, squash-style `(#N)`, and plain
 * commits) at pinned commit dates. Not exported from the package index.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIT_OUTPUT_MAX_BUFFER, type GitRunner } from '../survival-labeller.js';

export const FIXTURE_BRANCH = 'auto/integration';

export interface FixtureMergeSpec {
  /** PR number for the merge subject; null makes a plain no-ref commit. */
  prNumber: number | null;
  /** Commit (committer + author) date, epoch seconds. */
  epoch: number;
  /** `true` makes a squash-style `feat: change (#N)` commit instead of a merge. */
  squash?: boolean;
  /** File content written for the change. */
  content?: string;
  /** File name written for the change. */
  file?: string;
  /** Override the commit subject entirely. */
  subject?: string;
}

export interface FixtureRepo {
  dir: string;
  runGit: GitRunner;
  /** First-parent SHAs of the scripted merges, oldest first. */
  mergeShas: string[];
  addMerges: (specs: FixtureMergeSpec[]) => string[];
}

function gitEnvAt(epoch: number): Record<string, string> {
  const date = `${epoch} +0000`;
  return {
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

export function createFixtureRepo(baseEpoch: number): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), 'hokusai-shadow-fixture-'));

  const git = (args: string[], epoch = baseEpoch): string =>
    execFileSync('git', ['-C', dir, ...args], {
      env: { ...process.env, ...gitEnvAt(epoch) },
      maxBuffer: GIT_OUTPUT_MAX_BUFFER,
    })
      .toString()
      .trim();

  const runGit: GitRunner = (args) => {
    try {
      const stdout = execFileSync('git', ['-C', dir, ...args], {
        env: { ...process.env, ...gitEnvAt(baseEpoch) },
        maxBuffer: GIT_OUTPUT_MAX_BUFFER,
      }).toString();
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error) {
      const e = error as { status?: number | null; stdout?: Buffer; stderr?: Buffer };
      return {
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? '',
        exitCode: typeof e.status === 'number' ? e.status : -1,
      };
    }
  };

  git(['init', '--quiet', '--initial-branch', FIXTURE_BRANCH]);
  writeFileSync(join(dir, 'README.md'), 'fixture\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'initial commit']);

  const mergeShas: string[] = [];
  let counter = 0;

  const addMerges = (specs: FixtureMergeSpec[]): string[] => {
    const added: string[] = [];
    for (const spec of specs) {
      counter++;
      const file = spec.file ?? `file-${counter}.txt`;
      const content = spec.content ?? `change ${counter}\n`;

      if (spec.squash === true || spec.prNumber === null) {
        writeFileSync(join(dir, file), content);
        git(['add', '.'], spec.epoch);
        const subject =
          spec.subject ??
          (spec.prNumber === null ? `chore: direct commit ${counter}` : `feat: change ${counter} (#${spec.prNumber})`);
        git(['commit', '--quiet', '-m', subject], spec.epoch);
      } else {
        const branch = `feat-${counter}`;
        git(['checkout', '--quiet', '-b', branch], spec.epoch);
        writeFileSync(join(dir, file), content);
        git(['add', '.'], spec.epoch);
        git(['commit', '--quiet', '-m', `feat: change ${counter}`], spec.epoch);
        git(['checkout', '--quiet', FIXTURE_BRANCH], spec.epoch);
        const subject = spec.subject ?? `Merge pull request #${spec.prNumber} from o/${branch}`;
        git(['merge', '--quiet', '--no-ff', '-m', subject, branch], spec.epoch);
      }
      const sha = git(['rev-parse', 'HEAD']);
      mergeShas.push(sha);
      added.push(sha);
    }
    return added;
  };

  return { dir, runGit, mergeShas, addMerges };
}
