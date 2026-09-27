/**
 * Static guard for shadow mode's never-visible / never-gating properties
 * (REQ-F8, Critical Constraint 1).
 *
 * Locks the shipped `.github/workflows/arbiter-shadow.yml` to:
 * - triggers exactly {schedule, workflow_dispatch}
 * - `contents: write` as the only write permission, PR-facing scopes `none`
 * - the job named `arbiter-shadow-never-required`, timeout ≤ 15
 * - `continue-on-error: true` on every scan/persist step
 * - no annotation/summary/comment machinery anywhere in the file
 *
 * And greps `src/shadow/**` (excluding tests) for forbidden output and
 * network tokens. When this test fires, remove the capability — never relax
 * the assertion.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const shadowDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(shadowDir, '../../../..');
const WORKFLOW_PATH = join(repoRoot, '.github/workflows/arbiter-shadow.yml');

const ALLOWED_TRIGGERS = new Set(['schedule', 'workflow_dispatch']);
const MUST_BE_NONE = ['checks', 'statuses', 'pull-requests', 'issues'];
const JOB_NAME = 'arbiter-shadow-never-required';

const FORBIDDEN_WORKFLOW_TOKENS = [
  'GITHUB_STEP_SUMMARY',
  'actions/github-script',
  'gh pr',
  '::error',
  '::warning',
  '::notice',
  '::set-output',
];
const FORBIDDEN_WORKFLOW_PATTERNS = [/gh api [^\n]*comments/];

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  'continue-on-error'?: boolean;
  [key: string]: unknown;
}

interface WorkflowDoc {
  // YAML 1.1 parses a bare `on:` key as boolean true; the yaml package keeps
  // it as the string 'on' with default options, but tolerate both.
  on?: Record<string, unknown>;
  true?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  jobs?: Record<string, { 'timeout-minutes'?: number; permissions?: unknown; steps?: WorkflowStep[] }>;
  [key: string]: unknown;
}

function triggersOf(doc: WorkflowDoc): Record<string, unknown> {
  return doc.on ?? doc.true ?? {};
}

/** Pure checker so mutation cases can run against in-memory documents. */
export function checkShadowWorkflow(doc: WorkflowDoc, rawText: string): string[] {
  const violations: string[] = [];

  const triggers = Object.keys(triggersOf(doc));
  if (triggers.length === 0) {
    violations.push('no triggers found');
  }
  for (const trigger of triggers) {
    if (!ALLOWED_TRIGGERS.has(trigger)) {
      violations.push(`forbidden trigger: ${trigger}`);
    }
  }

  const permissions = doc.permissions ?? {};
  for (const [scope, level] of Object.entries(permissions)) {
    if (level === 'write' && scope !== 'contents') {
      violations.push(`forbidden write permission: ${scope}`);
    }
  }
  if (permissions['contents'] !== 'write') {
    violations.push('permissions.contents must be exactly "write"');
  }
  for (const scope of MUST_BE_NONE) {
    if (permissions[scope] !== 'none') {
      violations.push(`permissions.${scope} must be explicitly "none"`);
    }
  }

  const jobs = doc.jobs ?? {};
  const jobNames = Object.keys(jobs);
  if (jobNames.length !== 1 || jobNames[0] !== JOB_NAME) {
    violations.push(`exactly one job named ${JOB_NAME} is required, got: ${jobNames.join(', ')}`);
  }
  for (const job of Object.values(jobs)) {
    if (job.permissions !== undefined) {
      violations.push('job-level permissions escalation is forbidden');
    }
    const timeout = job['timeout-minutes'];
    if (typeof timeout !== 'number' || timeout > 15) {
      violations.push('job timeout-minutes must be a number ≤ 15');
    }
    for (const step of job.steps ?? []) {
      const isCheckout = typeof step.uses === 'string' && step.uses.startsWith('actions/checkout');
      if (isCheckout) continue;
      const runsScan =
        (typeof step.uses === 'string' && step.uses.includes('packages/scan/action')) ||
        (typeof step.run === 'string' && /hokusai-scan|shadow-/.test(step.run)) ||
        (typeof step.run === 'string' && /git push/.test(step.run)) ||
        (typeof step.name === 'string' && /shadow/i.test(step.name));
      if (runsScan && step['continue-on-error'] !== true) {
        violations.push(`step "${step.name ?? step.uses ?? 'unnamed'}" must set continue-on-error: true`);
      }
      if (typeof step.run === 'string' && /git push/.test(step.run) && !step.run.includes('arbiter-shadow')) {
        violations.push('git push must target only the arbiter-shadow branch');
      }
    }
  }

  for (const token of FORBIDDEN_WORKFLOW_TOKENS) {
    if (rawText.includes(token)) {
      violations.push(`forbidden token in workflow: ${token}`);
    }
  }
  for (const pattern of FORBIDDEN_WORKFLOW_PATTERNS) {
    if (pattern.test(rawText)) {
      violations.push(`forbidden pattern in workflow: ${pattern}`);
    }
  }

  return violations;
}

