# @hokusai/costs

Provider-neutral task cost engine. It accepts usage events for one task and
returns cost/token totals with attribution and coverage — entirely offline,
with no Hokusai credentials and no network access.

The wire contract (event/ledger/summary schemas, validators, and the pure
reference reducer `aggregateTaskCost`) lives in
[`@hokusai/core`](../core/src/task-cost/README.md) and is unchanged by this
package. `@hokusai/costs` adds the stateful shell on top: per-event pricing
with provenance, ingest-time dedupe, a `snapshot()` that delegates every
summary semantic to the reducer, and the drop-in measurement layer
(`measureTask` / `createTaskCostTracker`) documented first below.

```
adapters (HOK-3070) ──▶ @hokusai/costs (engine) ──▶ @hokusai/core (contract)
```

## Quickstart

Measure what a task actually cost, offline, in two lines:

```ts
import { measureTask } from '@hokusai/costs';

const { result, cost } = await measureTask(
  { harness: 'claude-code', sessionFile: '/path/to/session.jsonl' },
  async () => runMyTask(),
);

cost.totalUsd; // 0.0528 — sum of every record that priced (a lower bound under partial coverage)
cost.byModel; // { 'claude-sonnet-4-6': { usd: 0.0528, usage: { input: 4100, output: 2700, … } } }
cost.coverage.status; // 'complete' | 'partial' | 'none'
```

No Hokusai account, no API key, no network. A runnable end-to-end example
ships in the package tarball: `examples/task-cost-offline.mjs` reads the
sanitized fixture in `examples/fixtures/` and prints a full report.

```sh
node node_modules/@hokusai/costs/examples/task-cost-offline.mjs
```

## Automatic capture

Automatic capture needs machine-readable usage. It is supported for:

- **`harness: 'claude-code'`** + `sessionFile` — Claude Code session
  transcript JSONL (assistant-turn `usage` blocks).
- **`harness: 'codex'`** + `sessionFile` — Codex rollout JSONL
  (`token_count` events).
- **`events`** — any iterable/async iterable of already-normalized usage
  records (friendly `IngestUsageInput` shapes or prebuilt `TaskCostEventV1`
  contract events), whatever the harness.

Without `sessionFile` or `events`, nothing is captured automatically: call
`tracker.record(…)` / `tracker.recordUsage(…)` inside your task function (the
tracker is passed to it), or use `createTaskCostTracker` standalone. A task
that captured nothing reports `coverage.status: 'none'`, `totalUsd: null`,
and a `NO_USAGE_CAPTURED` diagnostic — it never throws for missing data.

The task boundary is derived from the files/records you supply: naming a
session file attributes all of its sessions to the task, with the time window
spanning the observed timestamps. Pass `boundary` (a `TaskCostBoundaryV1`)
to override the derivation for concurrent-session setups.

## API

Everything below is exported from the package root (`@hokusai/costs`).

### `measureTask(options, fn)`

Runs `fn(tracker)` and resolves `{ result, cost }` where `cost` is a
`TaskCostReport`. Options:

| Option        | Type                                     | Meaning                                                                                            |
| ------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `taskId`      | `string?`                                | Contract-safe id; generated when absent (adopted from `events` records when they carry one)        |
| `harness`     | `string?`                                | `'claude-code'`/`'codex'` (required with `sessionFile`); any label otherwise                       |
| `sessionFile` | `string \| string[]?`                    | Transcript/rollout path(s); Node-only, read via dynamic import so other paths stay runtime-neutral |
| `events`      | `Iterable \| AsyncIterable?`             | Already-normalized usage records (mutually exclusive with `sessionFile`)                           |
| `boundary`    | `TaskCostBoundaryV1?`                    | Explicit correlation boundary (advanced)                                                           |
| `ledger`      | `TaskCostLedger?`                        | Opt-in persistence: captured records are also appended to this ledger                              |
| `pricing`     | `{ priceOverrides?, pricingRevision? }?` | Host pricing configuration (see the engine docs below)                                             |
| `now`         | `(() => Date)?`                          | Clock for generated timestamps                                                                     |
| `signal`      | `AbortSignal?`                           | An already-aborted signal rejects with `AbortError` before `fn` runs                               |

