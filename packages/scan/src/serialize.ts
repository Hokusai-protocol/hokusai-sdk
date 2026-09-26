/**
 * Canonical output serialization shared by the CLI, the Action, and the
 * golden parity tests. Byte-identical output across entry points is the
 * extraction's acceptance test, so every writer goes through these helpers.
 */

import type { ArbiterSurvivalLabelV1, CandidateFeaturesV1 } from '@hokusai/core';
import type { MergedPrRef } from './survival-labeller.js';

/**
 * Candidate features as pretty JSON with keys sorted lexicographically at
 * every level, trailing newline. The object shape is fixed by the schema, so
 * sorting only pins insertion-order differences between producers.
 */
export function serializeCandidateFeatures(features: CandidateFeaturesV1): string {
  return `${JSON.stringify(features, collectKeysSorted(features), 2)}\n`;
}

function collectKeysSorted(value: unknown): string[] {
  const keys = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        keys.add(key);
        visit(child);
      }
    }
  };
  visit(value);
  return [...keys].sort();
}

/**
 * Survival labels as JSONL, one compact row per line, trailing newline when
 * non-empty. Row key order is the deterministic insertion order stamped by
 * `buildArbiterSurvivalLabel`.
 */
export function serializeSurvivalLabels(labels: readonly ArbiterSurvivalLabelV1[]): string {
  if (labels.length === 0) return '';
  return labels.map((label) => `${JSON.stringify(label)}\n`).join('');
}

/**
 * Deterministic emission order for enumerated PRs: oldest merge first, PR
 * number as the tiebreak. This matches the pre-extraction backfill tool, so
 * goldens captured from it stay byte-comparable.
 */
export function sortMergedPrsForEmission(prs: readonly MergedPrRef[]): MergedPrRef[] {
  return [...prs].sort((a, b) => a.mergedAtEpoch - b.mergedAtEpoch || a.prNumber - b.prNumber);
}
