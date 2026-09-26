import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { validateCandidateFeaturesV1 } from '@hokusai/core';
import {
  CANDIDATE_FEATURES_SCHEMA_VERSION,
  extractCandidateFeatures,
  validateCandidateFeatures,
  type CandidateFeaturesV1,
} from './candidate-features.js';

const EXPECTED_CANDIDATE_FEATURE_KEYS = [
  'schema_version',
  'files_touched',
  'lines_added',
  'lines_deleted',
  'loc_touched',
  'dependency_depth',
  'module_hotspot_score',
  'diff_uncertain',
  'type_errors',
  'lint_errors',
  'build_ok',
  'complexity_delta',
  'tests_changed',
  'test_pass_rate',
  'test_runtime_seconds',
  'task_type',
  'language',
  'domain',
  'complexity',
  'repo_size_bucket',
  'files_touched_bucket',
  'description_length_bucket',
  'is_greenfield',
  'is_migration',
  'requires_tests',
  'cross_service',
  'ui_heavy',
  'risk_level',
  'touched_out_of_scope_files',
  'human_intervention_count',
  'review_rounds',
  'change_requests',
  'self_review_iterations',
  'agent_iterations',
].sort();

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initFixture(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cf-${prefix}-`));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function commitAll(dir: string, message: string): void {
  git(dir, ['add', '.']);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message]);
}

function makeCandidateRepo(): string {
  const dir = initFixture('repo');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const value = 1;\n');
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  commitAll(dir, 'initial');
  git(dir, ['checkout', '-q', '-b', 'candidate']);
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const value = 2;\nexport const extra = true;\n');
  writeFileSync(join(dir, 'src', 'app.test.ts'), 'import { value } from "./app";\nvoid value;\n');
  commitAll(dir, 'candidate');
  return dir;
}

function intentKeys(): Array<keyof CandidateFeaturesV1> {
  return [
    'task_type',
    'language',
    'domain',
    'complexity',
    'repo_size_bucket',
    'files_touched_bucket',
    'description_length_bucket',
    'is_greenfield',
    'is_migration',
    'requires_tests',
    'cross_service',
    'ui_heavy',
    'risk_level',
  ];
}

test('standalone extractor emits a valid candidate_features/v1 object', () => {
  const dir = makeCandidateRepo();
  try {
    const features = extractCandidateFeatures({
      checkoutDir: dir,
      prNumber: 123,
      baseRef: 'main',
      offline: true,
    });

    expect(features.schema_version).toBe(CANDIDATE_FEATURES_SCHEMA_VERSION);
    expect(validateCandidateFeatures(features)).toHaveLength(0);
    // The blob must also satisfy the core validator directly — the extractor
    // and the wire contract are the same object now, not a strict mirror.
    expect(validateCandidateFeaturesV1(features).ok).toBe(true);
    expect(Object.keys(features).sort()).toEqual(EXPECTED_CANDIDATE_FEATURE_KEYS);
    expect(features.files_touched).toBe(2);
    expect(features.lines_added).toBe(4);
    expect(features.lines_deleted).toBe(1);
    expect(features.loc_touched).toBe(5);
    expect(features.tests_changed).toBe(true);
    expect(features.type_errors).toBe(null);
    expect(features.lint_errors).toBe(null);
    expect(features.build_ok).toBe(null);
    expect(typeof features.complexity_delta).toBe('number');
    expect(features.touched_out_of_scope_files).toBe(null);

    for (const key of intentKeys()) {
      expect(features[key], `${key} should degrade to null without a contract`).toBe(null);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task contract enriches Intent through deriveTaskDescriptor plus explicit normalized fields', () => {
  const dir = makeCandidateRepo();
  try {
    const features = extractCandidateFeatures({
      checkoutDir: dir,
      prNumber: 123,
      baseRef: 'main',
      offline: true,
      contract: {
        taskText: 'Implement a frontend feature for the candidate extractor',
        repositorySignals: {
          fileCount: 42,
          extensionCounts: { ts: 2 },
        },
        intent: {
          domain: 'frontend',
          is_greenfield: false,
          is_migration: false,
          requires_tests: true,
          cross_service: false,
          ui_heavy: true,
          risk_level: 'medium',
        },
        scope: {
          allowedPrefixes: ['src/'],
        },
        provenance: {
          human_intervention_count: 1,
          review_rounds: 2,
          change_requests: 1,
          self_review_iterations: 3,
          agent_iterations: 4,
        },
      },
    });

    expect(features.task_type).toBe('feature');
    expect(features.language).toBe('typescript');
    expect(features.repo_size_bucket).toBe('small');
    expect(features.files_touched_bucket).toBe('2_5');
    expect(features.description_length_bucket).toBe('short');
    expect(features.domain).toBe('frontend');
    expect(features.complexity).toBe(5);
    expect(features.requires_tests).toBe(true);
    expect(features.ui_heavy).toBe(true);
    expect(features.touched_out_of_scope_files).toBe(0);
    expect(features.human_intervention_count).toBe(1);
    expect(features.review_rounds).toBe(2);
    expect(features.change_requests).toBe(1);
    expect(features.self_review_iterations).toBe(3);
    expect(features.agent_iterations).toBe(4);
    expect(validateCandidateFeatures(features)).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scope provenance counts out-of-scope files without affecting other groups', () => {
  const dir = makeCandidateRepo();
  try {
    const features = extractCandidateFeatures({
      checkoutDir: dir,
      prNumber: 'not-a-pr',
      baseRef: 'main',
      offline: true,
      contract: {
        taskText: 'Update tests',
        repositorySignals: { fileCount: 1, extensionCounts: { ts: 1 } },
        scope: { allowedFiles: ['src/app.test.ts'] },
      },
    });

    expect(features.files_touched).toBe(2);
    expect(features.tests_changed).toBe(true);
    expect(features.touched_out_of_scope_files).toBe(1);
    expect(features.test_pass_rate).toBe(null);
    expect(features.review_rounds).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validation rejects missing, unknown, and invalid fields without coercion', () => {
  const dir = makeCandidateRepo();
  try {
    const features = extractCandidateFeatures({
      checkoutDir: dir,
      prNumber: 123,
      baseRef: 'main',
      offline: true,
    });
    const bad = {
      ...features,
      extra: true,
      build_ok: 0,
    };
    delete (bad as unknown as Partial<CandidateFeaturesV1>).files_touched;

    const issues = validateCandidateFeatures(bad);
    expect(issues.some((issue) => issue.field === 'extra' && /unknown/i.test(issue.message))).toBe(true);
    expect(issues.some((issue) => issue.field === 'build_ok')).toBe(true);
    expect(issues.some((issue) => issue.field === 'files_touched')).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
