# Queue, CI and repair lifecycle events (`queue_lifecycle_event/v1`)

Part of the task-cost contract from **1.2.0** (HOK-3338, MQ-1.2). Integration
and repair work are cost events for a task, so they extend the contract Model
Match already consumes instead of starting a parallel schema. They share its
identity (`task_attempt/v1`), its missing-vs-zero rules, its privacy denylist
and its compatibility rules, and repair cost links back to `TaskCostEventV1`.
This is a format and its rules, not a store. The first producer is Tend's
merge lane (MQ-1.3).

| Artifact | Where |
| --- | --- |
| Version | `QUEUE_LIFECYCLE_EVENT_SCHEMA_VERSION = "queue_lifecycle_event/v1"` |
| JSON schema | [`packages/core/schemas/queue-lifecycle-event.v1.schema.json`](../../schemas/queue-lifecycle-event.v1.schema.json) (mirrored as `QUEUE_LIFECYCLE_EVENT_V1_JSON_SCHEMA`) |
| Types | `QueueLifecycleEventV1` (a union of 13 event interfaces), `QueueLifecycleActor`, `QueueRecoveryContext`, … |
| Validator | `validateQueueLifecycleEventV1`, `isQueueLifecycleEventV1` |
| Reference reducer | `reduceQueueLifecycleLog(stream)` |
| Helpers | `queueLifecycleEventAttemptRefs`, `queueLifecycleEventScope`, `queueCandidateCodeIdentity` |
| Golden fixtures | `queueLifecycleFixtures` ([`../fixtures/task-cost/queue/`](../fixtures/task-cost/queue/fixtures.ts)) |

## Design rules

1. **An append-only event log, separate from current state.**
   `workflow-state.json` says what is true now; these events say what
   happened. Nothing edits an event. Current state (queue position, labels,
   lane progress) is a projection of events and is never written back as one.
