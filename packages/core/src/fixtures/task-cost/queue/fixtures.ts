/**
 * Golden fixtures for `queue_lifecycle_event/v1` (HOK-3338 / MQ-1.2). Each is
 * an arrival-ordered stream of queue events and the `task_attempt/v1` records
 * they reference, plus the hand-written result of `reduceQueueLifecycleLog`.
 * Changing an expected result is a contract change. Ids, SHAs and models are
 * synthetic.
 */

import type { QueueCandidatePreparedEvent, QueueLifecycleEventV1 } from '../../../task-cost/queue-lifecycle.js';
import type { QueueCandidateState } from '../../../task-cost/queue-lifecycle-reducer.js';
import {
  ACTIONS,
  GITHUB,
  OPERATOR,
  OTHER_TASK,
  TASK,
  TEND,
  WATCHDOG,
  agent,
  at,
  attempt,
  decisionsFor,
  eventIds,
  mint,
  outcome,
  pr,
  qe,
  ref,
  sha,
  type QueueLifecycleFixture,
} from './builders.js';

const BASE = sha(100);

function candidateState(
  candidate: QueueLifecycleEventV1,
  ejected: string[] = [],
  merged: string[] = [],
): QueueCandidateState {
  const prepared = candidate as QueueCandidatePreparedEvent;
  return {
    candidate_id: prepared.candidate_id,
    base_sha: prepared.base_sha,
    attempt_refs: prepared.attempt_refs,
    entries: prepared.entries,
    ejected_run_ids: ejected,
    merged_run_ids: merged,
  };
}

