# Attempt identity (`task_attempt/v1`)

Part of the task-cost contract from **1.1.0** (HOK-3372). It defines one
identity for *which attempt* a fact belongs to (a stage result, a termination,
a session's cost, a review round, a check run) so Wavemill, the SDK and the
queue/CI telemetry (MQ-1.2, HOK-3338) can't drift apart. Wavemill implements
it. This is a format and its rules, not a store.

| Artifact | Where |
| --- | --- |
| Version | `TASK_ATTEMPT_SCHEMA_VERSION = "task_attempt/v1"` |
| JSON schema | [`packages/core/schemas/task-attempt.v1.schema.json`](../../schemas/task-attempt.v1.schema.json) (mirrored as `TASK_ATTEMPT_V1_JSON_SCHEMA`) |
| Types | `TaskAttemptRecordV1`, `TaskAttemptControlWriteV1`, `TaskAttemptEvidenceWriteV1`, `TaskAttemptDerivedResultV1`, `TaskAttemptRef` |
| Validator | `validateTaskAttemptLogEntryV1`, `validateTaskAttemptRef` |
| Reference reducer | `reduceTaskAttemptLog(entries)` |
| Golden fixtures | `taskAttemptFixtures` ([`../fixtures/task-cost/attempt/`](../fixtures/task-cost/attempt/fixtures.ts)) |

## Identity

**IDs are minted, not derived.** Each ID is a lowercase UUID (v7
recommended) or a ULID (`MINTED_ID_PATTERN`), minted **before** the launch,
persisted with it, and never changed. It is never computed from a head SHA, a
timestamp or a session. Validators reject anything else, so
`planning@a1b2c3d#1793396483` cannot be an ID.

| Contract field | Entity | Contained in (`parent_id`) |
| --- | --- | --- |
| `task_id` | The task (the issue identifier). Not minted. | — |
| `pair_id` | A challenge pair (`kind: "pair"`) | the task |
| `arm_id` | One arm of a pair (`kind: "arm"`, `role: primary \| challenger`) | a pair |
| `run_id` | One run of the task (`kind: "run"`) | the task, or an arm when the run is a challenge arm |
| `stage_attempt_id` | One launch of one stage (`kind: "stage_attempt"`, with `stage`) | a run |

An attempt record (`record_type: "attempt"`) declares one entity: its `kind`,
its minted `id`, `task_id`, `parent_id`, and `stage` or `role` where required.
Every other record names the attempt it is about with a **`TaskAttemptRef`**:

```json
{ "task_id": "HOK-123", "run_id": "019a…", "stage_attempt_id": "019a…" }
```

Downstream records (cost events, stage results, queue/CI events) embed this
ref. They never define their own run or attempt id.

### Edges

Two typed edges, never inferred from each other:

- **`parent_id`**: structural containment. A stage attempt within a run, a run
  within a task or arm, an arm within a pair, a pair within a task. **A child
  is not a retry.**
- **`retry_of`**: this run or stage attempt replaces a failed or abandoned
  sibling: same kind, same parent, and for stage attempts the same stage. The
  target is superseded. A retry of an attempt that `succeeded` is rejected
  (`retry_of_succeeded`). Pairs and arms have no `retry_of`.

### Associated fields, not identity

These may change or arrive late without changing any ID:

- `code_identity`: `head_sha`, `base_sha` and, where needed, `change_id` (a
  digest of the diff against the merge-base, e.g. `sha256:<hex>`).
- `session_refs`: `{ harness, session_id, resolves? }`. A Codex session known
  only as `pending:<nonce>` is a ref; its resolution is a new ref with
  `resolves: "pending:<nonce>"` on the **same** `stage_attempt_id`.
- `evidence_version`: see below.
- `legacy_ids`: producer-local labels carried to join old records. Not unique;
  never a key.

## Rules

Every producer and consumer applies the same rules. `reduceTaskAttemptLog`
is the reference: it takes the log in **arrival order** (unlike cost events,
the attempt log is order-sensitive, because "current" means "the latest launch
the writer has seen") and returns a decision for every entry plus the
resulting attempt, evidence and derived-result state.

### Current

Siblings compete; the latest launch in a group is current, and an entity is
current only if its parent is too.

| Group | Members |
| --- | --- |
| A task's execution | its runs **and** pairs (a relaunch, plain or challenged, replaces whatever the task was running) |
| An arm | its runs |
| A pair | its arms, per role |
| A run | its stage attempts, per stage |

Both arms of a pair are current at once.

### Control writes: only the current, unsettled attempt

A **control write** (`record_type: "control"`) changes execution state:
`action` is `outcome`, `phase`, `next_action`, `linear_transition` or
`merge_decision`. It is rejected when:

| Reason | When |
| --- | --- |
| `unknown_attempt` | the run or stage attempt was never launched |
| `ref_mismatch` | the ref's `task_id` / `run_id` / `stage_attempt_id` don't belong together |
| `stale_run` | the run is not current (it was relaunched, or its pair or arm was) |
| `stale_stage_attempt` | a newer attempt of the same stage exists in the run |
| `settled` | the run or stage attempt already has an outcome |

So an old attempt can never move the current attempt's state: a completion
from a previous run doesn't settle, abort or advance the new one.

### Evidence writes: always accepted against their own identity

An **evidence write** (`record_type: "evidence"`) describes an attempt:
`evidence_kind` is `executed_model`, `session_resolution`, `cost`,
`review_findings`, `check_run` or `code_identity`. It is accepted whether or
not the attempt is current or settled, and stays attributed to the attempt it
names, so a late cost report for a superseded run survives the relaunch and
Hokusai's training data stays complete. Notes on an accepted write:

- `undeclared_attempt`: the launch hasn't been seen (yet). Kept; evidence may
  arrive before its launch record.
- `evidence_version_not_newer`: kept for audit, but the latest version for
  that `(attempt, evidence_kind)` does not move.

The only rejection is `ref_mismatch` (a ref that names a run under another
task, or a stage attempt under another run).

### The outcome settles once; evidence is versioned

- An attempt's `outcome` (`succeeded`, `failed`, `aborted`, `abandoned`) is set
  by the first accepted `outcome` control write and never changes.
- Evidence about it may arrive later with a higher `evidence_version`
  (monotonic per attempt and evidence kind, from 1).
- **Derived results** (`record_type: "derived"`, e.g. `challenge_comparison`)
  record the `(attempt, evidence_kind, evidence_version)` inputs they read. When
  a newer version arrives, the reducer reports the result `stale` with its
  `stale_inputs`; a recomputed result `supersedes` it. A job's success is
  keyed on the evidence versions it read, never just on the pair.

### Launches

- **Relaunch means a new run.** A launch never reuses an ID (`id_reused`).
- A child whose parent was never launched is rejected (`unknown_parent`); one
  whose parent is the wrong kind or task is rejected (`parent_mismatch`).
- Write ids (`write_id`, `derived_id`) are idempotency keys: a repeat is a
  `duplicate` and changes nothing.

### Missing, zero, unknown

As in the [task-cost README](./README.md#missing-vs-zero): an absent optional
field is *not reported*, never zero. An attempt with no `outcome` is
unsettled, not failed. An attempt with no `code_identity` saw unknown code, not
"no code". Evidence for an undeclared attempt is kept, not dropped.

## Cost events

`TaskCostEventV1` gains two optional fields (contract 1.1.0, additive within
`task_cost_event/v1`): `run_id` and `stage_attempt_id` (which requires
`run_id`). Both must be minted IDs. `aggregateTaskCost` ignores them; a
consumer selects a run's or stage attempt's events by filtering on them.

## Wavemill field mapping

Wavemill's implementation is a rename and wiring, not a reinterpretation.

| Wavemill field | Where | Contract field | Notes |
| --- | --- | --- | --- |
| `launchContract.runEpoch` | task lifecycle, tombstones (`terminal-inbox-cleanup.ts` `buildTerminalTaskTombstone`, `tombstoneKey`) | `run_id` | Mint a UUIDv7 at launch and persist it as the run id. A relaunch of a settled task mints a new one. Keep the old epoch value in `legacy_ids` while readers migrate. |
| `attempt` (counter) | task row, tombstone | — (derived) | Not identity. The count of runs is the length of the `retry_of` chain; bounded-retry limits count it. |
| session-ownership `attemptId` (`<kind>@<head7>#<epoch-seconds>`) | `.session-ownership.jsonl` (`session-ownership.ts` `buildAttemptId`) | `stage_attempt_id` (new minted value) + `legacy_ids` | The derived value collides (same kind, same second, or `nohead`), so it becomes a legacy label only. Mint the `stage_attempt_id` before spawning; the ownership row carries it. |
| Codex `pending:<nonce>` session | session ownership resolution line | `session_refs` | The pending value and its resolution are both session refs on the same `stage_attempt_id`; the resolution is a `session_resolution` evidence write with a higher `evidence_version`. |
| `challengePairId` | task row, `task-identity.ts` | `pair_id` | A `kind: "pair"` attempt record under the task. |
| `challengeRole` / `_c` task-id suffix | task row, `task-identity.ts` | `arm_id` + `role` | A `kind: "arm"` record per role. The arm's runs have `parent_id = arm_id`. The `_c` suffix stays a Wavemill display convention; it is not part of `task_id`. |
| `headSha` / `baseSha` | stage results, markers | `code_identity.head_sha` / `base_sha` | Associated, not identity. A head move is a `code_identity` evidence write, not a new attempt. |
| `reviewHeadSha` | review result | `code_identity.head_sha` on the review stage attempt's evidence | Review findings are evidence for the review `stage_attempt_id`; consumers compare its `code_identity` with the run's current head before treating it as current (HOK-3361). |
| `launchHead` | stage launch | `code_identity.head_sha` on the attempt record | The code the attempt saw at launch. |
| bounded-retry bucket key `(state_dir, bucket, head)` | `bounded-retry.sh` | `retry_of` chain within a group | Count retries by walking `retry_of` among siblings (same run and stage, or same task / arm for runs), not by head. |

Stage outcomes, operator and monitor aborts, Linear transitions and merge
decisions are control writes. Executed model, cost, review findings and check
runs are evidence writes.

## Queue / CI events (MQ-1.2)

HOK-3338 adopts this identity. Its events (`eventId`, `candidateId`, check-run
attempt, review round) reference `run_id` / `stage_attempt_id` through
`TaskAttemptRef` and define no parallel attempt or run id. A merge candidate
spanning several PRs carries one ref per run (`attempt_refs`); it does not
become a run. See the `two-pr-merge-candidate` fixture.

## Fixtures

| Fixture | Covers |
| --- | --- |
| `stage-retry-vs-child` | A stage retry (`retry_of`) vs. a stage attempt within a run (`parent_id`); cross-stage retry rejected; late completion of the superseded attempt rejected |
| `relaunch-settled-task` | A relaunch of a settled task is a new `run_id`; ID reuse and retrying a success rejected |
| `stale-control-and-evidence-after-relaunch` | Stale control completion/abort rejected; stale cost evidence accepted against the old run, not the new one |
| `codex-pending-session-resolved` | `pending:` session resolved after settlement: same `stage_attempt_id`, new session ref, `evidence_version` 2 |
| `same-second-launches` | Two launches of a stage in the same second: identical legacy label, distinct IDs |
| `challenge-pair` | Two arms, one pair; challenger aborted and relaunched under the same arm without inheriting the abort |
| `comparison-recomputed` | A comparison goes stale when evidence moves to version 2 and is superseded by a recomputation |
| `two-pr-merge-candidate` | A merge candidate referencing two runs from two tasks |

## Compatibility

`task_attempt/v1` follows the task-cost [compatibility rules](./README.md#compatibility-rules):
readers ignore unknown fields; new optional fields, evidence kinds, control
actions and decision reasons are minor (`TASK_COST_CONTRACT_VERSION` minor)
but are not readable by older validators, so roll out readers first; removing
or renaming a field, or changing a rule above, is `task_attempt/v2`. The
reducer's decisions are part of the contract: changing a fixture's expected
result is a contract change. The JSON schema and its TS mirror change together
(a test enforces deep equality); cross-field equalities (a pair's parent is its
task, no self-parent, `retry_of` is not the parent) are validator-only.
