# @hokusai/costs

Provider-neutral task cost engine. It accepts usage events for one task and
returns cost/token totals with attribution and coverage — entirely offline,
with no Hokusai credentials and no network access.

The wire contract (event/ledger/summary schemas, validators, and the pure
reference reducer `aggregateTaskCost`) lives in
[`@hokusai/core`](../core/src/task-cost/README.md) and is unchanged by this
package. `@hokusai/costs` adds the stateful shell on top: per-event pricing
with provenance, ingest-time dedupe, and a `snapshot()` that delegates every
summary semantic to the reducer.

```
adapters (HOK-3070) ──▶ @hokusai/costs (engine) ──▶ @hokusai/core (contract)
```

## Quick start

```ts
import { createTaskCostEngine } from '@hokusai/costs';

const engine = createTaskCostEngine({ taskId: 'task-0001' });

engine.ingest({
  eventId: '01900000-0000-7000-8000-000000000001',
  taskId: 'task-0001',
  sessionId: 'session-0001',
  turnId: 'turn-0001',
  sequence: 1,
  harness: 'claude-code',
  providerContractVersion: 'claude-code/1',
  observedModel: 'claude-sonnet-4-6',
  usage: { input_tokens: 1000, output_tokens: 500 }, // missing counters stay null, never 0
  observedAt: '2026-01-01T00:01:00Z',
});

const summary = engine.snapshot(); // TaskCostSummaryV1
summary.total_cost_usd; // 0.0105 (priced from the built-in table)
summary.coverage; // 'partial' — cache/reasoning counters were not reported
```

`ingest` also accepts a pre-built `TaskCostEventV1` (already priced by an
adapter): it is validated, deduped, and stored verbatim — the engine never
re-prices a contract event.

## Estimate precedence (per event)

| Priority | Source                                                       | `pricing_source`                    | `price_table`                     | `pricing_revision`                                   |
| -------- | ------------------------------------------------------------ | ----------------------------------- | --------------------------------- | ---------------------------------------------------- |
| 1        | Caller-supplied `estimatedCostUsd`                           | caller's (`local_estimate` default) | caller's (`external` default)     | engine `pricingRevision` if explicitly configured    |
| 2        | Host `priceOverrides` entry (matched via `normalizeModelId`) | `local_estimate`                    | override's (`override` default)   | override `asOf`, else engine `pricingRevision`       |
| 3        | Built-in table (`computeActualCostUsd`, unchanged)           | `local_estimate`                    | `anthropic` / `openai` / `google` | engine `pricingRevision`, else `MODEL_PRICING_AS_OF` |
| 4        | Nothing matched                                              | `none`                              | —                                 | —                                                    |

A provider-reported charge (`actualCostUsd`) is **orthogonal** to the
estimate: both are recorded when evidence exists for each, `cost_source`
becomes `provider_reported`, and the charge wins as the resolved cost in
totals. A non-finite or negative charge degrades to `null` with an
`invalid_token_usage` diagnostic instead of poisoning the ledger.

### Cache tiers