const FORBIDDEN_SOURCE_TOKENS = [
  '::error',
  '::warning',
  '::notice',
  'core.warning',
  'core.error',
  'core.notice',
  'GITHUB_STEP_SUMMARY',
  'createCheck',
  'createComment',
  'fetch(',
  'https://',
];

/** Pure checker over {file → source} so mutation cases can inject files. */
export function scanShadowSources(files: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of Object.entries(files)) {
    for (const token of FORBIDDEN_SOURCE_TOKENS) {
      if (source.includes(token)) {
        violations.push(`${file}: forbidden token ${token}`);
      }
    }
  }
  return violations;
}

function loadWorkflow(): { doc: WorkflowDoc; raw: string } {
  const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
  return { doc: parse(raw) as WorkflowDoc, raw };
}

function mutate(rawEdit: (raw: string) => string): { doc: WorkflowDoc; raw: string } {
  const raw = rawEdit(readFileSync(WORKFLOW_PATH, 'utf-8'));
  return { doc: parse(raw) as WorkflowDoc, raw };
}

describe('arbiter-shadow workflow guard (REQ-F8)', () => {
  it('the shipped workflow passes', () => {
    const { doc, raw } = loadWorkflow();
    expect(checkShadowWorkflow(doc, raw)).toEqual([]);
  });

  it('rejects a pull_request trigger, naming it', () => {
    const { doc, raw } = mutate((r) => r.replace('on:\n', 'on:\n  pull_request: {}\n'));
    const violations = checkShadowWorkflow(doc, raw);
    expect(violations.some((v) => v.includes('pull_request'))).toBe(true);
  });

  it('rejects pull_request_target and push triggers', () => {
    for (const trigger of ['pull_request_target', 'push']) {
      const { doc, raw } = mutate((r) => r.replace('on:\n', `on:\n  ${trigger}: {}\n`));
      expect(checkShadowWorkflow(doc, raw).some((v) => v.includes(trigger))).toBe(true);
    }
  });

  it('rejects PR-facing write permissions', () => {
    for (const scope of MUST_BE_NONE) {
      const { doc, raw } = mutate((r) => r.replace(`${scope}: none`, `${scope}: write`));
      expect(checkShadowWorkflow(doc, raw).length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing continue-on-error on a scan step', () => {
    const { doc, raw } = mutate((r) => r.replace('- name: Shadow score\n        continue-on-error: true\n', '- name: Shadow score\n'));
    expect(checkShadowWorkflow(doc, raw).some((v) => v.includes('Shadow score'))).toBe(true);
  });

  it('rejects GITHUB_STEP_SUMMARY writes', () => {
    const { doc, raw } = mutate((r) => `${r}\n# echo "x" >> $GITHUB_STEP_SUMMARY\n`);
    expect(checkShadowWorkflow(doc, raw).some((v) => v.includes('GITHUB_STEP_SUMMARY'))).toBe(true);
  });

  it('rejects job-level permission escalation', () => {
    const { doc, raw } = mutate((r) =>
      r.replace('    runs-on: ubuntu-latest', '    permissions:\n      checks: write\n    runs-on: ubuntu-latest'),
    );
    expect(checkShadowWorkflow(doc, raw).some((v) => v.includes('job-level'))).toBe(true);
  });
});

describe('shadow source guard (REQ-F8)', () => {
  it('shipped shadow sources contain no forbidden output or network tokens', () => {
    const files: Record<string, string> = {};
    for (const entry of readdirSync(shadowDir)) {
      // Test-only helpers (test-*.ts) are not shipped shadow code.
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.startsWith('test-')) continue;
      files[entry] = readFileSync(join(shadowDir, entry), 'utf-8');
    }
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(8);
    expect(scanShadowSources(files)).toEqual([]);
  });

  it('rejects a source file containing a workflow command', () => {
    expect(scanShadowSources({ 'evil.ts': 'console.log("::warning::x")' })).toEqual([
      'evil.ts: forbidden token ::warning',
    ]);
  });
});