Error contract: malformed options throw `MeasureError` with
`code: 'INVALID_ARGUMENT'` before `fn` runs. Data problems (unreadable file,
malformed lines, unpriced models) never throw — they become `diagnostics`
entries. When `fn` throws, the **same instance** is rethrown; if it is an
object, the partial report is attached as `error.taskCost`.

### `createTaskCostTracker(options?)`

Manual recording for harnesses without machine-readable telemetry:

```ts
import { createTaskCostTracker } from '@hokusai/costs';

const tracker = createTaskCostTracker({ taskId: 'task-0001' });
tracker.recordUsage({
  model: 'claude-sonnet-4-6',
  harness: 'custom',
  usage: { input: 1000, output: 500 },
});
const report = tracker.summary(); // TaskCostReport
```

- `record(event)` / `recordUsage(input)` — record one usage event; identity
  fields (`eventId`, `sessionId`, `turnId`, `observedAt`) are generated when
  absent, and a repeated `eventId` deduplicates instead of double-counting.
- `summary()` — build the `TaskCostReport` for everything recorded so far.
- `reset()` — drop all recorded usage and diagnostics.
- **Harness labels**: the contract's harness enum is closed
  (`claude-code`, `codex`, `native`, `pi`, `wavemill`, `unknown`). Any other
  label — for example `harness: 'custom'` — is retained for
  `byHarness`/`source.harness` display and mapped to `'unknown'` on the
  underlying contract event.
- Invalid usage (negative/non-integer counters) adds an `INVALID_USAGE`
  diagnostic and leaves totals unchanged; only non-object/shape-less input
  throws (`MeasureError`, `code: 'INVALID_ARGUMENT'`).

### `TaskCostReport`

camelCase presentation DTO: `taskId`, `totalUsd`, `byModel`, `byHarness`,
`usage` (null-preserving `TokenUsage`: `input`, `output`, `cacheRead`,
`cacheWrite`, `reasoning`), `source` (`kind`: `'session-file' | 'events' |
'manual'`, `harness`, `files?` — paths verbatim, never contents), `pricing`
(`snapshotId`, `effectiveDate`, `currency: 'USD'`), `coverage` (`status`,
`pricedRecords`, `unpricedRecords`, `unknownModels`), and `diagnostics`
(`{ code, level, message }`, codes in `MEASURE_DIAGNOSTIC_CODES`).

**`totalUsd` semantics** (deliberate): each record resolves to its
provider-reported charge, else its local estimate; `totalUsd` sums the
records that resolved and is `null` only when none did. Under
`coverage.status: 'partial'` it is a **lower bound**. This differs from the
contract summary's `total_cost_usd`, which is `null` on _any_ gap — use
`createTaskCostEngine().snapshot()` when you need the strict contract
semantics.

### Also exported

`buildTaskCostReport` (pure events → report builder), `MeasureError`,
`MEASURE_DIAGNOSTIC_CODES`, `MEASURE_PROVIDER_CONTRACT_VERSION`,
`emptyUsage`, `TOKEN_USAGE_FIELDS`, and the types `MeasureTaskOptions`,
`MeasureTaskResult`, `TaskCostTracker`, `TaskCostTrackerOptions`,
`TrackerRecordInput`, `RecordUsageInput`, `TokenUsage`, `CostCoverage`,
`CostDiagnostic`, `CostAttributionEntry`. The engine/ledger/adapters surface
below is unchanged.

## Privacy

- **Reads**: only the allow-listed usage/identity fields of session
  telemetry — token counters, model ids, session/turn/message ids,
  timestamps, harness versions, per-turn cost figures. Prompts, transcript
  text, tool arguments, `cwd`, git branches, and account identity have no
  code path into any output (enforced by the parsers' field projection and
  `validateTaskCostEventV1`'s forbidden-key denylist, and proven by
  sentinel-laced privacy tests).
- **Keeps**: everything stays in process memory unless you opt in to the
  local ledger (`options.ledger`), which persists count/cost/token fields
  only, where you point it.
- **Sends**: nothing. No network module is imported anywhere in the
  measurement path, no telemetry, no credential reads — measurement never
  reads `HOKUSAI_API_KEY` and works identically with or without one set.
  Routing and contribution submission elsewhere in the Hokusai SDK are
  optional and entirely separate; this package never imports
  `@hokusai/router`.

## Pricing accuracy

