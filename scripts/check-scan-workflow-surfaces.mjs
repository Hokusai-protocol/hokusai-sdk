#!/usr/bin/env node
/**
 * Mechanical enforcement of the shadow-mode invariant (HOK-2820, Arbiter §8 /
 * §15.2): the Survival Check is advisory by design and forever — a scan
 * workflow must never be able to surface anything a PR contributor can see,
 * not even by misconfiguration.
 *
 * Checked files: `.github/workflows/hokusai-scan-*.yml` plus the shipped
 * caller templates in `packages/scan/action/`. Each file must:
 *   1. contain no PR-surface grant or call (see FORBIDDEN_PATTERNS): no
 *      `checks: write`, `pull-requests: write`, `statuses: write`,
 *      `issues: write`, no comment/check/status REST calls, and no
 *      `::error` / `::warning` / `::notice` workflow annotation directives;
 *   2. declare an explicit `permissions:` block (never the default token);
 *   3. if triggered by `pull_request`, skip fork PRs and mark the scan step
 *      `continue-on-error: true` so a failed scan can never fail a check.
 *
 * `contents: write` is deliberately NOT forbidden: the nightly/report jobs
 * push derived state to the `arbiter/shadow-state` branch, and pushing a
 * branch is not a PR surface (comments, check runs, and commit statuses all
 * require their own scopes, which stay forbidden).
 *
 * When this guard fires, the fix is to remove the surface from the workflow,
 * never to relax the guard: flag mode is Phase 3 and arrives as a different
 * workflow, not as an edit to a `hokusai-scan-*` one.
 *
 * Usage: node scripts/check-scan-workflow-surfaces.mjs [dir ...]
 *   With no arguments, checks this repository's workflows and templates.
 *   With directory arguments (tests), checks every .yml/.yaml under them
 *   and fails if none are found.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Forbidden content, matched against whitespace-normalized lines so
 * `checks:  write` and `checks: write` are the same violation.
 */
const FORBIDDEN_PATTERNS = [
  { pattern: /checks:\s*write/, reason: 'grants check-run write (a PR surface)' },
  { pattern: /pull-requests:\s*write/, reason: 'grants PR write (comments/reviews are PR surfaces)' },
  { pattern: /statuses:\s*write/, reason: 'grants commit-status write (a PR surface)' },
  { pattern: /issues:\s*write/, reason: 'grants issue write (comments are PR surfaces)' },
  { pattern: /deployments:\s*write/, reason: 'grants deployment write (deployment statuses surface on PRs)' },
  { pattern: /github\.rest\.issues\.createComment/, reason: 'posts a PR comment' },
  { pattern: /github\.rest\.pulls\.create(Review|ReviewComment)/, reason: 'posts a PR review surface' },
  { pattern: /github\.rest\.checks\.create/, reason: 'creates a check run' },
  { pattern: /github\.rest\.repos\.createCommitStatus/, reason: 'sets a commit status' },
  { pattern: /gh pr (comment|review)/, reason: 'posts a PR comment/review via gh' },
  { pattern: /gh api [^\n]*\/(comments|check-runs|statuses)\b/, reason: 'writes a PR surface via the REST API' },
  { pattern: /::error/, reason: 'emits an ::error annotation (visible on the PR checks tab)' },
  { pattern: /::warning/, reason: 'emits a ::warning annotation (visible on the PR checks tab)' },
  { pattern: /::notice/, reason: 'emits a ::notice annotation (visible on the PR checks tab)' },
];

/** Pure check of one workflow file; returns violation messages. */
function checkWorkflowContent(name, content) {
  const violations = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = lines[index].replace(/\s+/g, ' ');
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(normalized)) {
        violations.push(`${name}:${index + 1}: forbidden \`${pattern.source}\` — ${reason}`);
      }
    }
  }

  if (!/^\s*permissions:/m.test(content)) {
    violations.push(
      `${name}: no explicit permissions: block — scan jobs must never run on the default token grants`,
    );
  }

  // `on: pull_request` (or `on: [pull_request, …]`) means the run is attached
  // to a PR: it must skip forks and must not be able to fail visibly.
  const hasPullRequestTrigger =
    /^\s*pull_request(_target)?\s*:/m.test(content) ||
    /^\s*on:\s*\[[^\]]*pull_request/m.test(content) ||
    /^\s*on:\s*pull_request/m.test(content);
  if (hasPullRequestTrigger) {
    if (/pull_request_target/.test(content)) {
      violations.push(
        `${name}: pull_request_target is forbidden — it grants a write token to fork PR code`,
      );
    }
    if (!content.includes('github.event.pull_request.head.repo.fork == false')) {
      violations.push(
        `${name}: pull_request trigger without the fork guard (if: github.event.pull_request.head.repo.fork == false)`,
      );
    }
    if (!/continue-on-error:\s*true/.test(content)) {
      violations.push(
        `${name}: pull_request trigger without continue-on-error: true on the scan step — a failed scan must never fail the workflow`,
      );
    }
  }
  return violations;
}

function listYamlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listYamlFiles(full));
    else if (/\.ya?ml$/.test(entry.name)) found.push(full);
  }
  return found;
}

function defaultTargets() {
  const targets = [];
  const workflowsDir = path.join(repoRoot, '.github', 'workflows');
  if (existsSync(workflowsDir)) {
    for (const entry of readdirSync(workflowsDir)) {
      if (/^hokusai-scan-.*\.ya?ml$/.test(entry)) {
        targets.push(path.join(workflowsDir, entry));
      }
    }
  }
  for (const template of ['shadow-mode-workflow.yml', 'adhoc-workflow.yml']) {
    const full = path.join(repoRoot, 'packages', 'scan', 'action', template);
    if (existsSync(full)) targets.push(full);
  }
  return targets;
}

function main() {
  const dirs = process.argv.slice(2);
  let files;
  if (dirs.length > 0) {
    files = dirs.flatMap((dir) => listYamlFiles(path.resolve(dir)));
    if (files.length === 0) {
      console.error(`Scan workflow surface check failed: no workflow files under ${dirs.join(', ')}.`);
      process.exitCode = 1;
      return;
    }
  } else {
    files = defaultTargets();
  }

  const violations = files.flatMap((file) =>
    checkWorkflowContent(path.relative(repoRoot, file), readFileSync(file, 'utf-8')),
  );

  if (violations.length > 0) {
    console.error('Scan workflow surface check failed (shadow mode must stay invisible on PRs):');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(`Scan workflow surface check passed (${files.length} file(s)).`);
  }
}

main();
