#!/usr/bin/env node
/**
 * Cross-check the docs against the packages that actually exist.
 *
 * `@hokusai/router` shipped as the front door of the product while appearing in
 * zero documents — not the README, not the SDK overview, not the release
 * checklist's post-publish verification — and `@hokusai/core` had no README at
 * all, so it would have published a blank page to npm. Nothing in CI could
 * notice either, because nothing compared what we publish with what we describe.
 *
 * Checks:
 *   1. Every `@hokusai/*` package named in a markdown install command exists.
 *   2. Every publishable package has its own README (its npm page).
 *   3. Every publishable package is named in the root README.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Publishable = a package under packages/ that is not marked private. */
const packages = readdirSync(path.join(repoRoot, 'packages'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(repoRoot, 'packages', entry.name))
  .filter((dir) => existsSync(path.join(dir, 'package.json')))
  .map((dir) => ({ dir, json: readJson(path.join(dir, 'package.json')) }))
  .filter(({ json }) => json.private !== true);

const known = new Set(packages.map(({ json }) => json.name));

function markdownFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'dist-zip') continue;
      markdownFiles(full, found);
    } else if (entry.name.endsWith('.md')) {
      found.push(full);
    }
  }
  return found;
}

// 1. Every @hokusai/* package named in an install command must exist.
const installPattern = /(?:npm install|pnpm add|yarn add)\s+((?:@hokusai\/[\w-]+\s*)+)/g;
for (const file of markdownFiles(repoRoot)) {
  const body = readFileSync(file, 'utf8');
  for (const match of body.matchAll(installPattern)) {
    for (const name of match[1].trim().split(/\s+/)) {
      if (!known.has(name)) {
        failures.push(
          `${path.relative(repoRoot, file)}: installs \`${name}\`, which is not a publishable package`,
        );
      }
    }
  }
}

// 2. Every publishable package needs its own README — that is its npm page.
for (const { dir, json } of packages) {
  if (!existsSync(path.join(dir, 'README.md'))) {
    failures.push(
      `${json.name}: no README.md — it would publish a blank page to npm`,
    );
  }
}

// 3. And it must be discoverable from the root README.
const rootReadme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
for (const { json } of packages) {
  if (!rootReadme.includes(json.name)) {
    failures.push(`${json.name}: published, but never mentioned in README.md`);
  }
}

if (failures.length > 0) {
  console.error('Docs do not match the packages we publish:\n');
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(`Docs match all ${packages.length} publishable packages.`);