- Built-in table: Anthropic models bill cache writes at 1.25× and reads at
  0.1× the input rate (`computeActualCostUsd`'s existing behavior). Reported
  cache tokens on a non-Anthropic table model are unpriceable → the estimate
  stays `null` with `no_pricing_data`.
- Overrides: set `cacheWriteMultiplier` / `cacheReadMultiplier` to price cache
  tokens on any model. Reported non-zero cache tokens without a configured
  multiplier leave the whole estimate `null` (with `no_pricing_data`) rather
  than silently undercounting.
- An _unreported_ (`null`) cache counter bills as zero, matching
  `computeActualCostUsd`.

### Codex reasoning tokens

`harness: 'codex'` bills `output_tokens + reasoning_tokens` as output (Codex
reports them separately); Claude Code's thinking tokens are already inside
`output_tokens` and are left alone. Same rule the golden fixtures were priced
with.

## Coverage semantics: partial ≠ zero

- An unknown model or missing price yields `estimated_cost_usd: null` and an
  `unpriced_model` diagnostic — **never `$0`**. The summary keeps
  `total_cost_usd: null` and `coverage: 'partial'`; the priced subtotal in
  `estimated_cost_usd` is a lower bound.
- An explicit `0` needs known-zero evidence: a provider that reported `$0`, or
  a price table / override that actually priced the usage to zero.

## Host override example

```ts
const engine = createTaskCostEngine({
  taskId: 'task-0001',
  priceOverrides: [
    {
      model: 'anthropic/claude-sonnet-4.6', // matched via normalizeModelId
      inputPerMTokUsd: 1.5,
      outputPerMTokUsd: 7.5,
      cacheWriteMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      asOf: '2026-01-01', // stamped as pricing_revision
    },
  ],
});
```

Overrides beat the built-in table by design, are validated at construction
(`TypeError` for negative/non-finite rates or two overrides that normalize to
the same model), and price with exact BigInt arithmetic so extreme token
counts (up to and beyond `Number.MAX_SAFE_INTEGER`) never pick up float drift.
The final per-event estimate rounds at micro-USD, the same precision as
`computeActualCostUsd`, so override-priced rows are indistinguishable from
table-priced ones downstream.

## Replay and isolation

- `ingest` is idempotent per `event_id`: a repeat returns
  `{ status: 'duplicate' }` with the originally stored event and never touches
  totals. Engine-level dedupe is a _subset_ of the reducer's replay semantics:
  a duplicate stopped here never reaches the reducer, so the summary carries
  no `replay_dropped` diagnostic for it. Callers who want the full replay
  diagnostics can call `aggregateTaskCost` (still exported from
  `@hokusai/core`) over their own event list.
- `replay_of_event_id` supersede chains, cumulative-vs-delta reconciliation,
  backward-jump clamping, coverage promotion, model segments, and nano-USD
  rounding are all the reducer's, via `snapshot()`.
- Every engine's state lives in per-instance closure locals; two tasks never
  share accounting state. Rejected inputs mutate nothing.

## Validation

Every event the engine assembles or is handed passes
`validateTaskCostEventV1` before storage, so enum safety, forbidden-key
enforcement (no prompts/paths/credentials), and the contract's cross-field
consistency rules hold for everything in `events()`.

## Source adapters (opt-in)

Task/session capture for Claude Code and Codex ships behind dedicated subpath
exports (HOK-3070). The package root stays parser- and Node-free; importing a
subpath is the opt-in:

| Subpath                               | What it does                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@hokusai/costs/sources/claude-code`  | `extractClaudeCodeUsage` — assistant-turn usage from session transcript JSONL contents   |
| `@hokusai/costs/sources/codex`        | `extractCodexUsage` — `token_count` usage from rollout JSONL contents                    |
| `@hokusai/costs/sources/event-source` | `extractEventSourceUsage` — boundary filter for harnesses already emitting usage records |
| `@hokusai/costs/sources/node-fs`      | `readSessionFiles` — Node-only file discovery over explicitly supplied roots             |

```ts
import { createTaskCostEngine } from '@hokusai/costs';
import { extractClaudeCodeUsage } from '@hokusai/costs/sources/claude-code';
import { readSessionFiles } from '@hokusai/costs/sources/node-fs';

// 1. The caller states the task boundary explicitly — task, sessions, window.
const boundary = {
  boundaryVersion: 1,
  taskId: 'task-0001',
  sessionIds: ['0199a3b2-...-claude-session-uuid'],
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T01:00:00Z',
} as const;

// 2. Read the session files (or supply contents from anywhere else).
const { files, diagnostics: fsDiagnostics } = readSessionFiles({
  roots: ['/home/me/.claude/projects/-encoded-project-dir'],
  sessionIds: boundary.sessionIds,
});

// 3. Extract, then feed the engine.
const { inputs, diagnostics, sourceVersions } = extractClaudeCodeUsage({
  boundary,
  files: files.map((file) => file.content),
});
const engine = createTaskCostEngine({ taskId: boundary.taskId });
engine.ingestMany(inputs);
const summary = engine.snapshot();
```

Design rules the adapters hold to:

- **Explicit boundary only.** Correlation is `session_id ∈ sessionIds` AND
  `startedAt <= observed_at <= endedAt` — never "the newest file", and never
  Wavemill branch/stage/eval joins (those stay in Wavemill). Concurrent tasks
  with disjoint boundaries cannot cross-charge.
- **Dedupe by source identity.** Claude Code rows dedupe on the API message id
  (streamed rows collapse to the final one; a resumed session's copied history
  is not double-charged). Codex observations dedupe on
  `turn_id` + observation ordinal.
- **Deltas preferred, cumulative diffed.** Codex `last_token_usage` wins when
  present; otherwise deltas are derived from `total_token_usage` against a
  per-file baseline. A regressing counter is a reset: the observation is
  skipped with a `cumulative_counter_reset` count, never guessed.
- **Provider cost when present.** Claude Code's legacy per-turn `costUSD`
  becomes `actual_cost_usd`; everything else is priced by the engine.
- **Fail soft, count only.** Malformed lines, unknown fields, missing
  timestamps/session ids, unreadable files: each becomes a count in the
  result's `diagnostics` (`TaskCostSourceDiagnostics`) and coverage degrades
  to partial/unavailable. Nothing throws on bad input — only a misconfigured
  boundary throws `TypeError`.
- **Allow-list projection.** Parsers only read usage/identity fields; prompts,
  transcript text, paths, branches, and account attributes have no code path
  into the output (`sources/privacy.test.ts` proves it with sentinels, and
  every emitted event still passes the contract's forbidden-key validator).

## Testing

```sh
pnpm --filter @hokusai/costs test
HOKUSAI_COSTS_PERF=1 pnpm --filter @hokusai/costs test   # + 100k-event throughput gate
```

`fixtures.parity.test.ts` replays all golden fixtures from `@hokusai/core`
through the engine — in fixture order, reversed, and across seeded
permutations — and requires exact-equal summaries.

## Related work

- HOK-3072 — the contract this engine implements (`@hokusai/core/task-cost`).
- HOK-3069 — task ledger + queries (downstream consumer).
- HOK-3070 — session-file adapters that feed this engine (downstream).
