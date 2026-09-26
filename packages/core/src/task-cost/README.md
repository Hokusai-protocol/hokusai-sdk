# Task-cost contract (v1)

The versioned event, summary, ledger, and adapter contract for an account-free,
local-first task cost tracker, and the target of the Wavemill cost migration.
This module is **types, validators, and one pure reference reducer**. No adapter
runtime, storage, or pricing lives here, and nothing else in `@hokusai/core`
depends on it.

Everything is exported from `@hokusai/core`. Fixtures live in
`../fixtures/task-cost/` and are exported as `taskCostFixtures`.

## Versions

| Constant | Value | Versions |
| --- | --- | --- |
| `TASK_COST_CONTRACT_VERSION` | `1.0.0` | The contract as a whole (schemas + reducer semantics), SemVer |
| `TASK_COST_EVENT_SCHEMA_VERSION` | `task_cost_event/v1` | `TaskCostEventV1` |
| `TASK_COST_SUMMARY_SCHEMA_VERSION` | `task_cost_summary/v1` | `TaskCostSummaryV1` |
| `TASK_COST_LEDGER_SCHEMA_VERSION` | `task_cost_ledger/v1` | `TaskCostLedgerV1` |
| `TASK_COST_ADAPTER_CONTRACT_VERSION` | `task_cost_adapter/v1` | `TaskCostAdapterV1` |
| `PROVIDER_CONTRACT_VERSIONS` | `claude-code/1`, `codex/1`, `native/1`, `pi/1` | Each harness's parsing contract |

`claude-code/1` and `codex/1` are Wavemill's existing values (HOK-2958).

## The records

- **Event** (`TaskCostEventV1`): one immutable observation of usage and cost for
  one turn. Adapters append events; nothing edits them. Carries `task_id`,
  `event_id`, `session_id`, `turn_id`, `sequence`, `harness`, `observed_model`,
  `usage_kind` (`delta` | `cumulative`), token `usage`, `actual_cost_usd`,
  `estimated_cost_usd`, `cost_basis`, price provenance, and `observed_at`.
- **Ledger** (`TaskCostLedgerV1`): the append-only envelope of one session's
  events. May span several `task_id`s (concurrent tasks).
- **Summary** (`TaskCostSummaryV1`): the per-task aggregate, produced by
  `aggregateTaskCost(events, options)`. This is what Wavemill's workflow-cost
  and execution-economics output migrates to.
- **Adapter** (`TaskCostAdapterV1`): a synchronous interface
  (`describeCapabilities`, `pollLedger`, `summarizeTask`). Types only.

All wire fields are `snake_case`. The adapter interface is code, not wire, so
its members are `camelCase`.

## Actual charges vs token-equivalent estimates

An event carries two independent figures:

| Field | Meaning |
| --- | --- |
| `actual_cost_usd` | A charge the provider reported. `0` is a known-zero charge. |
| `estimated_cost_usd` | A token-equivalent estimate priced from a local table. **Never a charge.** |

`cost_source` is derived, and validators enforce it: `provider_reported` iff an
actual is present, else `local_estimate` iff an estimate is present, else
`none`. A summary adds `mixed` (some events charged, some estimated).

The task `total_cost_usd` resolves each event to `actual ?? estimated` and sums
them. Read it together with `cost_source`: it is a real charge only when
`cost_source` is `provider_reported`.

### Cost basis: subscription vs API

- `per_token_api`: cost is linear in tokens. An `actual_cost_usd`, when present,
  is a live charge.
- `subscription`: nothing is charged per call. `actual_cost_usd` **must** be
  `null`; an estimate may be present as a token-equivalent figure for
  accounting. Summaries emit `subscription_basis_no_charge`.
- `unknown`: the emitter cannot tell. Treat as `per_token_api` for arithmetic,
  and prefer `provider_reported` when present. A summary whose events disagree
  on basis reports `unknown`.

## Missing vs zero

- `null` means **missing / not reported**. A number, including `0`, means
  **observed**. Nothing in the contract fills a missing counter with `0`.
- Event `usage_coverage` is derived from the five counters and validators
  enforce it exactly: all `null` -> `unavailable`; any `null` -> `partial`; all
  `0` -> `known_zero`; otherwise `available`.
- Summary sums are null-preserving: `null` only if every event is `null`;
  otherwise a `null` contributes nothing. A sum over a `partial` field is a
  **lower bound**, and `field_availability` says so.
- `total_cost_usd` is `null` unless *every* contributing event resolved a cost.
  The component sums (`actual_cost_usd`, `estimated_cost_usd`) are still
  reported, as lower bounds when their availability is `partial`.
- Coverage promotion (Wavemill's rule, except that a confirmed zero counts as
  complete when mixed with complete events): nothing observed -> `unavailable`;
  all confirmed zero -> `known_zero`; all complete -> `complete`; else `partial`.
  Per event: no cost -> `unavailable` (no usage either) or `partial`; a confirmed
  zero cost (`actual === 0`, or a `0` estimate over `known_zero` usage) ->
  `known_zero`; a cost over `available` usage -> `complete`; else `partial`.

## Replay and idempotency

- **Idempotency key**: `event_id`. Emitters must make it stable across restarts
  (ULID or UUIDv7). A repeated `event_id` is dropped (first wins) and the summary
  reports `replay_dropped`. Replaying a whole ledger is therefore a no-op.
- **Supersede**: `replay_of_event_id` says "this event replaces that one" (for
  example a retried turn). Both stay in the ledger for audit; only the newer one
  counts. Chains resolve to the last link. A reference to an event that is not
  present is harmless. Reference cycles are invalid (`replay_cycle`).
  Superseding is intentional and does **not** report `replay_dropped`.
