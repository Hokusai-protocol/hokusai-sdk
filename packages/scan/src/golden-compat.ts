/**
 * Test support: lift the frozen v1.0.0 survival-label goldens to the current
 * contract so parity tests stay byte-exact.
 *
 * `fixtures/arbiter/scan/<case>/survival-labels.expected.jsonl` was captured
 * from the pre-extraction wavemill labeller and is never re-captured to make a
 * test pass (scripts/capture-scan-golden.mjs). S2 v1.1.0 (HOK-3265) changed only
 * stamps — schema_version, labeller_version — and added
 * `envelope.integration_mode`; every outcome field is unchanged. Lifting the
 * golden with exactly those edits, and nothing else, keeps "label semantics are
 * identical to wavemill" a hard assertion across the bump.
 */
import { ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION } from '@hokusai/core';
import { SURVIVAL_LABELLER_VERSION } from './survival-labeller.js';

type Row = Record<string, unknown> & { envelope: Record<string, unknown> };

export function liftV1_0GoldenLabels(jsonl: string): string {
  return jsonl
    .split('\n')
    .map((line) => {
      if (!line) return line;
      const row = JSON.parse(line) as Row;
      if (row['schema_version'] !== '1.0.0')
        throw new Error('golden rows must be v1.0.0');
      const envelope: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row.envelope)) {
        if (key === 'schema_version') continue;
        envelope[key] =
          key === 'labeller_version' ? SURVIVAL_LABELLER_VERSION : value;
        // Builder order: integration_mode follows integration_branch, schema_version is stamped last.
        if (key === 'integration_branch')
          envelope['integration_mode'] = 'promotion';
      }
      envelope['schema_version'] = ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION;
      return JSON.stringify({
        ...row,
        schema_version: ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
        envelope,
      });
    })
    .join('\n');
}