- Estimates come from the built-in price table (snapshot date
  `MODEL_PRICING_AS_OF`, re-exported by `@hokusai/core`; the report echoes it
  as `pricing.effectiveDate`) or your `priceOverrides`. They are
  **estimates, not invoices** — provider-reported charges, when present in
  the telemetry, win per record.
- A model missing from the table and overrides is counted but never priced
  as `$0`: it lands in `coverage.unknownModels`, drops `coverage.status` to
  `'partial'` (or `'none'` when nothing priced), and adds an
  `UNPRICED_MODEL` diagnostic.
- Prices change; pin `pricing.priceOverrides` (with `asOf`) when you need
  figures that do not move under an SDK upgrade.

## Compatibility

The report plugs into the existing `@hokusai/core` surfaces without new
glue:

- **`resolveActualCostUsd`** (layered cost resolution for outcome rows):
  pass the measured total as the tier-1 explicit override —

  ```ts
  import { resolveActualCostUsd } from '@hokusai/core';

  const actualCostUsd = resolveActualCostUsd({
    explicitActualCostUsd: cost.totalUsd ?? undefined,
    model: Object.keys(cost.byModel)[0] ?? 'unknown',
  });
  ```

  A finite, non-negative `explicitActualCostUsd` short-circuits the
  sidecar/transcript fallback tiers.

- **`router.reportOutcome`** (`OutcomeReport`): the outcome schema carries
  cost as the coarse `costBucket: 'low' | 'medium' | 'high'` — there is no
  raw-USD field on it by design. Bucket the measured total with your own
  thresholds; exact figures, if you need to submit them, belong in
  `extensions: { version, data }`:

  ```ts
  router.reportOutcome({
    // …required outcome fields…
    costBucket: cost.totalUsd === null ? 'low' : bucketFor(cost.totalUsd),
    extensions: { version: '1', data: { totalUsd: cost.totalUsd } },
  });
  ```

Reporting outcomes is optional and requires Hokusai credentials;
measurement itself never does.

## Engine quick start

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
  composed with the request id when both are present: streamed rows collapse
  to the final one, a resumed session's copied history is not double-charged,
  and a retry (same message id, fresh request id) stays two events per
  REQ-F2. Codex observations dedupe on `turn_id` + observation ordinal.
- **Deltas preferred, cumulative diffed.** Codex `last_token_usage` wins when
  present; otherwise deltas are derived from `total_token_usage` against a
  per-file baseline. A regressing counter is a reset: the tracker re-baselines
  on the new (lower) values and charges them as the new turn's usage per
  REQ-F3, marked with a `cumulative_counter_reset` diagnostic.
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

## Local ledger

The optional local ledger stores measured task costs as checksummed, versioned
JSONL. Supply a storage instance with an explicit absolute path and a hash
function:

```ts
import {
  openTaskCostLedger,
  createNodeFileLedgerStorage,
  defaultLedgerHash,
} from '@hokusai/costs/ledger/node';

const ledger = await openTaskCostLedger({
  storage: createNodeFileLedgerStorage({
    path: '/absolute/private/task-cost-ledger.v1.jsonl',
  }),
  hashFn: defaultLedgerHash,
});
```

`resolveDefaultLedgerPath({ homeDir })` constructs a suggested path under
`.hokusai/costs/`, but never reads the home directory implicitly. Only one
writer may use a ledger path at a time. The Node store uses a single append
write followed by `fsync`, creates files with mode `0600` and new parent
directories with mode `0700`, and never uploads data.

Each record has exactly these 17 keys: `v`, `id`, `c`, `ts`, `taskId`, `model`,
`harness`, `backend`, `source`, `pricingBasis`, `amountMicros`, `currency`,
`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and
`coverage`. Callers provide an `eventKey`, which is hashed into `id` and never
stored raw. Extra input fields are discarded. Amounts are integer micro-USD;
queries keep metered charges separate from token-equivalent estimates and
report unpriced and partial coverage.

At open, the ledger truncates only an incomplete final line, preserving every
earlier byte. Checksums protect complete lines; corrupt lines are skipped and
counted in diagnostics. Replay of the same `(taskId, source, eventKey)` returns
`duplicate` without another write, including after a restart. A v1 reader
skips future-version lines without changing them; future migrations can lift
records in memory without rewriting the file. Reverting this additive feature
leaves existing JSONL files unused and readable by a compatible reader.
