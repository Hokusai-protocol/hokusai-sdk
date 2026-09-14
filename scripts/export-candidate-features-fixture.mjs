#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format } from 'prettier';
import {
  CANDIDATE_FEATURES_SCHEMA_VERSION,
  CANDIDATE_FEATURE_FIELDS,
  CANDIDATE_FEATURE_INTENT_FIELDS,
  CANDIDATE_FEATURE_PROVENANCE_FIELDS,
  CANDIDATE_FEATURE_SHAPE_FIELDS,
  CANDIDATE_FEATURE_STATIC_FIELDS,
  CANDIDATE_FEATURE_TEST_FIELDS,
  SDK_VERSION,
  completeCandidateFeaturesV1Fixture,
  observedZeroCandidateFeaturesV1Fixture,
  sparseCandidateFeaturesV1Fixture,
  validateCandidateFeaturesV1,
} from '../packages/core/dist/index.js';

const outputPath = resolve('fixtures/arbiter/candidate_features.v1.json');
const checkOnly = process.argv.includes('--check');

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function sourceTreeDirty() {
  return (
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
      .length > 0
  );
}

function vectors() {
  return {
    complete: completeCandidateFeaturesV1Fixture,
    sparse: sparseCandidateFeaturesV1Fixture,
    observed_zero: observedZeroCandidateFeaturesV1Fixture,
  };
}

function manifest() {
  return {
    fields: CANDIDATE_FEATURE_FIELDS,
    groups: {
      shape: CANDIDATE_FEATURE_SHAPE_FIELDS,
      static: CANDIDATE_FEATURE_STATIC_FIELDS,
      test: CANDIDATE_FEATURE_TEST_FIELDS,
      intent: CANDIDATE_FEATURE_INTENT_FIELDS,
      provenance: CANDIDATE_FEATURE_PROVENANCE_FIELDS,
    },
  };
}

function assertValidFixture(payload) {
  if (payload.provenance?.sdk_package !== '@hokusai/core') {
    throw new Error('Fixture provenance must name @hokusai/core.');
  }
  if (payload.provenance?.sdk_version !== SDK_VERSION) {
    throw new Error(
      `Fixture SDK version ${String(payload.provenance?.sdk_version)} does not match ${SDK_VERSION}.`,
    );
  }
  if (
    payload.provenance?.schema_version !== CANDIDATE_FEATURES_SCHEMA_VERSION
  ) {
    throw new Error('Fixture schema version is stale.');
  }
  if (!/^[0-9a-f]{40}$/.test(payload.provenance?.source_commit ?? '')) {
    throw new Error(
      'Fixture provenance must contain a 40-character git commit.',
    );
  }
  if (typeof payload.provenance?.source_tree_dirty !== 'boolean') {
    throw new Error(
      'Fixture provenance must record whether its source tree was dirty.',
    );
  }
  execFileSync('git', [
    'cat-file',
    '-e',
    `${payload.provenance.source_commit}^{commit}`,
  ]);

  for (const [name, vector] of Object.entries(payload.vectors ?? {})) {
    const result = validateCandidateFeaturesV1(vector);
    if (!result.ok) {
      throw new Error(
        `Fixture vector ${name} is invalid: ${result.errors
          .map((error) => `${error.path}: ${error.message}`)
          .join('; ')}`,
      );
    }
  }

  if (JSON.stringify(payload.vectors) !== JSON.stringify(vectors())) {
    throw new Error(
      'Fixture vectors drifted from @hokusai/core. Run pnpm export:candidate-features.',
    );
  }
  if (JSON.stringify(payload.manifest) !== JSON.stringify(manifest())) {
    throw new Error(
      'Fixture manifest drifted from @hokusai/core. Run pnpm export:candidate-features.',
    );
  }
}

if (checkOnly) {
  const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
  assertValidFixture(payload);
  process.stdout.write(`Candidate feature fixture is current: ${outputPath}\n`);
} else {
  const payload = {
    provenance: {
      sdk_package: '@hokusai/core',
      sdk_version: SDK_VERSION,
      schema_version: CANDIDATE_FEATURES_SCHEMA_VERSION,
      source_commit: currentCommit(),
      source_tree_dirty: sourceTreeDirty(),
      generation_command: 'pnpm export:candidate-features',
    },
    manifest: manifest(),
    vectors: vectors(),
  };
  mkdirSync(resolve('fixtures/arbiter'), { recursive: true });
  const formatted = await format(JSON.stringify(payload), { parser: 'json' });
  writeFileSync(outputPath, formatted, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}
