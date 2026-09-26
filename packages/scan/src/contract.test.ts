import { describe, expect, it } from 'vitest';
import {
  ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
  CANDIDATE_FEATURES_SCHEMA_VERSION,
} from '@hokusai/core';
import { SCAN_CONTRACT, scanContractVersion } from './contract.js';
import {
  SURVIVAL_LABELLER_VERSION,
  SURVIVAL_NORMALIZATION_VERSION,
} from './survival-labeller.js';

describe('SCAN_CONTRACT', () => {
  it('is frozen with exactly the four pinned entries', () => {
    expect(Object.isFrozen(SCAN_CONTRACT)).toBe(true);
    expect(SCAN_CONTRACT).toEqual({
      candidateFeatures: 'candidate_features/v1',
      labels: 'arbiter_survival_label/v1',
      labellerVersion: '1.0.0',
      normalizationVersion: '1.0.0',
    });
  });

  it('derives every entry from the owning constant, never a copy', () => {
    expect(SCAN_CONTRACT.candidateFeatures).toBe(CANDIDATE_FEATURES_SCHEMA_VERSION);
    expect(SCAN_CONTRACT.labels).toBe(
      `arbiter_survival_label/v${ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION.split('.')[0]}`,
    );
    expect(SCAN_CONTRACT.labellerVersion).toBe(SURVIVAL_LABELLER_VERSION);
    expect(SCAN_CONTRACT.normalizationVersion).toBe(SURVIVAL_NORMALIZATION_VERSION);
  });

  it('formats the Action contract-version output as <features>:<labels>', () => {
    expect(scanContractVersion()).toBe('candidate_features/v1:arbiter_survival_label/v1');
  });
});
