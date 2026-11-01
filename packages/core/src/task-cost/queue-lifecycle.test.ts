/**
 * Contract tests for `queue_lifecycle_event/v1` (HOK-3338 / MQ-1.2). Schema
 * at `packages/core/schemas/queue-lifecycle-event.v1.schema.json`; rules in
 * `queue-lifecycle.md`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  QUEUE_CHECK_CONCLUSIONS,
  QUEUE_LIFECYCLE_EVENT_SCOPES,
  QUEUE_LIFECYCLE_EVENT_TYPES,
  QUEUE_LIFECYCLE_EVENT_WRITE_CLASS,
  QUEUE_RECOVERY_ACTIONS,
  queueCandidateCodeIdentity,
  queueLifecycleEventAttemptRefs,
  type QueueCandidatePreparedEvent,
  type QueueLifecycleEventV1,
} from './queue-lifecycle.js';
import { reduceQueueLifecycleLog } from './queue-lifecycle-reducer.js';
import { QUEUE_LIFECYCLE_EVENT_V1_JSON_SCHEMA } from './queue-lifecycle-schema.js';
import { isQueueLifecycleEventV1, validateQueueLifecycleEventV1 } from './queue-lifecycle-validators.js';
import { QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION, TASK_ATTEMPT_SCHEMA_VERSION } from './schema-version.js';
import { TaskCostValidationError } from './validators.js';
import { twoPrMergeCandidateFixture } from '../fixtures/task-cost/attempt/index.js';
import {
  ACTIONS,
  OPERATOR,
  TASK,
  TEND,
  agent,
  attempt,
  mint,
  outcome,
  pr,
  qe,
  ref,
  sha,
} from '../fixtures/task-cost/queue/builders.js';
import {
  cumulativeCandidatePredecessorEjectsQueueFixture,
  queueLifecycleFixtures,
} from '../fixtures/task-cost/queue/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../../schemas/queue-lifecycle-event.v1.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as {
  oneOf: { $ref: string }[];
  $defs: Record<string, { const?: unknown; enum?: unknown[] }>;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaValid = ajv.compile(schema);

const RUN = mint(90001);
const RUN_REF = ref(RUN);
const queueEvents = (stream: readonly unknown[]): QueueLifecycleEventV1[] =>
  stream.filter(
    (entry): entry is QueueLifecycleEventV1 =>
      (entry as { schema_version: string }).schema_version === QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION,
  );

function enqueued(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...qe({ event_id: mint(90101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(RUN_REF, 1, sha(1)) }),
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...qe({
      event_id: mint(90102), event_type: 'recovery_decision', t: 60, actor: TEND, ...pr(RUN_REF, 1, sha(1)),
      policy: { name: 'merge-lane-recovery', version: '1.0.0' },
      context: { as_of: '2026-10-31T12:00:50Z', event_ids: [mint(90101)] },
      available_actions: ['retry', 'escalate'], chosen_action: 'retry', propensity_source: 'exact',
      propensities: [{ action: 'retry', probability: 0.7 }, { action: 'escalate', probability: 0.3 }],
    }),
    ...overrides,
  };
}

function reviewCompleted(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...qe({
      event_id: mint(90103), event_type: 'review_round_completed', t: 100, actor: TEND, ...pr(RUN_REF, 1, sha(2)),
      round: 2, first_round_head_sha: sha(1),
      reviewers: [{ reviewer_key: 'correctness', stage: 'review', harness: 'codex', executed_model_evidence: 'not_observed' }],
      findings: [{ finding_id: mint(90401), reviewer_key: 'correctness', blocking: true, location: 'changed_since_first_round' }],
    }),
    ...overrides,
  };
}

describe('queue_lifecycle_event/v1 schema', () => {
  it('the TS mirror is deep-equal to the canonical JSON file', () => {
    expect(QUEUE_LIFECYCLE_EVENT_V1_JSON_SCHEMA).toEqual(schema);
  });

  it('the version, event types and enums match the exported constants', () => {
    expect(schema.$defs.schemaVersion?.const).toBe(QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION);
    expect(schema.oneOf.map((entry) => entry.$ref.replace('#/$defs/', ''))).toEqual([...QUEUE_LIFECYCLE_EVENT_TYPES]);
    expect(schema.$defs.recoveryAction?.enum).toEqual([...QUEUE_RECOVERY_ACTIONS]);
    expect(JSON.stringify(schema)).toContain(JSON.stringify([...QUEUE_CHECK_CONCLUSIONS]));
  });

  it('every event type has a write class and at least one scope', () => {
    for (const type of QUEUE_LIFECYCLE_EVENT_TYPES) {
      expect(['control', 'evidence']).toContain(QUEUE_LIFECYCLE_EVENT_WRITE_CLASS[type]);
      expect(QUEUE_LIFECYCLE_EVENT_SCOPES[type].length).toBeGreaterThan(0);
    }
  });
});

describe('queue_lifecycle_event/v1 golden fixtures', () => {
  it('covers every HOK-3338 acceptance scenario', () => {
    expect(queueLifecycleFixtures.map((fixture) => fixture.name)).toEqual([
      'clean-merge',
      'flake-rerun',
      'base-drift-rebase',
      'real-failure-repair',
      'cumulative-candidate-predecessor-ejects',
      'operator-manual-commit',
      'crash-resume-duplicate',
      'multi-round-review',
    ]);
  });

  it('exercises every event type', () => {
    const seen = new Set(queueLifecycleFixtures.flatMap((fixture) => queueEvents(fixture.stream).map((e) => e.event_type)));
    expect([...seen].sort()).toEqual([...QUEUE_LIFECYCLE_EVENT_TYPES].filter((t) => t !== 'abandoned').sort());
  });

  for (const fixture of queueLifecycleFixtures) {
    describe(fixture.name, () => {
      it('every queue event passes the validator and the JSON schema', () => {
        for (const event of queueEvents(fixture.stream)) {
          expect(isQueueLifecycleEventV1(event)).toBe(true);
          expect(schemaValid(event), JSON.stringify(schemaValid.errors)).toBe(true);
        }
      });

      it('the reducer reproduces the expected result', () => {
        expect(reduceQueueLifecycleLog(fixture.stream)).toEqual(fixture.expected);
      });

      it('is pure and idempotent: reducing twice is equal; replaying the whole stream adds nothing', () => {
        const before = JSON.stringify(fixture.stream);
        expect(reduceQueueLifecycleLog(fixture.stream)).toEqual(reduceQueueLifecycleLog(fixture.stream));
        expect(JSON.stringify(fixture.stream)).toBe(before);
        const replayed = reduceQueueLifecycleLog([...fixture.stream, ...queueEvents(fixture.stream)]);
        expect(replayed.accepted_event_ids).toEqual(fixture.expected.accepted_event_ids);
        expect(replayed.candidates).toEqual(fixture.expected.candidates);
      });

      it('defines no run or attempt id of its own: every ref names a declared run', () => {
        const runs = new Set(
          fixture.stream.flatMap((entry) =>
            entry.schema_version === TASK_ATTEMPT_SCHEMA_VERSION && entry.record_type === 'attempt' ? [entry.id] : [],
          ),
        );
        for (const event of queueEvents(fixture.stream)) {
          for (const attemptRef of queueLifecycleEventAttemptRefs(event)) expect(runs.has(attemptRef.run_id)).toBe(true);
          if ('candidate_id' in event && event.candidate_id !== undefined) expect(runs.has(event.candidate_id)).toBe(false);
        }
      });

      it('never records an observed model without observation evidence', () => {
        for (const event of queueEvents(fixture.stream)) {
          const attributions = [
            event.actor,
            ...(event.event_type === 'review_round_completed' ? event.reviewers : []),
          ] as unknown as Record<string, unknown>[];
          for (const attribution of attributions) {
            if (attribution.executed_model !== undefined) {
              expect(attribution.executed_model_evidence).not.toBe('not_observed');
            }
          }
        }
      });

      it('carries nothing path-, address- or URL-shaped', () => {
        const text = JSON.stringify(queueEvents(fixture.stream));
        expect(text).not.toMatch(/\/Users\/|\\\\|https?:|@[a-z0-9-]+\.[a-z]{2,}|\.git\b/i);
      });
    });
  }

  it('the HOK-3372 two-pr merge-candidate extension record is the identity part of a candidate_prepared event', () => {
    const [record] = twoPrMergeCandidateFixture.extensionRecords ?? [];
    expect(record).toBeDefined();
    const event = qe({
      event_id: record!.event_id, event_type: 'candidate_prepared', t: 0, actor: TEND,
      candidate_id: record!.candidate_id, attempt_refs: record!.attempt_refs, base_sha: sha(100),
      entries: record!.attempt_refs.map((_, index) => ({ pr_number: index + 1, head_sha: sha(index + 1) })),
    });
    expect(isQueueLifecycleEventV1(event)).toBe(true);
    expect(schemaValid(event)).toBe(true);
  });

  it('derives each entry\'s code identity from the stored composition', () => {
    const cumulative = queueEvents(cumulativeCandidatePredecessorEjectsQueueFixture.stream).find(
      (event): event is QueueCandidatePreparedEvent => event.event_type === 'candidate_prepared',
    )!;
    expect(queueCandidateCodeIdentity(cumulative, 0)).toEqual({ base_sha: sha(100), predecessor_shas: [], head_sha: sha(1) });
    expect(queueCandidateCodeIdentity(cumulative, 1)).toEqual({
      base_sha: sha(100),
      predecessor_shas: [sha(1)],
      head_sha: sha(2),
    });
    expect(() => queueCandidateCodeIdentity(cumulative, 2)).toThrow(RangeError);
  });
});

describe('queue_lifecycle_event/v1 validators', () => {
  const invalid: [string, Record<string, unknown>][] = [
    ['a derived event_id', enqueued({ event_id: `enqueued@${sha(1)}` })],
    ['a branch-named attempt instead of a minted run id', enqueued({ attempt: { task_id: TASK, run_id: 'feature-x' } })],
    ['an unknown event type', enqueued({ event_type: 'queued' })],
    ['both scopes at once', enqueued({ candidate_id: mint(1), attempt_refs: [RUN_REF] })],
    ['a candidate scope on a PR-only event', (() => {
      const event = enqueued({ candidate_id: mint(1), attempt_refs: [RUN_REF] });
      delete event.attempt;
      delete event.pr_number;
      return event;
    })()],
    ['a short SHA', enqueued({ head_sha: 'abc1234' })],
    ['an agent actor with no observation evidence field', enqueued({ actor: { kind: 'agent', harness: 'codex', executed_model: 'gpt-5.5' } })],
    ['an operator actor carrying a model', enqueued({ actor: { kind: 'operator', executed_model: 'gpt-5.5' } })],
    ['propensities when the source is none', decision({ propensity_source: 'none' })],
    ['missing propensities for an exact source', decision({ propensities: undefined })],
    ['round 1 findings located after round 1', reviewCompleted({ round: 1, first_round_head_sha: sha(2), head_sha: sha(2) })],
    ['a first_round location after round 1', reviewCompleted({
      findings: [{ finding_id: mint(5), reviewer_key: 'correctness', blocking: false, location: 'first_round' }],
    })],
    ['a non-integer check run attempt', {
      ...qe({
        event_id: mint(90104), event_type: 'check_run_completed', t: 100, actor: ACTIONS, ...pr(RUN_REF, 1, sha(1)),
        check_run_id: '1', check_key: 'ci', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
        completed_at: '2026-10-31T12:01:00Z',
      }),
      run_attempt: 1.5,
    }],
  ];

  for (const [label, value] of invalid) {
    it(`rejects ${label} (validator and JSON schema agree)`, () => {
      expect(() => validateQueueLifecycleEventV1(value)).toThrow(TaskCostValidationError);
      expect(schemaValid(value)).toBe(false);
    });
  }

  it('rejects an observed model populated without observation (validator and JSON schema)', () => {
    const fromIntent = enqueued({
      actor: { kind: 'agent', harness: 'codex', intended_model: 'gpt-5.5', executed_model_evidence: 'not_observed', executed_model: 'gpt-5.5' },
    });
    expect(() => validateQueueLifecycleEventV1(fromIntent)).toThrow(/observation evidence/);
    expect(schemaValid(fromIntent)).toBe(false);
    const missingObserved = enqueued({ actor: { kind: 'agent', harness: 'codex', executed_model_evidence: 'provider_response' } });
    expect(() => validateQueueLifecycleEventV1(missingObserved)).toThrow(TaskCostValidationError);
    expect(schemaValid(missingObserved)).toBe(false);
  });

  it('rejects a review configuration that claims what executed', () => {
    const started = qe({
      event_id: mint(90105), event_type: 'review_round_started', t: 10, actor: TEND, ...pr(RUN_REF, 1, sha(1)),
      round: 1, reviewers: [{ reviewer_key: 'correctness', stage: 'review' }],
    }) as unknown as Record<string, unknown>;
    expect(isQueueLifecycleEventV1(started)).toBe(true);
    const claims = { ...started, reviewers: [{ reviewer_key: 'correctness', stage: 'review', executed_model: 'gpt-5.5' }] };
    expect(() => validateQueueLifecycleEventV1(claims)).toThrow(TaskCostValidationError);
    expect(schemaValid(claims)).toBe(false);
  });

  it('rejects rules JSON Schema cannot express (validator-only)', () => {
    const rejects = (value: unknown) => expect(() => validateQueueLifecycleEventV1(value)).toThrow(TaskCostValidationError);
    rejects(decision({ propensities: [{ action: 'retry', probability: 0.7 }, { action: 'escalate', probability: 0.2 }] }));
    rejects(decision({ propensities: [{ action: 'retry', probability: 0 }, { action: 'escalate', probability: 1 }] }));
    rejects(decision({ propensity_source: 'deterministic' }));
    rejects(decision({ chosen_action: 'fix' }));
    rejects(reviewCompleted({ round: 1, findings: [] }));
    rejects(decision({ context: { as_of: '2026-10-31T12:05:00Z', event_ids: [] } }));
    rejects(decision({ context: { as_of: '2026-10-31T12:00:50Z', event_ids: [], flake_history: [{ check_key: 'ci', window_runs: 1, window_failures: 2 }] } }));
    rejects(enqueued({ queue_depth: null }));
    rejects(reviewCompleted({ findings: [{ finding_id: mint(6), reviewer_key: 'security', blocking: false, location: 'unknown' }] }));
    rejects(reviewCompleted({
      findings: [{ finding_id: mint(7), reviewer_key: 'correctness', blocking: false, location: 'unknown', reflag_of: mint(7) }],
    }));
    rejects(enqueued({ candidate_id: mint(8) }));
    rejects(
      qe({
        event_id: mint(90106), event_type: 'candidate_prepared', t: 0, actor: TEND,
        candidate_id: mint(9), attempt_refs: [RUN_REF, ref(mint(90002))], base_sha: sha(100),
        entries: [{ pr_number: 1, head_sha: sha(1) }],
      }),
    );
    rejects(
      qe({
        event_id: mint(90107), event_type: 'rebase_performed', t: 0, actor: TEND, ...pr(RUN_REF, 1, sha(1)),
        previous_head_sha: sha(1), base_sha: sha(100), method: 'rebase',
      }),
    );
  });

  it('rejects forbidden keys at any depth (validator-only rule)', () => {
    expect(() => validateQueueLifecycleEventV1(enqueued({ branch: 'feature/x' }))).toThrow(/Forbidden field/);
    expect(() => validateQueueLifecycleEventV1(enqueued({ actor: { kind: 'operator', email: 'x' } }))).toThrow(/Forbidden field/);
    expect(() =>
      validateQueueLifecycleEventV1(decision({ context: { as_of: '2026-10-31T12:00:50Z', event_ids: [], prompt: 'x' } })),
    ).toThrow(/Forbidden field/);
  });

  it('accepts ULIDs and ignores unknown fields', () => {
    const event = enqueued({ event_id: '01JBXK5V7Q0000000000000000', future_field: { nested: true } });
    expect(isQueueLifecycleEventV1(event)).toBe(true);
    expect(schemaValid(event)).toBe(true);
  });
});

describe('reduceQueueLifecycleLog edge cases', () => {
  const run = attempt({ kind: 'run', id: RUN, parent: TASK, t: 0 });

  it('rejects a control event for an undeclared run, and keeps evidence for one', () => {
    const check = qe({
      event_id: mint(90201), event_type: 'check_run_completed', t: 100, actor: ACTIONS, ...pr(RUN_REF, 1, sha(1)),
      check_run_id: '1', check_key: 'ci', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
      completed_at: '2026-10-31T12:01:00Z',
    });
    const result = reduceQueueLifecycleLog([enqueued() as unknown as QueueLifecycleEventV1, check]);
    expect(result.decisions.map((d) => [d.decision, d.reasons])).toEqual([
      ['rejected', ['unknown_attempt']],
      ['accepted', ['undeclared_attempt']],
    ]);
  });

  it('rejects a ref that names a run under another task, for control and evidence alike', () => {
    const wrongTask = { task_id: 'HOK-1', run_id: RUN };
    const result = reduceQueueLifecycleLog([
      run,
      enqueued({ attempt: wrongTask }) as unknown as QueueLifecycleEventV1,
      reviewCompleted({ attempt: wrongTask }) as unknown as QueueLifecycleEventV1,
    ]);
    expect(result.decisions.map((d) => d.reasons)).toEqual([['ref_mismatch'], ['ref_mismatch']]);
  });

  it('rejects a control event for a stage attempt that a retry superseded', () => {
    const first = attempt({ kind: 'stage_attempt', id: mint(90011), parent: RUN, stage: 'review', t: 1 });
    const failed = outcome(mint(90301), ref(RUN, first.id), 'failed', 2);
    const retry = attempt({ kind: 'stage_attempt', id: mint(90012), parent: RUN, stage: 'review', retryOf: first.id, t: 3 });
    const started = qe({
      event_id: mint(90202), event_type: 'review_round_started', t: 4, actor: TEND, ...pr(ref(RUN, first.id), 1, sha(1)),
      round: 1, reviewers: [{ reviewer_key: 'correctness', stage: 'review' }],
    });
    const result = reduceQueueLifecycleLog([run, first, failed, retry, started]);
    expect(result.decisions[0]).toMatchObject({ decision: 'rejected', reasons: ['stale_stage_attempt', 'settled'] });
  });

  it('rejects a reused candidate id and a control event naming an unknown candidate', () => {
    const scope = { candidate_id: mint(90501), attempt_refs: [RUN_REF] };
    const prepared = qe({
      event_id: mint(90203), event_type: 'candidate_prepared', t: 10, actor: TEND, ...scope, base_sha: sha(100),
      entries: [{ pr_number: 1, head_sha: sha(1) }],
    });
    const reused = { ...prepared, event_id: mint(90204) } as QueueLifecycleEventV1;
    const unknown = qe({
      event_id: mint(90205), event_type: 'rerun_requested', t: 20, actor: TEND,
      candidate_id: mint(90502), attempt_refs: [RUN_REF], check_run_id: '1', check_key: 'ci', run_attempt: 1,
    });
    const strayMerge = qe({
      event_id: mint(90206), event_type: 'merged', t: 30, actor: TEND, ...pr(RUN_REF, 1, sha(1)),
      merge_commit_sha: sha(2), candidate_id: mint(90503),
    });
    const result = reduceQueueLifecycleLog([run, prepared, reused, unknown, strayMerge]);
    expect(result.decisions.map((d) => [d.decision, d.reasons])).toEqual([
      ['accepted', undefined],
      ['rejected', ['candidate_id_reused']],
      ['rejected', ['unknown_candidate']],
      ['rejected', ['unknown_candidate']],
    ]);
  });

  it('rejects a decision whose context reads an event from after its cut-off, or one never seen', () => {
    const enq = enqueued() as unknown as QueueLifecycleEventV1;
    const fromFuture = decision({
      context: { as_of: '2026-10-31T12:00:05Z', event_ids: [mint(90101)] },
    }) as unknown as QueueLifecycleEventV1;
    const fromNowhere = decision({
      event_id: mint(90207), context: { as_of: '2026-10-31T12:00:50Z', event_ids: [mint(99999)] },
    }) as unknown as QueueLifecycleEventV1;
    const ok = decision({ event_id: mint(90208) }) as unknown as QueueLifecycleEventV1;
    const result = reduceQueueLifecycleLog([run, enq, fromFuture, fromNowhere, ok]);
    expect(result.decisions.map((d) => [d.decision, d.reasons])).toEqual([
      ['accepted', undefined],
      ['rejected', ['context_leak']],
      ['rejected', ['context_leak']],
      ['accepted', undefined],
    ]);
  });

  it('attributes an operator commit to the operator, never to a model', () => {
    const operatorPush = qe({
      event_id: mint(90209), event_type: 'repair_commit_pushed', t: 10, actor: OPERATOR, ...pr(RUN_REF, 1, sha(2)),
      parent_sha: sha(1),
    });
    const agentPush = qe({
      event_id: mint(90210), event_type: 'repair_commit_pushed', t: 20, actor: agent('claude-sonnet-5-5'),
      ...pr(RUN_REF, 1, sha(3)), parent_sha: sha(2),
    });
    expect(reduceQueueLifecycleLog([run, operatorPush, agentPush]).accepted_event_ids).toHaveLength(2);
    expect(() =>
      validateQueueLifecycleEventV1({ ...operatorPush, actor: { kind: 'operator', harness: 'claude-code' } }),
    ).toThrow(TaskCostValidationError);
  });

  it('throws on an invalid entry instead of guessing', () => {
    expect(() => reduceQueueLifecycleLog([enqueued({ head_sha: 'nope' }) as unknown as QueueLifecycleEventV1])).toThrow(
      TaskCostValidationError,
    );
  });
});