- **Natural key** (fallback for sources that cannot keep `event_id` stable):
  `(harness, session_id, turn_id, sequence, usage_kind)`. Adapters may use it to
  mint `event_id`; the reducer only reads `event_id`.
- **Ordering**: events may arrive in any order. Cross-session order is
  `observed_at`, then `session_id`, `sequence`, `event_id`; within a session,
  `sequence` decides.

### Delta vs cumulative

- `delta`: the usage since the previous observation. Summed directly.
- `cumulative`: the running total for the `(task_id, session_id)` scope. The
  reducer differences snapshots in `sequence` order per counter (tokens, actual
  cost, estimated cost). The first snapshot counts in full. A `null` counter is a
  missing delta and leaves the baseline alone.
- **Backward jump**: if a counter regresses, its delta is clamped to `0` (never
  negative), the baseline rebases to the lower value so later growth counts, and
  the summary reports `cumulative_backward_jump`. The drop itself is not counted,
  so a summed cost can exceed the last snapshot by the size of the drop.
- Mixing kinds within a session is allowed but discouraged: deltas never move the
  cumulative baseline.

## Reducer rules (`aggregateTaskCost`)

- Validates every event first; throws `TaskCostValidationError`.
- One task, one harness, one provider contract per summary. Pass `taskId` when
  events span tasks. Cross-harness rollups are the caller's job (`mixed_scope`).
- Pure: no clock, no I/O, no pricing. `collected_at` defaults to the latest
  `observed_at`. `join_confidence` defaults to `unattributed` because the reducer
  cannot know how a session was joined to a task.
- `model_segments` are consecutive same-model runs in canonical order, so a
  model switch and a switch back are three segments. `models` is the distinct
  list in first-seen order.
- `turn_count` counts distinct `(session_id, turn_id)` among contributing events.
  `event_ids` lists contributing events only (superseded and duplicate events are
  excluded).
- USD sums are rounded to nanodollars to remove floating-point noise.
- Diagnostics come out in contract order. Reducer-derived codes:
  `missing_token_usage`, `unpriced_model`, `mixed_coverage`,
  `provider_reported_cost`, `no_priced_sessions`, `stale_pricing_revision`
  (more than one pricing revision), `replay_dropped`,
  `cumulative_backward_jump`, `subscription_basis_no_charge`. Adapter-emitted
  codes on events (`invalid_token_usage`, `no_pricing_data`, and any of the
  above) pass through.

### Pricing rule for estimates

Estimates are inputs, not something the reducer computes. Adapters should price
with `computeActualCostUsd` and `resolveModelPrice`. Two harness conventions
matter: Claude Code's thinking tokens are already inside `output_tokens`; Codex
bills reasoning tokens as output, so price `output + reasoning`. The fixtures
follow this and a test recomputes every fixture estimate from the SDK table.

## Privacy

No free text exists in the schema. Identifiers are constrained slugs (no `/`,
`\`, `@`, spaces), `observed_model` allows a provider prefix but no path
sequences, and diagnostics are enum codes. Validators additionally reject, at
any depth, keys naming prompts, transcripts, paths, repositories, branches,
credentials, or account identities (`TASK_COST_FORBIDDEN_KEYS`, compared after
lower-casing and stripping `_`/`-`). Fixtures use synthetic ids only.

## Compatibility rules

1. `TASK_COST_CONTRACT_VERSION` is SemVer. Every record carries its own
   `schema_version`; consumers check it first and never infer a version from
   field shape.
2. Within a major version (`.../v1`), changes are additive only:
   - new **optional fields** and new **diagnostic codes** are minor changes;
   - removing or renaming a field, making an optional field required,
     tightening a value's meaning, or changing reducer semantics is a **major**
     change (`.../v2`).
3. Readers must ignore unknown fields. Validators do, except forbidden keys.
4. New values in a closed enum (`cost_source`, `harness`, ...) are additive for
   writers but **not** readable by older validators, which reject them rather
   than guess. Roll out readers before writers.
5. `provider_contract_version` is orthogonal: a harness can revise its parsing
   contract without a schema change. A summary never mixes provider contracts.
6. The reducer's semantics are part of the contract. Fixture expectations are
   the compatibility test; changing one is a contract change.

## Fixtures

`taskCostFixtures` (15 modules) each pair `events` and a `ledger` with
hand-written `expectedSummaries`. `fixtures.test.ts` checks that the reducer
reproduces every expected summary in any input order, that every estimate matches
the SDK price table, and that nothing path-, credential-, or identity-shaped
appears.

| Fixture | Covers |
| --- | --- |
| `claude-code-simple` | One model, delta events, actual charge wins over estimate |
| `claude-code-model-switch` | Opus -> Sonnet mid-task, `model_segments` |
| `claude-code-cache-tiers` | Cache writes at 1.25x, reads at 0.1x |
| `claude-code-retry` | Retried turn superseding its first attempt |
| `claude-code-cumulative-snapshot` | Cumulative snapshots and a backward jump |
| `claude-code-subscription` | Subscription basis: no charge, token-equivalent estimate |
| `codex-simple` | OpenAI pricing, reasoning billed as output |
| `codex-unknown-pricing` | Unpriced model: null cost, partial coverage, no total |
| `codex-provider-override` | Provider charge supersedes an OpenRouter estimate |
| `mixed-model` | Anthropic charged + OpenAI estimated: `cost_source: mixed` |
| `native-simple` | Known-zero counters and a known-zero turn |
| `pi-simple` | `pi/1`, nested subagent turn |
| `concurrent-tasks` | One session, two tasks: one ledger, two summaries |
| `partial-usage` | Missing output tokens stay `null` |
| `wavemill-parity` | Multi-model, cache-tier session with a real Wavemill golden |

See [`wavemill-parity.md`](./wavemill-parity.md) for the migration oracle.