// ── 1. Clean merge ────────────────────────────────────────────────────────
const cleanMerge = (() => {
  const run = attempt({ kind: 'run', id: mint(1001), parent: TASK, t: 0 });
  const runRef = ref(run.id);
  const enqueued = qe({
    event_id: mint(1101), event_type: 'enqueued', t: 10, actor: TEND,
    ...pr(runRef, 101, sha(1)), base_sha: BASE, queue_depth: 0,
  });
  const candidate = qe({
    event_id: mint(1102), event_type: 'candidate_prepared', t: 20, actor: GITHUB,
    candidate_id: mint(1201), attempt_refs: [runRef], base_sha: BASE,
    entries: [{ pr_number: 101, head_sha: sha(1) }], candidate_sha: sha(2),
  });
  const check = qe({
    event_id: mint(1103), event_type: 'check_run_completed', t: 91, actor: ACTIONS,
    candidate_id: mint(1201), attempt_refs: [runRef], head_sha: sha(2),
    check_run_id: '5001', check_key: 'ci-test', trigger: 'merge_group', run_attempt: 1,
    conclusion: 'success', started_at: at(30), completed_at: at(90),
  });
  const merged = qe({
    event_id: mint(1104), event_type: 'merged', t: 95, actor: GITHUB,
    ...pr(runRef, 101, sha(1)), merge_commit_sha: sha(2), base_sha: BASE, candidate_id: mint(1201), method: 'merge',
  });
  const settled = outcome(mint(1301), runRef, 'succeeded', 100);
  const stream = [run, enqueued, candidate, check, merged, settled];
  return {
    name: 'clean-merge',
    description:
      'One PR is enqueued, prepared as a single-entry candidate, passes its merge_group check and merges. The run settles after the merge.',
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, candidate, check, merged),
      candidates: [candidateState(candidate, [], [run.id])],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 2. Flake + rerun ──────────────────────────────────────────────────────
const flakeRerun = (() => {
  const run = attempt({ kind: 'run', id: mint(2001), parent: TASK, t: 0 });
  const runRef = ref(run.id);
  const candidateId = mint(2201);
  const scope = { candidate_id: candidateId, attempt_refs: [runRef] };
  const enqueued = qe({
    event_id: mint(2101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(runRef, 102, sha(1)), base_sha: BASE,
  });
  const candidate = qe({
    event_id: mint(2102), event_type: 'candidate_prepared', t: 20, actor: GITHUB, ...scope, base_sha: BASE,
    entries: [{ pr_number: 102, head_sha: sha(1) }], candidate_sha: sha(2),
  });
  const unit = qe({
    event_id: mint(2103), event_type: 'check_run_completed', t: 81, actor: ACTIONS, ...scope, head_sha: sha(2),
    check_run_id: '6001', check_key: 'ci-unit', trigger: 'merge_group', run_attempt: 1, conclusion: 'success',
    started_at: at(25), completed_at: at(80),
  });
  const e2eFailed = qe({
    event_id: mint(2104), event_type: 'check_run_completed', t: 121, actor: ACTIONS, ...scope, head_sha: sha(2),
    check_run_id: '6002', check_key: 'ci-e2e', trigger: 'merge_group', run_attempt: 1, conclusion: 'failure',
    started_at: at(25), completed_at: at(120),
  });
  const decision = qe({
    event_id: mint(2105), event_type: 'recovery_decision', t: 125, actor: TEND, ...scope,
    policy: { name: 'merge-lane-recovery', version: '1.0.0' },
    context: {
      as_of: at(121), event_ids: [e2eFailed.event_id], failing_check_keys: ['ci-e2e'], attempt_number: 1,
      base_moved_since_candidate: false, queue_depth: 0,
      flake_history: [{ check_key: 'ci-e2e', window_runs: 20, window_failures: 3 }],
    },
    available_actions: ['retry', 'rebase', 'escalate'], chosen_action: 'retry', propensity_source: 'exact',
    propensities: [
      { action: 'retry', probability: 0.8 },
      { action: 'rebase', probability: 0.2 },
      { action: 'escalate', probability: 0 },
    ],
  });
  const rerun = qe({
    event_id: mint(2106), event_type: 'rerun_requested', t: 126, actor: TEND, ...scope,
    check_run_id: '6002', check_key: 'ci-e2e', run_attempt: 1,
  });
  const e2ePassed = qe({
    event_id: mint(2107), event_type: 'check_run_completed', t: 231, actor: ACTIONS, ...scope, head_sha: sha(2),
    check_run_id: '6003', check_key: 'ci-e2e', trigger: 'merge_group', run_attempt: 2, conclusion: 'success',
    started_at: at(130), completed_at: at(230),
  });
  const merged = qe({
    event_id: mint(2108), event_type: 'merged', t: 240, actor: GITHUB,
    ...pr(runRef, 102, sha(1)), merge_commit_sha: sha(2), candidate_id: candidateId,
  });
  const settled = outcome(mint(2301), runRef, 'succeeded', 250);
  const stream = [run, enqueued, candidate, unit, e2eFailed, decision, rerun, e2ePassed, merged, settled];
  return {
    name: 'flake-rerun',
    description:
      'A merge_group e2e check fails on attempt 1. A randomized (exact-propensity) recovery decision chooses retry over rebase; the rerun is attempt 2 of the same check_key with a new check_run_id, passes, and the PR merges. Both attempts stay as facts.',
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, candidate, unit, e2eFailed, decision, rerun, e2ePassed, merged),
      candidates: [candidateState(candidate, [], [run.id])],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 3. Base drift + rebase ────────────────────────────────────────────────
const baseDriftRebase = (() => {
  const run = attempt({ kind: 'run', id: mint(3001), parent: TASK, t: 0 });
  const runRef = ref(run.id);
  const enqueued = qe({
    event_id: mint(3101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(runRef, 103, sha(1)), base_sha: BASE,
  });
  const first = qe({
    event_id: mint(3102), event_type: 'candidate_prepared', t: 20, actor: TEND,
    candidate_id: mint(3201), attempt_refs: [runRef], base_sha: BASE, entries: [{ pr_number: 103, head_sha: sha(1) }],
  });
  const ejected = qe({
    event_id: mint(3103), event_type: 'ejected', t: 60, actor: TEND,
    ...pr(runRef, 103, sha(1)), trigger: 'base_moved', candidate_id: mint(3201),
  });
  const decision = qe({
    event_id: mint(3104), event_type: 'recovery_decision', t: 62, actor: TEND, ...pr(runRef, 103, sha(1)),
    policy: { name: 'merge-lane-recovery', version: '1.0.0' },
    context: { as_of: at(60), event_ids: [ejected.event_id], attempt_number: 1, base_moved_since_candidate: true },
    available_actions: ['retry', 'rebase', 'escalate'], chosen_action: 'rebase', propensity_source: 'deterministic',
    propensities: [
      { action: 'retry', probability: 0 },
      { action: 'rebase', probability: 1 },
      { action: 'escalate', probability: 0 },
    ],
  });
  const rebased = qe({
    event_id: mint(3105), event_type: 'rebase_performed', t: 70, actor: TEND, ...pr(runRef, 103, sha(3)),
    previous_head_sha: sha(1), previous_base_sha: BASE, base_sha: sha(101), method: 'rebase', had_conflicts: false,
  });
  const requeued = qe({
    event_id: mint(3106), event_type: 'enqueued', t: 75, actor: TEND, ...pr(runRef, 103, sha(3)), base_sha: sha(101),
  });
  const second = qe({
    event_id: mint(3107), event_type: 'candidate_prepared', t: 80, actor: TEND,
    candidate_id: mint(3202), attempt_refs: [runRef], base_sha: sha(101), entries: [{ pr_number: 103, head_sha: sha(3) }],
  });
  const check = qe({
    event_id: mint(3108), event_type: 'check_run_completed', t: 141, actor: ACTIONS, ...pr(runRef, 103, sha(3)),
    check_run_id: '7001', check_key: 'ci-test', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
    completed_at: at(140),
  });
  const merged = qe({
    event_id: mint(3109), event_type: 'merged', t: 150, actor: TEND,
    ...pr(runRef, 103, sha(3)), merge_commit_sha: sha(4), base_sha: sha(101), candidate_id: mint(3202), method: 'squash',
  });
  const settled = outcome(mint(3301), runRef, 'succeeded', 160);
  const stream = [run, enqueued, first, ejected, decision, rebased, requeued, second, check, merged, settled];
  return {
    name: 'base-drift-rebase',
    description:
      'The base moves under a prepared candidate, so the PR is ejected (trigger base_moved). A deterministic decision rebases it; the head move is a rebase_performed evidence fact on the same run, not a new attempt. It re-enters in a new candidate on the new base and merges.',
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, first, ejected, decision, rebased, requeued, second, check, merged),
      candidates: [candidateState(first, [run.id]), candidateState(second, [], [run.id])],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 4. Real failure + repair commit ───────────────────────────────────────
const realFailureRepair = (() => {
  const run = attempt({ kind: 'run', id: mint(4001), parent: TASK, t: 0 });
  const runRef = ref(run.id);
  const enqueued = qe({
    event_id: mint(4101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(runRef, 104, sha(1)), base_sha: BASE,
  });
  const first = qe({
    event_id: mint(4102), event_type: 'candidate_prepared', t: 20, actor: TEND,
    candidate_id: mint(4201), attempt_refs: [runRef], base_sha: BASE, entries: [{ pr_number: 104, head_sha: sha(1) }],
  });
  const failed = qe({
    event_id: mint(4103), event_type: 'check_run_completed', t: 91, actor: ACTIONS, ...pr(runRef, 104, sha(1)),
    check_run_id: '8001', check_key: 'ci-unit', trigger: 'pull_request', run_attempt: 1, conclusion: 'failure',
    started_at: at(30), completed_at: at(90),
  });
  const ejected = qe({
    event_id: mint(4104), event_type: 'ejected', t: 92, actor: TEND, ...pr(runRef, 104, sha(1)),
    trigger: 'check_failed', candidate_id: mint(4201), cause_event_ids: [failed.event_id],
  });
  const decision = qe({
    event_id: mint(4105), event_type: 'recovery_decision', t: 95, actor: TEND, ...pr(runRef, 104, sha(1)),
    policy: { name: 'merge-lane-recovery', version: '1.0.0' },
    context: {
      as_of: at(92), event_ids: [failed.event_id, ejected.event_id], failing_check_keys: ['ci-unit'],
      failure_class: { label: 'test-assertion', labeler_version: 'mq-0.2.0' }, attempt_number: 1,
      base_moved_since_candidate: false, queue_depth: 2,
      provenance: { harness: 'claude-code', executed_model: 'claude-sonnet-5-5', task_type: 'bugfix' },
      flake_history: [{ check_key: 'ci-unit', window_runs: 40, window_failures: 0 }],
    },
    available_actions: ['retry', 'fix', 'escalate'], chosen_action: 'fix', propensity_source: 'deterministic',
    propensities: [
      { action: 'retry', probability: 0 },
      { action: 'fix', probability: 1 },
      { action: 'escalate', probability: 0 },
    ],
  });
  const repair = attempt({ kind: 'stage_attempt', id: mint(4002), parent: run.id, stage: 'repair', t: 100 });
  const repairRef = ref(run.id, repair.id);
  const pushed = qe({
    event_id: mint(4106), event_type: 'repair_commit_pushed', t: 300, actor: agent('claude-sonnet-5-5'),
    ...pr(repairRef, 104, sha(5)), parent_sha: sha(1), commits_pushed: 1, cause_event_ids: [decision.event_id],
    cost_event_ids: ['evt-repair-0001', 'evt-repair-0002'],
  });
  const repairDone = outcome(mint(4301), repairRef, 'succeeded', 301);
  const requeued = qe({
    event_id: mint(4107), event_type: 'enqueued', t: 310, actor: TEND, ...pr(runRef, 104, sha(5)), base_sha: BASE,
  });
  const second = qe({
    event_id: mint(4108), event_type: 'candidate_prepared', t: 320, actor: TEND,
    candidate_id: mint(4202), attempt_refs: [runRef], base_sha: BASE, entries: [{ pr_number: 104, head_sha: sha(5) }],
  });
  const passed = qe({
    event_id: mint(4109), event_type: 'check_run_completed', t: 391, actor: ACTIONS, ...pr(runRef, 104, sha(5)),
    check_run_id: '8002', check_key: 'ci-unit', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
    started_at: at(330), completed_at: at(390),
  });
  const merged = qe({
    event_id: mint(4110), event_type: 'merged', t: 400, actor: TEND,
    ...pr(runRef, 104, sha(5)), merge_commit_sha: sha(6), candidate_id: mint(4202), method: 'squash',
  });
  const settled = outcome(mint(4302), runRef, 'succeeded', 410);
  const stream = [
    run, enqueued, first, failed, ejected, decision, repair, pushed, repairDone, requeued, second, passed, merged, settled,
  ];
  return {
    name: 'real-failure-repair',
    description:
      'A unit check fails for real; the PR is ejected with the failed check as cause. A recovery decision snapshots only what preceded it and chooses fix. A repair stage attempt pushes a commit attributed to the agent with its provider-observed model and the cost events of the repair; the PR re-enters and merges.',
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, first, failed, ejected, decision, pushed, requeued, second, passed, merged),
      candidates: [candidateState(first, [run.id]), candidateState(second, [], [run.id])],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 5. Two-entry cumulative candidate; the predecessor ejects ─────────────
const cumulativePredecessorEjects = (() => {
  const runA = attempt({ kind: 'run', id: mint(5001), parent: TASK, t: 0 });
  const runB = attempt({ kind: 'run', id: mint(5002), parent: OTHER_TASK, task: OTHER_TASK, t: 1 });
  const refA = ref(runA.id);
  const refB = ref(runB.id, undefined, OTHER_TASK);
  const enqA = qe({ event_id: mint(5101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(refA, 105, sha(1)), queue_depth: 0 });
  const enqB = qe({ event_id: mint(5102), event_type: 'enqueued', t: 11, actor: TEND, ...pr(refB, 106, sha(2)), queue_depth: 1 });
  const c1 = mint(5201);
  const cumulative = qe({
    event_id: mint(5103), event_type: 'candidate_prepared', t: 20, actor: GITHUB,
    candidate_id: c1, attempt_refs: [refA, refB], base_sha: BASE,
    entries: [{ pr_number: 105, head_sha: sha(1) }, { pr_number: 106, head_sha: sha(2) }], candidate_sha: sha(3),
  });
  const failed = qe({
    event_id: mint(5104), event_type: 'check_run_completed', t: 91, actor: ACTIONS,
    candidate_id: c1, attempt_refs: [refA, refB], head_sha: sha(3),
    check_run_id: '9001', check_key: 'ci-unit', trigger: 'merge_group', run_attempt: 1, conclusion: 'failure',
    completed_at: at(90),
  });
  const ejectA = qe({
    event_id: mint(5105), event_type: 'ejected', t: 92, actor: GITHUB, ...pr(refA, 105, sha(1)),
    trigger: 'check_failed', candidate_id: c1, cause_event_ids: [failed.event_id],
  });
  const ejectB = qe({
    event_id: mint(5106), event_type: 'ejected', t: 92, actor: GITHUB, ...pr(refB, 106, sha(2)),
    trigger: 'predecessor_ejected', candidate_id: c1, cause_event_ids: [ejectA.event_id],
  });
  const wrongComposition = qe({
    event_id: mint(5107), event_type: 'check_run_completed', t: 95, actor: ACTIONS,
    candidate_id: c1, attempt_refs: [refB], head_sha: sha(3),
    check_run_id: '9002', check_key: 'ci-lint', trigger: 'merge_group', run_attempt: 1, conclusion: 'success',
    completed_at: at(94),
  });
  const c2 = mint(5202);
  const alone = qe({
    event_id: mint(5108), event_type: 'candidate_prepared', t: 100, actor: GITHUB,
    candidate_id: c2, attempt_refs: [refB], base_sha: BASE, entries: [{ pr_number: 106, head_sha: sha(2) }], candidate_sha: sha(4),
  });
  const passed = qe({
    event_id: mint(5109), event_type: 'check_run_completed', t: 171, actor: ACTIONS,
    candidate_id: c2, attempt_refs: [refB], head_sha: sha(4),
    check_run_id: '9003', check_key: 'ci-unit', trigger: 'merge_group', run_attempt: 1, conclusion: 'success',
    completed_at: at(170),
  });
  const staleMerge = qe({
    event_id: mint(5110), event_type: 'merged', t: 175, actor: GITHUB, ...pr(refB, 106, sha(2)),
    merge_commit_sha: sha(3), candidate_id: c1,
  });
  const merged = qe({
    event_id: mint(5111), event_type: 'merged', t: 176, actor: GITHUB, ...pr(refB, 106, sha(2)),
    merge_commit_sha: sha(4), candidate_id: c2,
  });
  const settled = outcome(mint(5301), refB, 'succeeded', 180);
  const stream = [
    runA, runB, enqA, enqB, cumulative, failed, ejectA, ejectB, wrongComposition, alone, passed, staleMerge, merged, settled,
  ];
  return {
    name: 'cumulative-candidate-predecessor-ejects',
    description:
      'Two PRs from two tasks form one cumulative candidate (B is tested on top of A). The candidate check fails; A is ejected for the failure and B because its predecessor was ejected. B lands alone in a new candidate. A check naming a different composition under the old candidate id is rejected, as is a merge claimed under the candidate B was ejected from.',
    stream,
    expected: {
      decisions: decisionsFor(stream, {
        [stream.indexOf(wrongComposition)]: ['rejected', ['candidate_mismatch']],
        [stream.indexOf(staleMerge)]: ['rejected', ['ejected_from_candidate']],
      }),
      accepted_event_ids: eventIds(enqA, enqB, cumulative, failed, ejectA, ejectB, alone, passed, merged),
      candidates: [candidateState(cumulative, [runA.id, runB.id]), candidateState(alone, [], [runB.id])],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 6. Operator manual commit ─────────────────────────────────────────────
const operatorManualCommit = (() => {
  const run = attempt({ kind: 'run', id: mint(6001), parent: TASK, t: 0 });
  const runRef = ref(run.id);
  const enqueued = qe({ event_id: mint(6101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(runRef, 107, sha(1)) });
  const failed = qe({
    event_id: mint(6102), event_type: 'check_run_completed', t: 61, actor: ACTIONS, ...pr(runRef, 107, sha(1)),
    check_run_id: '10001', check_key: 'ci-typecheck', trigger: 'pull_request', run_attempt: 1, conclusion: 'failure',
    completed_at: at(60),
  });
  const dequeued = qe({
    event_id: mint(6103), event_type: 'dequeued', t: 62, actor: TEND, ...pr(runRef, 107, sha(1)), trigger: 'policy',
  });
  const escalate = qe({
    event_id: mint(6104), event_type: 'recovery_decision', t: 65, actor: WATCHDOG, ...pr(runRef, 107, sha(1)),
    policy: { name: 'ready-watchdog', version: '3.2.0' },
    context: { as_of: at(62), event_ids: [failed.event_id, dequeued.event_id], failing_check_keys: ['ci-typecheck'], attempt_number: 3 },
    available_actions: ['retry', 'fix', 'escalate'], chosen_action: 'escalate', propensity_source: 'deterministic',
    propensities: [
      { action: 'retry', probability: 0 },
      { action: 'fix', probability: 0 },
      { action: 'escalate', probability: 1 },
    ],
  });
  const manual = qe({
    event_id: mint(6105), event_type: 'repair_commit_pushed', t: 900, actor: OPERATOR,
    ...pr(runRef, 107, sha(7)), parent_sha: sha(1), commits_pushed: 2, cause_event_ids: [escalate.event_id],
  });
  const requeued = qe({ event_id: mint(6106), event_type: 'enqueued', t: 910, actor: OPERATOR, ...pr(runRef, 107, sha(7)) });
  const passed = qe({
    event_id: mint(6107), event_type: 'check_run_completed', t: 961, actor: ACTIONS, ...pr(runRef, 107, sha(7)),
    check_run_id: '10002', check_key: 'ci-typecheck', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
    completed_at: at(960),
  });
  const merged = qe({
    event_id: mint(6108), event_type: 'merged', t: 970, actor: TEND, ...pr(runRef, 107, sha(7)), merge_commit_sha: sha(8),
  });
  const settled = outcome(mint(6301), runRef, 'succeeded', 980);
  const stream = [run, enqueued, failed, dequeued, escalate, manual, requeued, passed, merged, settled];
  return {
    name: 'operator-manual-commit',
    description:
      'The watchdog escalates after a third failure. A human pushes the fix: the repair commit is attributed to the operator (no model, no stage attempt), so the agent is never credited with it. The PR then lands without a merge candidate.',
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, failed, dequeued, escalate, manual, requeued, passed, merged),
      candidates: [],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 7. Crash / resume: duplicate events, stale writes after relaunch ──────
const crashResumeDuplicate = (() => {
  const run1 = attempt({ kind: 'run', id: mint(7001), parent: TASK, t: 0 });
  const ref1 = ref(run1.id);
  const enqueued = qe({
    event_id: mint(7101), event_type: 'enqueued', t: 10, actor: TEND, ...pr(ref1, 108, sha(1)), queue_depth: 1,
  });
  const candidate = qe({
    event_id: mint(7102), event_type: 'candidate_prepared', t: 20, actor: TEND,
    candidate_id: mint(7201), attempt_refs: [ref1], base_sha: BASE, entries: [{ pr_number: 108, head_sha: sha(1) }],
  });
  const check = qe({
    event_id: mint(7103), event_type: 'check_run_completed', t: 81, actor: ACTIONS, ...pr(ref1, 108, sha(1)),
    check_run_id: '11001', check_key: 'ci-test', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
    completed_at: at(80),
  });
  // The writer crashes and resumes, re-emitting what it already wrote.
  const replayEnqueued = { ...enqueued };
  const replayCandidate = JSON.parse(JSON.stringify(candidate)) as QueueLifecycleEventV1;
  const reorderedCheck = Object.fromEntries(Object.entries(check).reverse()) as QueueLifecycleEventV1;
  // A bug reuses an event id for a different fact: it must not overwrite.
  const conflicting = qe({
    event_id: mint(7101), event_type: 'enqueued', t: 85, actor: TEND, ...pr(ref1, 108, sha(1)), queue_depth: 0,
  });
  // The task is relaunched: run 2 is now current.
  const run2 = attempt({ kind: 'run', id: mint(7002), parent: TASK, t: 100 });
  const ref2 = ref(run2.id);
  const staleMerge = qe({
    event_id: mint(7104), event_type: 'merged', t: 110, actor: TEND, ...pr(ref1, 108, sha(1)), merge_commit_sha: sha(2),
  });
  const lateCheck = qe({
    event_id: mint(7105), event_type: 'check_run_completed', t: 111, actor: ACTIONS, ...pr(ref1, 108, sha(1)),
    check_run_id: '11002', check_key: 'ci-lint', trigger: 'pull_request', run_attempt: 1, conclusion: 'success',
    completed_at: at(79),
  });
  const enqueued2 = qe({ event_id: mint(7106), event_type: 'enqueued', t: 200, actor: TEND, ...pr(ref2, 108, sha(9)) });
  const merged2 = qe({
    event_id: mint(7107), event_type: 'merged', t: 260, actor: TEND, ...pr(ref2, 108, sha(9)), merge_commit_sha: sha(10),
  });
  const settled = outcome(mint(7301), ref2, 'succeeded', 270);
  const lateDequeue = qe({
    event_id: mint(7108), event_type: 'dequeued', t: 280, actor: TEND, ...pr(ref2, 108, sha(9)), trigger: 'pr_closed',
  });
  const stream = [
    run1, enqueued, candidate, check, replayEnqueued, replayCandidate, reorderedCheck, conflicting,
    run2, staleMerge, lateCheck, enqueued2, merged2, settled, lateDequeue,
  ];
  return {
    name: 'crash-resume-duplicate',
    description:
      'After a crash the writer re-emits three events (one with reordered keys): each is a duplicate by event_id and changes nothing. A different fact under a reused event_id is rejected, never overwriting. After a relaunch, a control write from the old run is stale while its late check-run evidence is kept; once run 2 settles, a late dequeue is rejected.',
    stream,
    expected: {
      decisions: decisionsFor(stream, {
        [stream.indexOf(replayEnqueued)]: ['duplicate'],
        [stream.indexOf(replayCandidate)]: ['duplicate'],
        [stream.indexOf(reorderedCheck)]: ['duplicate'],
        [stream.indexOf(conflicting)]: ['rejected', ['event_id_conflict']],
        [stream.indexOf(staleMerge)]: ['rejected', ['stale_run']],
        [stream.indexOf(lateDequeue)]: ['rejected', ['settled']],
      }),
      accepted_event_ids: eventIds(enqueued, candidate, check, lateCheck, enqueued2, merged2),
      candidates: [candidateState(candidate)],
    },
  } satisfies QueueLifecycleFixture;
})();

// ── 8. Multi-round review loop with re-flags on pre-existing code ─────────
const multiRoundReview = (() => {
  const run = attempt({ kind: 'run', id: mint(8001), parent: TASK, t: 0 });
  const runRef = ref(run.id);
  const reviewFlow = { kind: 'monitor', component: 'review-flow' } as const;
  const r1Correctness = attempt({ kind: 'stage_attempt', id: mint(8002), parent: run.id, stage: 'review', t: 10 });
  const r1Security = attempt({ kind: 'stage_attempt', id: mint(8003), parent: run.id, stage: 'security-review', t: 10 });
  const started1 = qe({
    event_id: mint(8101), event_type: 'review_round_started', t: 11, actor: reviewFlow, ...pr(runRef, 109, sha(1)),
    round: 1,
    reviewers: [
      { reviewer_key: 'correctness', stage: 'review', stage_attempt_id: r1Correctness.id, harness: 'codex', intended_model: 'gpt-5.5' },
      {
        reviewer_key: 'security', stage: 'security-review', stage_attempt_id: r1Security.id, harness: 'claude-code',
        intended_model: 'claude-opus-5-5', challenge: true,
      },
    ],
    selection: { policy: { name: 'review-intensity', version: '0.3.0' }, propensity_source: 'exact', propensity: 0.25 },
  });
  const f1 = mint(8401);
  const f2 = mint(8402);
  const completed1 = qe({
    event_id: mint(8102), event_type: 'review_round_completed', t: 200, actor: reviewFlow, ...pr(runRef, 109, sha(1)),
    round: 1, first_round_head_sha: sha(1),
    reviewers: [
      {
        reviewer_key: 'correctness', stage: 'review', stage_attempt_id: r1Correctness.id, harness: 'codex',
        intended_model: 'gpt-5.5', executed_model_evidence: 'provider_response', executed_model: 'gpt-5.5-2026-08-01',
      },
      {
        reviewer_key: 'security', stage: 'security-review', stage_attempt_id: r1Security.id, harness: 'claude-code',
        intended_model: 'claude-opus-5-5', executed_model_evidence: 'not_observed',
      },
    ],
    findings: [
      { finding_id: f1, reviewer_key: 'correctness', blocking: true, location: 'first_round' },
      { finding_id: f2, reviewer_key: 'security', blocking: false, location: 'first_round' },
    ],
  });
  const fix1 = qe({
    event_id: mint(8103), event_type: 'repair_commit_pushed', t: 400, actor: agent('claude-sonnet-5-5'),
    ...pr(runRef, 109, sha(11)), parent_sha: sha(1), cause_event_ids: [completed1.event_id],
  });
  const r2Correctness = attempt({ kind: 'stage_attempt', id: mint(8004), parent: run.id, stage: 'review', t: 410 });
  const started2 = qe({
    event_id: mint(8104), event_type: 'review_round_started', t: 411, actor: reviewFlow, ...pr(runRef, 109, sha(11)),
    round: 2,
    reviewers: [{ reviewer_key: 'correctness', stage: 'review', stage_attempt_id: r2Correctness.id, harness: 'codex', intended_model: 'gpt-5.5' }],
    selection: { policy: { name: 'review-intensity', version: '0.3.0' }, propensity_source: 'deterministic', propensity: 1 },
  });
  const completed2 = qe({
    event_id: mint(8105), event_type: 'review_round_completed', t: 600, actor: reviewFlow, ...pr(runRef, 109, sha(11)),
    round: 2, first_round_head_sha: sha(1),
    reviewers: [
      {
        reviewer_key: 'correctness', stage: 'review', stage_attempt_id: r2Correctness.id, harness: 'codex',
        intended_model: 'gpt-5.5', executed_model_evidence: 'provider_response', executed_model: 'gpt-5.5-2026-08-01',
      },
    ],
    findings: [
      { finding_id: mint(8403), reviewer_key: 'correctness', blocking: true, location: 'unchanged_since_first_round', reflag_of: f2 },
      { finding_id: mint(8404), reviewer_key: 'correctness', blocking: false, location: 'unchanged_since_first_round' },
      { finding_id: mint(8405), reviewer_key: 'correctness', blocking: true, location: 'changed_since_first_round' },
    ],
  });
  const fix2 = qe({
    event_id: mint(8106), event_type: 'repair_commit_pushed', t: 800, actor: agent('claude-sonnet-5-5'),
    ...pr(runRef, 109, sha(12)), parent_sha: sha(11), cause_event_ids: [completed2.event_id],
  });
  const r3Correctness = attempt({ kind: 'stage_attempt', id: mint(8005), parent: run.id, stage: 'review', t: 810 });
  const started3 = qe({
    event_id: mint(8107), event_type: 'review_round_started', t: 811, actor: reviewFlow, ...pr(runRef, 109, sha(12)),
    round: 3,
    reviewers: [{ reviewer_key: 'correctness', stage: 'review', stage_attempt_id: r3Correctness.id, harness: 'codex', intended_model: 'gpt-5.5' }],
  });
  const completed3 = qe({
    event_id: mint(8108), event_type: 'review_round_completed', t: 950, actor: reviewFlow, ...pr(runRef, 109, sha(12)),
    round: 3, first_round_head_sha: sha(1),
    reviewers: [
      {
        reviewer_key: 'correctness', stage: 'review', stage_attempt_id: r3Correctness.id, harness: 'codex',
        intended_model: 'gpt-5.5', executed_model_evidence: 'provider_response', executed_model: 'gpt-5.5-2026-08-01',
      },
    ],
    findings: [],
  });
  const stream = [
    run, r1Correctness, r1Security, started1, completed1, fix1, r2Correctness, started2, completed2,
    fix2, r3Correctness, started3, completed3,
  ];
  return {
    name: 'multi-round-review',
    description:
      'Three review rounds. Round 1 runs two reviewers chosen with an exact propensity; the challenge reviewer has no observed model, so none is recorded. Round 2 re-flags a round-1 finding and raises a new one on code round 1 already saw (unchanged_since_first_round), plus one on changed lines. Round 3 is an observed clean round (findings: []).',
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(started1, completed1, fix1, started2, completed2, fix2, started3, completed3),
      candidates: [],
    },
  } satisfies QueueLifecycleFixture;
})();

export const cleanMergeQueueFixture: QueueLifecycleFixture = cleanMerge;
export const flakeRerunQueueFixture: QueueLifecycleFixture = flakeRerun;
export const baseDriftRebaseQueueFixture: QueueLifecycleFixture = baseDriftRebase;
export const realFailureRepairQueueFixture: QueueLifecycleFixture = realFailureRepair;
export const cumulativeCandidatePredecessorEjectsQueueFixture: QueueLifecycleFixture = cumulativePredecessorEjects;
export const operatorManualCommitQueueFixture: QueueLifecycleFixture = operatorManualCommit;
export const crashResumeDuplicateQueueFixture: QueueLifecycleFixture = crashResumeDuplicate;
export const multiRoundReviewQueueFixture: QueueLifecycleFixture = multiRoundReview;

export const queueLifecycleFixtures: readonly QueueLifecycleFixture[] = [
  cleanMergeQueueFixture,
  flakeRerunQueueFixture,
  baseDriftRebaseQueueFixture,
  realFailureRepairQueueFixture,
  cumulativeCandidatePredecessorEjectsQueueFixture,
  operatorManualCommitQueueFixture,
  crashResumeDuplicateQueueFixture,
  multiRoundReviewQueueFixture,
];
