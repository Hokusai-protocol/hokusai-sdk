/**
 * The versioned contract every scan output carries.
 *
 * A consumer inspecting a scan artifact (JSONL labels, a candidate-feature
 * blob, or a combined scan report) can pin exactly what produced it:
 * - `candidateFeatures` / `labels` — the wire-format schema versions, owned
 *   by `@hokusai/core` (S1 and S2).
 * - `labellerVersion` / `normalizationVersion` — the scanner implementation
 *   semvers stamped into every label envelope.
 *
 * Frozen: changing any value is a contract change that must be coordinated
 * with the data-pipeline consumer, and re-capturing golden fixtures is only
 * legitimate in the PR that bumps one of these.
 */

import {
  ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
  CANDIDATE_FEATURES_SCHEMA_VERSION,
} from '@hokusai/core';
import {
  SURVIVAL_LABELLER_VERSION,
  SURVIVAL_NORMALIZATION_VERSION,
} from './survival-labeller.js';

const LABELS_MAJOR = ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION.split('.')[0] as string;

export const SCAN_CONTRACT = Object.freeze({
  candidateFeatures: CANDIDATE_FEATURES_SCHEMA_VERSION,
  labels: `arbiter_survival_label/v${LABELS_MAJOR}` as const,
  labellerVersion: SURVIVAL_LABELLER_VERSION,
  normalizationVersion: SURVIVAL_NORMALIZATION_VERSION,
});

export type ScanContract = typeof SCAN_CONTRACT;

/** `<candidateFeatures>:<labels>` — the Action's `contract-version` output. */
export function scanContractVersion(): string {
  return `${SCAN_CONTRACT.candidateFeatures}:${SCAN_CONTRACT.labels}`;
}
