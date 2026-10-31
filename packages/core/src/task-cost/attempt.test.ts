/**
 * Contract tests for `task_attempt/v1` (HOK-3372). Schema at
 * `packages/core/schemas/task-attempt.v1.schema.json`; rules in
 * `attempt-identity.md`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  TASK_ATTEMPT_ARM_ROLES,
  TASK_ATTEMPT_CONTROL_ACTIONS,
  TASK_ATTEMPT_EVIDENCE_KINDS,
  TASK_ATTEMPT_KINDS,
  TASK_ATTEMPT_OUTCOMES,
} from './attempt.js';
import { reduceTaskAttemptLog } from './attempt-reducer.js';
import { TASK_ATTEMPT_V1_JSON_SCHEMA } from './attempt-schema.js';
import { isTaskAttemptLogEntryV1, validateTaskAttemptLogEntryV1, validateTaskAttemptRef } from './attempt-validators.js';
import { TASK_ATTEMPT_SCHEMA_VERSION } from './schema-version.js';
import { TaskCostValidationError, validateTaskCostEventV1 } from './validators.js';
import { taskAttemptFixtures } from '../fixtures/task-cost/attempt/index.js';
import {
  TASK,
  attempt,
  evidence,
  mint,
  outcome,
  ref,
} from '../fixtures/task-cost/attempt/builders.js';
import { claudeCodeSimpleFixture } from '../fixtures/task-cost/claude-code-simple.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../../schemas/task-attempt.v1.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as {
  $defs: Record<string, { enum?: unknown[]; const?: unknown; properties?: Record<string, { enum?: unknown[] }> }>;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaValid = ajv.compile(schema);

const run = mint(9001);
const stageAttempt = mint(9002);
const baseRun = attempt({ kind: 'run', id: run, parent: TASK, t: 0 });
const baseStage = attempt({ kind: 'stage_attempt', id: stageAttempt, parent: run, stage: 'planning', t: 1 });

function rejects(value: unknown): void {
  expect(() => validateTaskAttemptLogEntryV1(value)).toThrow(TaskCostValidationError);
}

describe('task_attempt/v1 schema', () => {
  it('the TS mirror is deep-equal to the canonical JSON file', () => {
    expect(TASK_ATTEMPT_V1_JSON_SCHEMA).toEqual(schema);
  });

  it('enums and the version match the exported constants', () => {
    const defs = schema.$defs;
    expect(defs.schemaVersion?.const).toBe(TASK_ATTEMPT_SCHEMA_VERSION);
    expect(defs.attempt?.properties?.kind?.enum).toEqual([...TASK_ATTEMPT_KINDS]);
    expect(defs.attempt?.properties?.role?.enum).toEqual([...TASK_ATTEMPT_ARM_ROLES]);
    expect(defs.control?.properties?.action?.enum).toEqual([...TASK_ATTEMPT_CONTROL_ACTIONS]);
    expect(defs.control?.properties?.outcome?.enum).toEqual([...TASK_ATTEMPT_OUTCOMES]);
    expect(defs.evidenceKind?.enum).toEqual([...TASK_ATTEMPT_EVIDENCE_KINDS]);
  });
});

describe('task_attempt/v1 golden fixtures', () => {
  it('covers every HOK-3372 scenario', () => {
    expect(taskAttemptFixtures.map((fixture) => fixture.name)).toEqual([
      'stage-retry-vs-child',
      'relaunch-settled-task',
      'stale-control-and-evidence-after-relaunch',
      'codex-pending-session-resolved',
      'same-second-launches',
      'challenge-pair',
      'comparison-recomputed',
      'two-pr-merge-candidate',
    ]);
  });

  for (const fixture of taskAttemptFixtures) {
    describe(fixture.name, () => {
      it('every entry passes the validator and the JSON schema', () => {
        for (const entry of fixture.log) {
          expect(isTaskAttemptLogEntryV1(entry)).toBe(true);
          expect(schemaValid(entry), JSON.stringify(schemaValid.errors)).toBe(true);
        }
      });

      it('the reducer reproduces the expected result', () => {
        expect(reduceTaskAttemptLog(fixture.log)).toEqual(fixture.expected);
      });

      it('is pure: reducing twice gives the same result and leaves the log untouched', () => {
        const before = JSON.stringify(fixture.log);
        expect(reduceTaskAttemptLog(fixture.log)).toEqual(reduceTaskAttemptLog(fixture.log));
        expect(JSON.stringify(fixture.log)).toBe(before);
      });

      for (const prefix of fixture.prefixExpectations ?? []) {
        it(`derived results after the first ${prefix.length} entries`, () => {
          expect(reduceTaskAttemptLog(fixture.log.slice(0, prefix.length)).derived).toEqual(prefix.derived);
        });
      }

      if (fixture.extensionRecords) {
        it('extension records reference declared runs and define no run of their own', () => {
          const { attempts } = reduceTaskAttemptLog(fixture.log);
          for (const record of fixture.extensionRecords ?? []) {
            expect(record.attempt_refs.length).toBeGreaterThan(1);
            for (const attemptRef of record.attempt_refs) {
              validateTaskAttemptRef(attemptRef);
              const declared = attempts.find((state) => state.id === attemptRef.run_id);
              expect(declared?.kind).toBe('run');
              expect(declared?.task_id).toBe(attemptRef.task_id);
            }
            expect(attempts.some((state) => state.id === record.candidate_id)).toBe(false);
          }
        });
      }
    });
  }
});

describe('task_attempt/v1 validators', () => {
  const invalid: [string, unknown][] = [
    ['a derived Wavemill label as an id', { ...baseStage, id: 'planning@a1b2c3d#1793396483' }],
    ['an uppercase UUID', { ...baseRun, id: run.toUpperCase() }],
    ['a stage attempt whose parent is the task', { ...baseStage, parent_id: TASK }],
    ['a stage attempt without a stage', { ...baseStage, stage: undefined }],
    ['a stage on a run', { ...baseRun, stage: 'planning' }],
    ['an arm without a role', attempt({ kind: 'arm', id: mint(9003), parent: mint(9004), t: 0 })],
    ['a retry on an arm', { ...attempt({ kind: 'arm', id: mint(9003), parent: mint(9004), role: 'primary', t: 0 }), retry_of: mint(9005) }],
    ['an address-shaped legacy id', { ...baseStage, legacy_ids: ['someone@example.com'] }],
    ['a short head sha', { ...baseRun, code_identity: { head_sha: 'a1b2c3d' } }],
    [
      'a pending session resolving a pending session',
      { ...baseStage, session_refs: [{ harness: 'codex', session_id: 'pending:a', resolves: 'pending:b' }] },
    ],
    ['an outcome write without an outcome', { ...outcome(mint(9010), ref(run), 'failed', 1), outcome: undefined }],
    ['an outcome write with a value', { ...outcome(mint(9010), ref(run), 'failed', 1), value: 'planning' }],
    ['an unknown outcome', { ...outcome(mint(9010), ref(run), 'failed', 1), outcome: 'merged' }],
    ['a derived run_id in a ref', outcome(mint(9010), { task_id: TASK, run_id: 'run-epoch-1793396483' }, 'failed', 1)],
    ['evidence version 0', evidence(mint(9011), ref(run), 'cost', 0, 1)],
    ['an unknown evidence kind', { ...evidence(mint(9011), ref(run), 'cost', 1, 1), evidence_kind: 'vibes' }],
    [
      'a derived result with no inputs',
      {
        schema_version: TASK_ATTEMPT_SCHEMA_VERSION,
        record_type: 'derived',
        observed_at: '2026-10-31T12:00:00Z',
        derived_id: mint(9012),
        derived_kind: 'challenge_comparison',
        inputs: [],
      },
    ],
    ['an unknown schema version', { ...baseRun, schema_version: 'task_attempt/v2' }],
  ];

  for (const [label, value] of invalid) {
    it(`rejects ${label} (validator and JSON schema agree)`, () => {
      rejects(value);
      expect(schemaValid(JSON.parse(JSON.stringify(value)))).toBe(false);
    });
  }

  it('rejects cross-field equalities JSON Schema cannot express (validator-only rules)', () => {
    rejects(attempt({ kind: 'pair', id: mint(9020), parent: mint(9021), t: 0 }));
    rejects({ ...baseRun, parent_id: run });
    // A child is not a retry: retry_of must not point at the parent.
    rejects({ ...baseStage, retry_of: run });
  });

  it('rejects forbidden keys at any depth (validator-only rule)', () => {
    rejects({ ...baseRun, branch: 'task/hok-9001' });
    rejects({ ...baseRun, code_identity: { head_sha: 'a'.repeat(40), worktree: 'x' } });
  });

  it('accepts ULIDs and ignores unknown fields', () => {
    const ulidRun = { ...baseRun, id: '01JBF3ZK3C8V7Q2W9X4Y5Z6A7B', future_field: 1 };
    validateTaskAttemptLogEntryV1(ulidRun);
    expect(schemaValid(ulidRun)).toBe(true);
  });
});

describe('reduceTaskAttemptLog edge cases', () => {
  it('rejects a child whose parent was never launched, or is the wrong kind', () => {
    const orphan = attempt({ kind: 'stage_attempt', id: mint(9030), parent: mint(9031), stage: 'planning', t: 0 });
    const runUnderRun = attempt({ kind: 'run', id: mint(9032), parent: run, t: 2 });
    const result = reduceTaskAttemptLog([orphan, baseRun, runUnderRun]);
    expect(result.decisions.map((d) => d.reasons)).toEqual([['unknown_parent'], undefined, ['parent_mismatch']]);
  });

  it('rejects a control write for an undeclared attempt', () => {
    const result = reduceTaskAttemptLog([outcome(mint(9040), ref(run), 'succeeded', 0)]);
    expect(result.decisions[0]).toMatchObject({ decision: 'rejected', reasons: ['unknown_attempt'] });
  });

  it('accepts evidence for an attempt it has not seen launched, and notes it', () => {
    const late = evidence(mint(9041), ref(run, stageAttempt), 'cost', 1, 0);
    const result = reduceTaskAttemptLog([late, baseRun, baseStage]);
    expect(result.decisions[0]).toMatchObject({ decision: 'accepted', reasons: ['undeclared_attempt'] });
    expect(result.evidence).toEqual([
      { attempt_id: stageAttempt, evidence_kind: 'cost', latest_version: 1, write_ids: [late.write_id] },
    ]);
  });

  it('keeps an older evidence version for audit without moving the latest', () => {
    const v2 = evidence(mint(9042), ref(run), 'cost', 2, 1);
    const v1 = evidence(mint(9043), ref(run), 'cost', 1, 2);
    const result = reduceTaskAttemptLog([baseRun, v2, v1]);
    expect(result.decisions[2]).toMatchObject({ decision: 'accepted', reasons: ['evidence_version_not_newer'] });
    expect(result.evidence[0]).toMatchObject({ latest_version: 2, write_ids: [v2.write_id, v1.write_id] });
  });

  it('settles once: a second outcome on a settled attempt is rejected', () => {
    const result = reduceTaskAttemptLog([
      baseRun,
      outcome(mint(9044), ref(run), 'succeeded', 1),
      outcome(mint(9045), ref(run), 'failed', 2),
    ]);
    expect(result.decisions[2]).toMatchObject({ decision: 'rejected', reasons: ['settled'] });
    expect(result.attempts[0]?.outcome).toBe('succeeded');
  });

  it('a relaunched plain run supersedes a challenge pair and every arm run under it', () => {
    const pair = attempt({ kind: 'pair', id: mint(9050), parent: TASK, t: 0 });
    const arm = attempt({ kind: 'arm', id: mint(9051), parent: pair.id, role: 'primary', t: 0 });
    const armRun = attempt({ kind: 'run', id: mint(9052), parent: arm.id, t: 0 });
    const plain = attempt({ kind: 'run', id: mint(9053), parent: TASK, t: 1 });
    const late = outcome(mint(9054), ref(armRun.id), 'succeeded', 2);
    const result = reduceTaskAttemptLog([pair, arm, armRun, plain, late]);
    expect(result.decisions[4]).toMatchObject({ decision: 'rejected', reasons: ['stale_run'] });
    expect(result.attempts.filter((state) => state.current).map((state) => state.id)).toEqual([plain.id]);
  });

  it('throws on an invalid entry instead of guessing', () => {
    expect(() => reduceTaskAttemptLog([{ ...baseRun, id: 'nope' }])).toThrow(TaskCostValidationError);
  });
});

describe('task_cost_event/v1 attempt identity (contract 1.1.0)', () => {
  const event = claudeCodeSimpleFixture.events[0];

  it('accepts minted run_id and stage_attempt_id', () => {
    validateTaskCostEventV1({ ...event, run_id: run, stage_attempt_id: stageAttempt });
  });

  it('rejects a derived run_id', () => {
    expect(() => validateTaskCostEventV1({ ...event, run_id: 'implementation@nohead#1793396483' })).toThrow(
      TaskCostValidationError,
    );
  });

  it('rejects stage_attempt_id without run_id', () => {
    expect(() => validateTaskCostEventV1({ ...event, stage_attempt_id: stageAttempt })).toThrow(
      TaskCostValidationError,
    );
  });
});