2. **Stable identities on every event.** Each event has a minted `event_id`,
   the attempt it is about (`attempt`: a `TaskAttemptRef`), the `pr_number`
   and `head_sha`, or, for a merge candidate, a minted `candidate_id` and one
   ref per run (`attempt_refs`). Events never use branch names or "latest
   run". The schema has no run or attempt id of its own (see
   [Identity](#identity)).
3. **Facts, not interpretations.** The schema stores check-run conclusions and
   attempt numbers, SHAs, actors, and enqueue, eject and merge timestamps.
   **It stores no durations, failure classes, counts, time-to-land or
   "ready" verdicts.** Versioned functions derive those from the events
   (MQ-1.4 for durations and time-to-land, MQ-0.2 for failure classes).
   `ejected.trigger` is what the queue reported, not a failure class.
4. **Intended and observed are separate fields.** `intended_model` and
   `executed_model` never share a field. `executed_model` requires
   `executed_model_evidence` of `provider_response` or `harness_session`. With
   `not_observed`, no executed model is recorded, and the intended model is
   never put in its place (the HOK-2917 / HOK-3017 class). The validator and
   the JSON schema both reject an executed model without evidence. A review
   round's *configuration* (`review_round_started.reviewers`) is intent and
   may not name an executed model at all.
5. **An actor on every event.** `agent` (with harness and model attribution),
   `operator` (no identity, by design), `tend`, `monitor` (watchdog,
   reconciler, review flow) or `github`. On `repair_commit_pushed` the actor
   is the commit's **author**, so an operator's commit is never credited to a
   model (the HOK-2894 class).
6. **Missing vs zero vs unknown.** An absent optional field means *not
   reported*. `0`, `false` and `[]` are observed values (`findings: []` is an
   observed clean round). An `unknown` enum value means the writer looked and
   the source did not say. `null` is rejected: leave the field out instead.
   Where a derivation needs a field that is absent (e.g. `started_at` for CI
   minutes), its result is a lower bound, as in the
   [task-cost README](./README.md#missing-vs-zero).
7. **Decision records are self-contained.** A `recovery_decision` carries the
   frozen context the policy saw, the available actions, the chosen action,
   the policy name and version, and its propensities with their source (see
   [Recovery decisions](#recovery-decisions)).
8. **No prompts, transcript text, paths, credentials or account identifiers.**
   The task-cost `TASK_COST_FORBIDDEN_KEYS` apply at any depth (`branch`,
   `repo`, `path`, `email`, `prompt`, `text`, …). Every string is a
   constrained slug, SHA, minted id or model id. Check names are normalized
   to a `check_key` slug by the producer.

## Identity

Attempt identity is HOK-3372's `task_attempt/v1`
([`attempt-identity.md`](./attempt-identity.md)). This contract defines no
parallel run or attempt id.

- **PR scope** (`attempt`, `pr_number`, `head_sha`): an event about one PR of
  one run. `attempt.stage_attempt_id` is set when the fact belongs to one
  stage attempt (e.g. a repair push from a repair stage attempt).
- **Candidate scope** (`candidate_id`, `attempt_refs`): an event about a merge
  candidate. A candidate spanning several PRs carries one ref per run,
  predecessors first, and **is not a run**. `candidate_prepared` also carries
  the composition: `base_sha` and `entries[i]` (`pr_number`, `head_sha`) for
  `attempt_refs[i]`.
- `ejected` and `merged` are PR-scoped and may name the `candidate_id` they
  happened in.
- **Code identity** of candidate entry *i* is
  `(base_sha, heads of entries[0..i-1], entries[i].head_sha)`. The stored
  composition fully determines it, so `queueCandidateCodeIdentity` derives it
  rather than storing it twice.
- `event_id` and `candidate_id` are minted (UUIDv7 or ULID) **before** the
  write and persisted with it, so a crash and resume re-emits the same ids.
  They are never hashes of content.
- A head move (rebase, repair commit) is evidence on the same run, never a new
  attempt. A relaunch is a new `run_id`, minted by the `task_attempt/v1`
  writer.

| Event type | Write class | Scope | Records |
| --- | --- | --- | --- |
| `enqueued` | control | PR | the PR entered the queue; optional `base_sha`, `queue_depth` (entries ahead) |
| `candidate_prepared` | control | candidate | composition: `base_sha`, ordered `entries`, optional `candidate_sha` |
| `check_run_completed` | evidence | PR or candidate | `check_run_id`, `check_key`, `trigger` (`merge_group` is first-class), `run_attempt`, `conclusion` (GitHub verbatim), `started_at?`, `completed_at`, `head_sha` checked |
| `ejected` | control | PR | `trigger`, `candidate_id?`, `cause_event_ids?` |
| `rerun_requested` | control | PR or candidate | the `check_run_id` / `run_attempt` re-run. The rerun is a later `check_run_completed` |
| `rebase_performed` | evidence | PR | `previous_head_sha` → `head_sha`, `previous_base_sha?` → `base_sha`, `method`, `had_conflicts?` |
| `repair_commit_pushed` | evidence | PR | `parent_sha` → `head_sha`, author as `actor`, `commits_pushed?`, `cause_event_ids?`, `cost_event_ids?` |
| `recovery_decision` | control | PR or candidate | [decision record](#recovery-decisions) |
| `merged` | control | PR | `merge_commit_sha`, `base_sha?`, `candidate_id?`, `method?` |
| `dequeued` | control | PR | left the queue and may come back. `trigger` |
| `abandoned` | control | PR | the run stops trying to land this PR. `trigger` |
| `review_round_started` | control | PR | `round`, configured `reviewers` (intent), `selection` policy + propensity |
| `review_round_completed` | evidence | PR | `round`, `first_round_head_sha`, `reviewers` that ran (observed models), `findings` |

## Rules

`reduceQueueLifecycleLog` is the reference. It takes **one arrival-ordered
stream** that interleaves queue events with the `task_attempt/v1` records they
depend on. Like the attempt log, the stream is order-sensitive, because
"current" means "the latest launch the writer had seen". The reducer validates
every entry, then returns a decision for every queue event, the accepted event
ids in arrival order (the input for every derivation), and each candidate's
composition. Producers that enforce the rules live (MQ-1.3's single writer)
must make the same decisions. The golden fixtures are the compatibility test.

### Idempotency

- `event_id` is the idempotency key, and the first write wins. A replay with
  the same body (compared as key-sorted JSON) is a `duplicate` and changes
  nothing, so replaying a whole stream is a no-op.
- The same `event_id` with a **different** body is rejected with
  `event_id_conflict`. It never overwrites.

### Control events: the HOK-3372 rules, not a copy of them

Before it judges a control event, the reducer runs `reduceTaskAttemptLog` over
the attempt records seen so far. It then applies HOK-3372's rules to **every**
ref the event names (all of a candidate's `attempt_refs`):

| Reason | When |
| --- | --- |
| `unknown_attempt` | the run or stage attempt was never launched |
| `ref_mismatch` | the ref's run belongs to another task, or its stage attempt to another run |
| `stale_run` | the run is not current (the task was relaunched) |
| `stale_stage_attempt` | a newer attempt of that stage exists |
| `settled` | the run or stage attempt already has an outcome |

So a stale run can't enqueue, merge or decide anything for the current one.
**Ordering consequence:** a run's terminal `outcome` is written *after* its
queue terminal event (`merged` or `abandoned`). A control event that arrives
after settlement is rejected.

### Evidence events: accepted against their own attempt

Check runs, rebases, repair commits and review results are accepted whether or
not the run is current or settled. A late check-run result from a superseded
run stays attributed to that run. The only rejection is `ref_mismatch`. An
attempt that hasn't been launched yet gets the note `undeclared_attempt`, and
the event is kept.

### Candidates

| Reason | Decision | When |
| --- | --- | --- |
| `candidate_id_reused` | rejected | a second `candidate_prepared` reuses a prepared id |
| `unknown_candidate` | rejected | a control event names a candidate never prepared |
| `undeclared_candidate` | accepted, noted | an evidence event names a candidate not yet prepared |
| `candidate_mismatch` | rejected | candidate-scoped `attempt_refs` differ from the prepared composition, or `ejected` / `merged` names a candidate its run isn't in |
| `ejected_from_candidate` | rejected | `merged` names a candidate this run was already ejected from |

A cumulative candidate whose predecessor ejects is two `ejected` events, the
second with `trigger: predecessor_ejected` and the first as its cause. The
survivor lands in a **new** candidate with a new id.

### Recovery decisions

A `recovery_decision` is self-contained and replayable (MQ-1.5):

- `policy`: `{ name, version }`.
- `context`: the frozen decision-time snapshot. `as_of` is its cut-off, and
  `event_ids` are the lifecycle events the policy read. Optional inputs:
  `failing_check_keys`, `failure_class` (the class *the policy was given*,
  with its `labeler_version`), `attempt_number`,
  `base_moved_since_candidate`, `queue_depth`, `provenance`
  (`harness`, `executed_model`, `task_type`), `flake_history`.
- `available_actions` (from `retry`, `rebase`, `fix`, `split`,
  `wait_for_predecessor`, `escalate`) and `chosen_action` (one of them).
- `propensity_source`: `exact` (the policy randomized and logged its
  probabilities), `deterministic` (the chosen action has probability 1) or
  `none` (unknown, e.g. a human chose). Unless the source is `none`,
  `propensities` lists **exactly** the available actions, sums to 1 (within
  `1e-9`), and gives the chosen action a positive probability. With `none`
  it is absent.

**No leakage.** The validator rejects `context.as_of` later than the
decision's `observed_at`. The reducer rejects (`context_leak`) a context that
names an event that wasn't accepted earlier in the stream, or one observed
after `as_of`. A snapshot can't contain post-decision information.

Review-round selection (`review_round_started.selection`) uses the same
policy and propensity-source shape, with one `propensity`: the probability of
the configuration that ran.

### Review rounds

Review rounds are repair loops, in the same cost category as integration
repair. `review_round_completed.findings[].location` is relative to the code
round 1 reviewed (`first_round_head_sha`):

- `first_round`: a round-1 finding (only legal in round 1).
- `changed_since_first_round`: on lines changed after round 1.
- `unchanged_since_first_round`: on code round 1 already saw. A re-flag of
  pre-existing code sets `reflag_of` to the earlier `finding_id`.
- `unknown`: the reviewer couldn't place it.

Logging which reviewers ran, why (policy + propensity) and what each one
found creates the review-intensity variation I-25 needs to learn per-check
catch rates. Finding counts are derived from `findings`.

## Single owning writer per fact

From the HOK-3337 inventory (wavemill `docs/mq-1-1-telemetry-writers-inventory.md`,
captured at `faa798b6`; row numbers below refer to it). MQ-1.3 adds **one**
module (e.g. `shared/lib/queue-events.ts`) as the only writer of these events.
The *source* column says which decision site calls it. Everything under
"today" becomes a projection of the events, or is retired. None of it stays a
second primary.

| Fact | Event (field) | Source of the fact → the single writer | Writers today (HOK-3337 rows) | Note |
| --- | --- | --- | --- | --- |
| Entered the queue | `enqueued` | Tend merge-lane promotion (`merge-queue.ts`) | monitor `queueState` (3.20), `set_task_queue_owned` (1.5 / 3.19), `recordLaneProgress.enteredLaneAt` (3.3) | `.queued_tasks` (1.15) is the dependency wait-list, not the merge queue. Out of scope |
| Candidate composition | `candidate_prepared` | Tend's executor of `planMergeQueueTick`, or GitHub's merge queue as observed by Tend | none (3.21 is in memory). **Gap G1** | emitted even for single-entry candidates (MQ-1.3) |
| Check-run conclusion, attempt, timing | `check_run_completed` (actor `github`) | Tend's check poller (`pr-ci-status.ts`) | pr-ci-status job `.pr-ci-status-result.json` (4.11), Ready `checks[]` (4.1 / 4.2) | `merge_group` runs are first-class via `trigger` + candidate scope (**G2**). Ready's `ready` stays derived |
| Ejection | `ejected` | Tend at its merge-block decision (`tend-attempt-fact.ts`, D4) | `.tend-attempt-result.json` (3.1), `wm:blocked` (3.6, D1), lane `lastEvent` (3.3) | labels stay a render of state (HOK-3181 / HOK-3316) |
| Rerun requested | `rerun_requested` | Tend | `ciRestartCount` (3.3, a stored count), stage-failure buckets (5.1 / 5.8) | **G3**: counts derive from events |
| Rebase | `rebase_performed` | Tend's rebase phase | `rebaseCount` (3.3), tend-attempt phase `rebase` (3.1), conflict-remediation marker (4.9) | head move = code-identity evidence |
| Repair commit and its author | `repair_commit_pushed` | for an agent: the repair stage's launcher, with the author resolved from session ownership (D11) and the executed model from the provider-identity gate (D5 / D18). For an operator: Tend, on a head move with no owned session | `operator-intervention.ts` (5.20), `.coding-complete` (5.24), `gitPushKey` ledger (3.22) | **HOK-2894**: author comes from session ownership, never from the branch |
| Recovery decision | `recovery_decision` | each deciding policy: `failure-policy.ts` call sites (D21), ready-watchdog, Tend recovery (MQ-1.5) | `failure_policy_decide` stdout (5.7, not persisted), `ledger-recovery.ts` (5.13, dormant), watchdog audit (4.4) | **G4** |
| Merge | `merged` | Tend `executeMerge` (3.14), or GitHub's merge queue as observed by Tend | `prMergeKey` ledger (3.22), `wm:merged` (3.8), delivery evidence (1.11), terminal history `mergedAt` (1.8) | the side-effect ledger stays the effect dedup. The event is the fact |
| Left the queue | `dequeued` | Tend | `queueState` cleared (3.20) | |
| Stopped trying to land | `abandoned` | the terminal cleanup decision (`terminal-inbox-cleanup.ts`, D8 / HOK-3312) | tombstones (1.9 / 1.47 / 5.17), `wm:superseded` (3.9), loser `gh pr close` (3.15, **G8**), retry exhaustion (5.2) | |
| Review round configured | `review_round_started` | the review flow, at launch | none | adds the selection policy and propensity |
| Review round results | `review_round_completed` | the review flow, after `appendReviewIteration` (2.4) | `artifacts.reviewIterations` (2.4) | executed model through the provider-identity gate (D5) |
| Which attempt | `attempt`, `attempt_refs` | the `task_attempt/v1` writers (HOK-3372) | session-ownership `attemptId` (D11), `runEpoch` | not owned here |
| Repair cost | `TaskCostEventV1` with the repair `run_id` / `stage_attempt_id`, cross-linked by `cost_event_ids` | `meterWorkflowCost` (D6) | | not owned here |

The single writer must **not** write labels, durations, counts or verdicts.
Those stay with their existing owners as projections.

## Model Match review (MQ-1.6)

Checked against the outcome reporting in `@hokusai/core` (`contribution/`:
`HarnessOutcomeRowV1`, `TechnicalTaskRouterContributionRowV1/V2`, and the
redacted eval projection) and MQ-1.6's scope. Every per-task figure MQ-1.6
reports derives from these events plus task-cost events, so **MQ-1.6 needs no
change to this schema**:

| MQ-1.6 figure | Derived from |
| --- | --- |
| attempts_to_land | the `candidate_prepared` events naming the run, up to its `merged` (MQ-1.4) |
| ejections (by trigger) | `ejected` per run |
| failure classes (labeler version) | MQ-0.2's labeler over `check_run_completed`, `ejected` and `rebase_performed`. Never stored here |
| CI minutes | `completed_at − started_at` over `check_run_completed`, PR- and candidate-scoped. A candidate-scoped run carries every `attempt_refs` entry, so MQ-1.4 chooses the allocation. A missing `started_at` makes the total a lower bound |
| repair tokens / cost | `aggregateTaskCost` over `TaskCostEventV1`s whose `run_id` / `stage_attempt_id` is a repair stage attempt. `repair_commit_pushed.cost_event_ids` cross-links them. Review rounds are costed the same way |
| time_to_land | first `enqueued` → `merged`, per run (MQ-1.4) |
| completed task | `merged` (landed) vs `abandoned` |

Two constraints carry over to MQ-1.6 (they are about the row, not this
schema):

- **Join on the run before redaction.** Submitted rows carry `task_id` and
  `inference_log_id` (the routing decision, HOK-3364) but no `run_id`, and
  redaction salts `task_id`. Integration outcomes are computed per
  `(task_id, run_id)` from these events **on the producer side**, then
  attached to the row of the routing decision that launched that run.
- **The metric is versioned, not the events.** MQ-1.6 bumps the Model Match
  cost-per-completed-task definition and reports old and new side by side.
  That is a change to the summary or row, not to `queue_lifecycle_event/v1`.

Nothing in these events is reportable as is: no prompts, paths or account
data exist to leak, and model ids are the only free-form strings.

## Fixtures

| Fixture | Covers |
| --- | --- |
| `clean-merge` | enqueue → single-entry candidate → merge_group check → merge → run settles |
| `flake-rerun` | check fails on attempt 1. An exact-propensity decision chooses retry. Attempt 2 (new `check_run_id`, same `check_key`) passes |
| `base-drift-rebase` | ejected with `base_moved`. A deterministic decision rebases. `rebase_performed` on the same run, then a new candidate on the new base |
| `real-failure-repair` | real failure → ejection with cause → `fix` decision with a frozen context → repair stage attempt pushes an agent-attributed commit with cost-event links |
| `cumulative-candidate-predecessor-ejects` | two runs from two tasks in one candidate. The predecessor ejects, the survivor ejects with `predecessor_ejected` and lands alone. A wrong composition and a merge under the old candidate are rejected |
| `operator-manual-commit` | the watchdog escalates and a human pushes the fix: actor `operator`, no model, no stage attempt |
| `crash-resume-duplicate` | three identical replays (one with reordered keys) are duplicates, a reused id with a different body is rejected, a stale run's merge is rejected while its late check-run evidence is kept, and a late dequeue after settlement is rejected |
| `multi-round-review` | three rounds: exact-propensity reviewer selection, an unobserved challenge model left unrecorded, a re-flag and a new finding on code round 1 already saw, and an observed clean round |

## Compatibility

`queue_lifecycle_event/v1` follows the task-cost
[compatibility rules](./README.md#compatibility-rules). Readers ignore unknown
fields. New optional fields, event types, enum values (triggers, actions,
actor kinds) and decision reasons are minor changes (`TASK_COST_CONTRACT_VERSION`
minor), but older validators can't read them, so roll out readers first.
Removing or renaming a field, changing an event type's write class or scope,
or changing a rule above is `queue_lifecycle_event/v2`. The reducer's
decisions are part of the contract: changing a fixture's expected result is a
contract change. The JSON schema and its TS mirror change together (a test
enforces deep equality). Validator-only rules: propensities sum to 1 and
cover exactly the available actions, the chosen action is available, a
deterministic choice has probability 1, `context.as_of <= observed_at`,
`started_at <= completed_at <= observed_at`, `candidate_prepared.entries`
aligns with `attempt_refs`, round 1 has `first_round_head_sha == head_sha`,
every finding's reviewer ran, no `null` values, and no forbidden keys.
