/**
 * Golden fixtures for `task_attempt/v1` (HOK-3372). Each one is an ordered log
 * plus the hand-written result of `reduceTaskAttemptLog`. Changing an expected
 * result is a contract change. Ids are synthetic UUIDv7-shaped values.
 */

import {
  BASE,
  HEAD,
  OTHER_TASK,
  TASK,
  attempt,
  control,
  decision,
  derivedResult,
  evidence,
  mint,
  outcome,
  ref,
  state,
  type TaskAttemptFixture,
} from './builders.js';

// ── 1. A stage retry (`retry_of`) vs. a stage attempt within a run (`parent_id`)
const stageRetry = (() => {
  const run = attempt({ kind: 'run', id: mint(1), parent: TASK, t: 0 });
  const plan1 = attempt({ kind: 'stage_attempt', id: mint(2), parent: run.id, stage: 'planning', t: 1 });
  const plan1Failed = outcome(mint(101), ref(run.id, plan1.id), 'failed', 2);
  const plan2 = attempt({
    kind: 'stage_attempt',
    id: mint(3),
    parent: run.id,
    stage: 'planning',
    retryOf: plan1.id,
    t: 3,
  });
  const impl = attempt({ kind: 'stage_attempt', id: mint(4), parent: run.id, stage: 'implementation', t: 4 });
  const crossStageRetry = attempt({
    kind: 'stage_attempt',
    id: mint(5),
    parent: run.id,
    stage: 'implementation',
    retryOf: plan1.id,
    t: 5,
  });
  const plan2Done = outcome(mint(102), ref(run.id, plan2.id), 'succeeded', 6);
  const lateFirstPlan = outcome(mint(103), ref(run.id, plan1.id), 'succeeded', 7);
  const log = [run, plan1, plan1Failed, plan2, impl, crossStageRetry, plan2Done, lateFirstPlan];

  return {
    name: 'stage-retry-vs-child',
    description:
      'Planning fails and is retried (retry_of): the retry supersedes it. Implementation is a child of the run (parent_id), not a retry. A retry across stages is rejected, and a late completion of the superseded planning attempt cannot settle it.',
    log,
    expected: {
      decisions: [
        decision(0, run, 'accepted'),
        decision(1, plan1, 'accepted'),
        decision(2, plan1Failed, 'accepted'),
        decision(3, plan2, 'accepted'),
        decision(4, impl, 'accepted'),
        decision(5, crossStageRetry, 'rejected', ['retry_target_invalid']),
        decision(6, plan2Done, 'accepted'),
        decision(7, lateFirstPlan, 'rejected', ['stale_stage_attempt']),
      ],
      attempts: [
        state(run, { current: true }),
        state(plan1, { current: false, superseded_by: plan2.id, outcome: 'failed' }),
        state(plan2, { current: true, outcome: 'succeeded' }),
        state(impl, { current: true }),
      ],
      evidence: [],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 2. A relaunch of a settled task is a new run
const relaunchSettled = (() => {
  const run1 = attempt({ kind: 'run', id: mint(11), parent: TASK, t: 0, code: { head_sha: HEAD, base_sha: BASE } });
  const run1Done = outcome(mint(111), ref(run1.id), 'succeeded', 1);
  const reuse = attempt({ kind: 'run', id: run1.id, parent: TASK, t: 2 });
  const retryOfSucceeded = attempt({ kind: 'run', id: mint(12), parent: TASK, retryOf: run1.id, t: 3 });
  const run2 = attempt({ kind: 'run', id: mint(13), parent: TASK, t: 4 });
  const run2Phase = control(mint(112), ref(run2.id), 'phase', 'planning', 5);
  const log = [run1, run1Done, reuse, retryOfSucceeded, run2, run2Phase];

  return {
    name: 'relaunch-settled-task',
    description:
      'A settled task is relaunched. The launch cannot reuse the settled run id, and cannot claim to retry a run that succeeded; it is a new run that supersedes the old one, and inherits none of its state.',
    log,
    expected: {
      decisions: [
        decision(0, run1, 'accepted'),
        decision(1, run1Done, 'accepted'),
        decision(2, reuse, 'rejected', ['id_reused']),
        decision(3, retryOfSucceeded, 'rejected', ['retry_of_succeeded']),
        decision(4, run2, 'accepted'),
        decision(5, run2Phase, 'accepted'),
      ],
      attempts: [
        state(run1, { current: false, superseded_by: run2.id, outcome: 'succeeded' }),
        state(run2, { current: true }),
      ],
      evidence: [],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 3. Stale control rejected, stale evidence accepted against its own run
const staleAfterRelaunch = (() => {
  const run1 = attempt({ kind: 'run', id: mint(21), parent: TASK, t: 0 });
  const impl1 = attempt({ kind: 'stage_attempt', id: mint(22), parent: run1.id, stage: 'implementation', t: 1 });
  const run2 = attempt({ kind: 'run', id: mint(23), parent: TASK, retryOf: run1.id, t: 10 });
  const impl2 = attempt({ kind: 'stage_attempt', id: mint(24), parent: run2.id, stage: 'implementation', t: 11 });
  const staleCompletion = outcome(mint(121), ref(run1.id, impl1.id), 'succeeded', 12);
  const staleAbort = outcome(mint(122), ref(run1.id), 'aborted', 13);
  const staleCost = evidence(mint(123), ref(run1.id, impl1.id), 'cost', 1, 14, {
    cost_event_ids: ['event-0001', 'event-0002'],
  });
  const currentCost = evidence(mint(124), ref(run2.id, impl2.id), 'cost', 1, 15, {
    cost_event_ids: ['event-0003'],
  });
  const impl2Done = outcome(mint(125), ref(run2.id, impl2.id), 'succeeded', 16);
  const log = [run1, impl1, run2, impl2, staleCompletion, staleAbort, staleCost, currentCost, impl2Done];

  return {
    name: 'stale-control-and-evidence-after-relaunch',
    description:
      'Run 1 is abandoned and relaunched as run 2. A completion and an abort from run 1 arrive late: both are control writes for a run that is not current and are rejected, so they cannot settle or abort run 2. A late cost report for run 1 is evidence: accepted, attributed to run 1, not run 2.',
    log,
    expected: {
      decisions: [
        decision(0, run1, 'accepted'),
        decision(1, impl1, 'accepted'),
        decision(2, run2, 'accepted'),
        decision(3, impl2, 'accepted'),
        decision(4, staleCompletion, 'rejected', ['stale_run']),
        decision(5, staleAbort, 'rejected', ['stale_run']),
        decision(6, staleCost, 'accepted'),
        decision(7, currentCost, 'accepted'),
        decision(8, impl2Done, 'accepted'),
      ],
      attempts: [
        state(run1, { current: false, superseded_by: run2.id }),
        // Latest in its stage group, but its run is not current.
        state(impl1, { current: false }),
        state(run2, { current: true }),
        state(impl2, { current: true, outcome: 'succeeded' }),
      ],
      evidence: [
        { attempt_id: impl1.id, evidence_kind: 'cost', latest_version: 1, write_ids: [staleCost.write_id] },
        { attempt_id: impl2.id, evidence_kind: 'cost', latest_version: 1, write_ids: [currentCost.write_id] },
      ],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 4. A Codex pending session resolved after settlement
const pendingSessionResolved = (() => {
  const pending = { harness: 'codex', session_id: 'pending:7f3a9c21' };
  const resolved = {
    harness: 'codex',
    session_id: '019a3c11-2222-7333-8444-555566667777',
    resolves: 'pending:7f3a9c21',
  };
  const run = attempt({ kind: 'run', id: mint(31), parent: TASK, t: 0 });
  const review = attempt({
    kind: 'stage_attempt',
    id: mint(32),
    parent: run.id,
    stage: 'review',
    t: 1,
    sessions: [pending],
  });
  const firstSessions = evidence(mint(131), ref(run.id, review.id), 'session_resolution', 1, 2, {
    session_refs: [pending],
  });
  const reviewDone = outcome(mint(132), ref(run.id, review.id), 'succeeded', 3);
  const runDone = outcome(mint(133), ref(run.id), 'succeeded', 4);
  const resolution = evidence(mint(134), ref(run.id, review.id), 'session_resolution', 2, 60, {
    session_refs: [resolved],
  });
  const lateModel = evidence(mint(135), ref(run.id, review.id), 'executed_model', 1, 61, {
    executed_model: 'gpt-5.5-codex',
  });
  const latePhase = control(mint(136), ref(run.id, review.id), 'phase', 'review', 62);
  const replayedResolution = { ...resolution };
  const log = [run, review, firstSessions, reviewDone, runDone, resolution, lateModel, latePhase, replayedResolution];

  return {
    name: 'codex-pending-session-resolved',
    description:
      'A review stage launches a Codex session known only as pending:<nonce>. The run settles. The session resolves a minute later: the resolution is evidence for the same stage_attempt_id at evidence_version 2, adds a session ref, and changes no ID or outcome. A control write after settlement is rejected; a replayed write is a duplicate.',
    log,
    expected: {
      decisions: [
        decision(0, run, 'accepted'),
        decision(1, review, 'accepted'),
        decision(2, firstSessions, 'accepted'),
        decision(3, reviewDone, 'accepted'),
        decision(4, runDone, 'accepted'),
        decision(5, resolution, 'accepted'),
        decision(6, lateModel, 'accepted'),
        decision(7, latePhase, 'rejected', ['settled']),
        decision(8, replayedResolution, 'duplicate'),
      ],
      attempts: [
        state(run, { current: true, outcome: 'succeeded' }),
        state(review, { current: true, outcome: 'succeeded', session_refs: [pending, resolved] }),
      ],
      evidence: [
        {
          attempt_id: review.id,
          evidence_kind: 'session_resolution',
          latest_version: 2,
          write_ids: [firstSessions.write_id, resolution.write_id],
        },
        { attempt_id: review.id, evidence_kind: 'executed_model', latest_version: 1, write_ids: [lateModel.write_id] },
      ],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 5. Two launches of the same stage in the same second
const sameSecondLaunches = (() => {
  // Wavemill's derived label for both launches: identical, so it is never a key.
  const legacy = 'planning@a1b2c3d#1793396483';
  const run = attempt({ kind: 'run', id: mint(41), parent: TASK, t: 0 });
  const first = attempt({
    kind: 'stage_attempt',
    id: mint(42),
    parent: run.id,
    stage: 'planning',
    t: 5,
    legacy: [legacy],
  });
  const second = attempt({
    kind: 'stage_attempt',
    id: mint(43),
    parent: run.id,
    stage: 'planning',
    t: 5,
    legacy: [legacy],
  });
  const firstDone = outcome(mint(141), ref(run.id, first.id), 'succeeded', 6);
  const firstCost = evidence(mint(142), ref(run.id, first.id), 'cost', 1, 6);
  const secondDone = outcome(mint(143), ref(run.id, second.id), 'succeeded', 7);
  const log = [run, first, second, firstDone, firstCost, secondDone];

  return {
    name: 'same-second-launches',
    description:
      'Two planning launches in the same second share Wavemill\'s derived label (kind@head7#epoch-seconds) but get distinct minted stage_attempt_ids. The later launch is current; the earlier one keeps its own evidence and cannot settle the stage.',
    log,
    expected: {
      decisions: [
        decision(0, run, 'accepted'),
        decision(1, first, 'accepted'),
        decision(2, second, 'accepted'),
        decision(3, firstDone, 'rejected', ['stale_stage_attempt']),
        decision(4, firstCost, 'accepted'),
        decision(5, secondDone, 'accepted'),
      ],
      attempts: [
        state(run, { current: true }),
        state(first, { current: false, superseded_by: second.id }),
        state(second, { current: true, outcome: 'succeeded' }),
      ],
      evidence: [{ attempt_id: first.id, evidence_kind: 'cost', latest_version: 1, write_ids: [firstCost.write_id] }],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 6. A challenge pair: two arms, one pair
const challengePair = (() => {
  const pair = attempt({ kind: 'pair', id: mint(51), parent: TASK, t: 0 });
  const primary = attempt({ kind: 'arm', id: mint(52), parent: pair.id, role: 'primary', t: 1 });
  const challenger = attempt({ kind: 'arm', id: mint(53), parent: pair.id, role: 'challenger', t: 1 });
  const primaryRun = attempt({ kind: 'run', id: mint(54), parent: primary.id, t: 2 });
  const challengerRun = attempt({ kind: 'run', id: mint(55), parent: challenger.id, t: 2 });
  const challengerAborted = outcome(mint(151), ref(challengerRun.id), 'aborted', 30);
  const challengerRelaunch = attempt({
    kind: 'run',
    id: mint(56),
    parent: challenger.id,
    retryOf: challengerRun.id,
    t: 40,
  });
  const relaunchPhase = control(mint(152), ref(challengerRelaunch.id), 'phase', 'planning', 41);
  const lateAbort = outcome(mint(153), ref(challengerRun.id), 'aborted', 42);
  const primaryDone = outcome(mint(154), ref(primaryRun.id), 'succeeded', 50);
  const challengerDone = outcome(mint(155), ref(challengerRelaunch.id), 'succeeded', 60);
  const log = [
    pair,
    primary,
    challenger,
    primaryRun,
    challengerRun,
    challengerAborted,
    challengerRelaunch,
    relaunchPhase,
    lateAbort,
    primaryDone,
    challengerDone,
  ];

  return {
    name: 'challenge-pair',
    description:
      'One pair, a primary and a challenger arm, each with its own run. Both runs are current at once. The challenger is aborted and relaunched as a new run under the same arm (retry_of): it does not inherit the abort, a late repeat of the abort cannot reach it, and the primary is unaffected.',
    log,
    expected: {
      decisions: [
        decision(0, pair, 'accepted'),
        decision(1, primary, 'accepted'),
        decision(2, challenger, 'accepted'),
        decision(3, primaryRun, 'accepted'),
        decision(4, challengerRun, 'accepted'),
        decision(5, challengerAborted, 'accepted'),
        decision(6, challengerRelaunch, 'accepted'),
        decision(7, relaunchPhase, 'accepted'),
        decision(8, lateAbort, 'rejected', ['stale_run']),
        decision(9, primaryDone, 'accepted'),
        decision(10, challengerDone, 'accepted'),
      ],
      attempts: [
        state(pair, { current: true }),
        state(primary, { current: true }),
        state(challenger, { current: true }),
        state(primaryRun, { current: true, outcome: 'succeeded' }),
        state(challengerRun, { current: false, superseded_by: challengerRelaunch.id, outcome: 'aborted' }),
        state(challengerRelaunch, { current: true, outcome: 'succeeded' }),
      ],
      evidence: [],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 7. A comparison recomputed after an evidence-version change
const comparisonRecomputed = (() => {
  const pair = attempt({ kind: 'pair', id: mint(61), parent: TASK, t: 0 });
  const primary = attempt({ kind: 'arm', id: mint(62), parent: pair.id, role: 'primary', t: 0 });
  const challenger = attempt({ kind: 'arm', id: mint(63), parent: pair.id, role: 'challenger', t: 0 });
  const primaryRun = attempt({ kind: 'run', id: mint(64), parent: primary.id, t: 1 });
  const challengerRun = attempt({ kind: 'run', id: mint(65), parent: challenger.id, t: 1 });
  const primaryDone = outcome(mint(161), ref(primaryRun.id), 'succeeded', 10);
  const challengerDone = outcome(mint(162), ref(challengerRun.id), 'succeeded', 11);
  const primaryCost = evidence(mint(163), ref(primaryRun.id), 'cost', 1, 12, { cost_event_ids: ['event-0101'] });
  // Incomplete: the challenger's native-arm usage has not been collected yet.
  const challengerCost1 = evidence(mint(164), ref(challengerRun.id), 'cost', 1, 12, {
    cost_event_ids: ['event-0201'],
  });
  const comparison1 = derivedResult(
    mint(165),
    [
      { attempt: ref(primaryRun.id), evidence_kind: 'cost', evidence_version: 1 },
      { attempt: ref(challengerRun.id), evidence_kind: 'cost', evidence_version: 1 },
    ],
    13,
  );
  const challengerCost2 = evidence(mint(166), ref(challengerRun.id), 'cost', 2, 120, {
    cost_event_ids: ['event-0201', 'event-0202'],
  });
  const comparison2 = derivedResult(
    mint(167),
    [
      { attempt: ref(primaryRun.id), evidence_kind: 'cost', evidence_version: 1 },
      { attempt: ref(challengerRun.id), evidence_kind: 'cost', evidence_version: 2 },
    ],
    121,
    comparison1.derived_id,
  );
  const log = [
    pair,
    primary,
    challenger,
    primaryRun,
    challengerRun,
    primaryDone,
    challengerDone,
    primaryCost,
    challengerCost1,
    comparison1,
    challengerCost2,
    comparison2,
  ];

  return {
    name: 'comparison-recomputed',
    description:
      'A challenge comparison is computed from incomplete challenger cost (evidence_version 1). Corrected cost arrives as version 2 after both runs settled: the outcomes do not change, the comparison becomes stale, and a recomputed comparison supersedes it.',
    log,
    prefixExpectations: [
      {
        length: 10,
        derived: [{ derived_id: comparison1.derived_id, derived_kind: 'challenge_comparison', status: 'current' }],
      },
      {
        length: 11,
        derived: [
          {
            derived_id: comparison1.derived_id,
            derived_kind: 'challenge_comparison',
            status: 'stale',
            stale_inputs: [{ attempt: ref(challengerRun.id), evidence_kind: 'cost', evidence_version: 1 }],
          },
        ],
      },
    ],
    expected: {
      decisions: log.map((entry, index) => decision(index, entry, 'accepted')),
      attempts: [
        state(pair, { current: true }),
        state(primary, { current: true }),
        state(challenger, { current: true }),
        state(primaryRun, { current: true, outcome: 'succeeded' }),
        state(challengerRun, { current: true, outcome: 'succeeded' }),
      ],
      evidence: [
        { attempt_id: primaryRun.id, evidence_kind: 'cost', latest_version: 1, write_ids: [primaryCost.write_id] },
        {
          attempt_id: challengerRun.id,
          evidence_kind: 'cost',
          latest_version: 2,
          write_ids: [challengerCost1.write_id, challengerCost2.write_id],
        },
      ],
      derived: [
        {
          derived_id: comparison1.derived_id,
          derived_kind: 'challenge_comparison',
          status: 'superseded',
          superseded_by: comparison2.derived_id,
        },
        { derived_id: comparison2.derived_id, derived_kind: 'challenge_comparison', status: 'current' },
      ],
    },
  } satisfies TaskAttemptFixture;
})();

// ── 8. A two-PR merge candidate references two runs
const twoPrMergeCandidate = (() => {
  const runA = attempt({ kind: 'run', id: mint(71), parent: TASK, t: 0 });
  const runB = attempt({ kind: 'run', id: mint(72), parent: OTHER_TASK, task: OTHER_TASK, t: 0 });
  const runADone = outcome(mint(171), ref(runA.id), 'succeeded', 10);
  const runBDone = outcome(mint(172), ref(runB.id, undefined, OTHER_TASK), 'succeeded', 11);
  const checkA = evidence(mint(173), ref(runA.id), 'check_run', 1, 20);
  const checkB = evidence(mint(174), ref(runB.id, undefined, OTHER_TASK), 'check_run', 1, 20);
  const wrongTask = evidence(mint(175), ref(runB.id), 'check_run', 2, 21);
  const log = [runA, runB, runADone, runBDone, checkA, checkB, wrongTask];

  return {
    name: 'two-pr-merge-candidate',
    description:
      'A merge-queue candidate spans two PRs from two tasks. The candidate references both runs (attempt_refs); it is not itself a run or attempt. Check-run evidence lands on each run. A ref naming a run under the wrong task is rejected as a mismatch.',
    log,
    extensionRecords: [
      {
        event_id: mint(176),
        candidate_id: mint(177),
        attempt_refs: [ref(runA.id), ref(runB.id, undefined, OTHER_TASK)],
      },
    ],
    expected: {
      decisions: [
        decision(0, runA, 'accepted'),
        decision(1, runB, 'accepted'),
        decision(2, runADone, 'accepted'),
        decision(3, runBDone, 'accepted'),
        decision(4, checkA, 'accepted'),
        decision(5, checkB, 'accepted'),
        decision(6, wrongTask, 'rejected', ['ref_mismatch']),
      ],
      attempts: [
        state(runA, { current: true, outcome: 'succeeded' }),
        state(runB, { current: true, outcome: 'succeeded' }),
      ],
      evidence: [
        { attempt_id: runA.id, evidence_kind: 'check_run', latest_version: 1, write_ids: [checkA.write_id] },
        { attempt_id: runB.id, evidence_kind: 'check_run', latest_version: 1, write_ids: [checkB.write_id] },
      ],
      derived: [],
    },
  } satisfies TaskAttemptFixture;
})();

export const stageRetryVsChildFixture: TaskAttemptFixture = stageRetry;
export const relaunchSettledTaskFixture: TaskAttemptFixture = relaunchSettled;
export const staleControlAndEvidenceAfterRelaunchFixture: TaskAttemptFixture = staleAfterRelaunch;
export const codexPendingSessionResolvedFixture: TaskAttemptFixture = pendingSessionResolved;
export const sameSecondLaunchesFixture: TaskAttemptFixture = sameSecondLaunches;
export const challengePairFixture: TaskAttemptFixture = challengePair;
export const comparisonRecomputedFixture: TaskAttemptFixture = comparisonRecomputed;
export const twoPrMergeCandidateFixture: TaskAttemptFixture = twoPrMergeCandidate;

export const taskAttemptFixtures: readonly TaskAttemptFixture[] = [
  stageRetryVsChildFixture,
  relaunchSettledTaskFixture,
  staleControlAndEvidenceAfterRelaunchFixture,
  codexPendingSessionResolvedFixture,
  sameSecondLaunchesFixture,
  challengePairFixture,
  comparisonRecomputedFixture,
  twoPrMergeCandidateFixture,
];
