# @hokusai/costs

Drop-in per-task cost measurement for AI coding harnesses — one import, one
wrapper call, a typed report. Entirely offline: **no Hokusai account, no API
key, no network calls, no default disk writes.**

```sh
npm install @hokusai/costs
```

## Quickstart

<!-- readme:test quickstart -->

```ts
import { measureTask } from '@hokusai/costs';

const { result, cost } = await measureTask({ events: harness }, () =>
  harness.run(task),
);
```

`result` is whatever your run returned; `cost` is a `TaskCostReport`:

| Field                        | What it is                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `totalUsd`                   | Resolved cost of the task. `null` unless **every** captured event resolved — never an undercount.                                           |
| `actualUsd` / `estimatedUsd` | Provider-reported charges vs. token-equivalent estimates (lower bounds when partial).                                                       |
| `byModel` / `byHarness`      | Per-model and per-harness breakdowns (total, usage, event/turn counts, coverage).                                                           |
| `usage`                      | Token counters (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`); `null` = not reported, never `0`. |
| `source`                     | Where the figures came from: cost source, cost basis, capture channels, session-file count.                                                 |
| `pricing`                    | Pricing snapshot: source, revision(s), effective date, price tables, override count.                                                        |
| `coverage`                   | `complete \| partial \| unavailable \| known_zero`, priced/unpriced event counts, unknown models.                                           |
| `diagnostics`                | `{ code, level, message, count }` entries explaining every gap.                                                                             |
| `summaries`                  | The raw, validated `TaskCostSummaryV1` wire records, for hosts that persist or bridge the contract.                                         |

Try it without writing any code — the package ships runnable offline examples:

```sh
node node_modules/@hokusai/costs/examples/task-cost-offline.mjs
node node_modules/@hokusai/costs/examples/task-cost-tracker.mjs
node node_modules/@hokusai/costs/examples/task-cost-session-file.mjs
```

## Automatic capture requirements

`measureTask` captures usage automatically **only** from supported sources.
Nothing is ever inferred or discovered implicitly:

- **Usage events** — pass `events`: a live emitter (`on`/`off`,
  `addListener`/`removeListener`, or an `EventTarget`; subscribed to
  `eventName`, default `'usage'`, for the duration of the run) or an
  `Iterable`/`AsyncIterable` consumed after the run. Payloads are friendly
  usage records; `fromAnthropicUsage` / `fromOpenAIUsage` map the two provider
  `usage` payload shapes, and `mapEvent` adapts anything else.
- **Session files** — pass `sessionFiles` for Claude Code or Codex transcripts,
  always behind an **explicit boundary**: the harness, non-empty `sessionIds`,
  explicit `paths` and/or `roots`, and a time `window` (defaulting to the
  run's own start/end). A file is never selected for being "the newest", and
  nothing defaults to `~/.claude` or `~/.codex`. Node-only: the file reader
  loads via a dynamic `import()` of `node:fs`, so bundlers targeting the
  browser keep a Node-free static graph (they may warn about the dynamic
  import; `sessionFiles` simply isn't available there).
- **Neither?** Call `tracker.recordUsage(...)` yourself — `measureTask` hands
  the tracker to your function, and `createTaskCostTracker` works standalone.

When nothing is captured the report says so instead of guessing:
`coverage.status: 'unavailable'`, `totalUsd: null`, and a `no_usage_captured`
diagnostic.

## API reference

### `measureTask(options, fn)`

Runs `fn(tracker)` and resolves to `{ result, cost }`.

- `options` — all tracker options below, plus `events`, `eventName`,
  `mapEvent`, `sessionFiles`, and `signal` (an already-aborted `AbortSignal`
  rejects with its reason before `fn` runs).
- If `fn` throws, **the same error instance is rethrown**, with the partial
  report attached as a non-enumerable `error.taskCost` when the error is an
  extensible object. A primitive or frozen throw is rethrown unchanged (the
  cost is unavailable then).
- Collection failures (unreadable file, bad iterable) degrade to diagnostics;
  they never mask `fn`'s result or its error.

### `createTaskCostTracker(options)`

The record/summary surface for every other host.

<!-- readme:test tracker -->

```ts
import { createTaskCostTracker } from '@hokusai/costs';

const tracker = createTaskCostTracker({
  taskId: 'task-0001',
  harness: 'native',
});
tracker.recordUsage({
  model: 'claude-sonnet-5',
  usage: { inputTokens: 1200, outputTokens: 400 },
});
const report = tracker.summary();
```

Options: `taskId` (default: generated), `harness`
(`claude-code | codex | native | pi | wavemill | unknown`, default
`unknown`), `providerContractVersion`, `costBasis`, `priceOverrides`,
`pricingRevision`, `ledger` (opt-in persistence), `now` (injectable clock).

Methods:

- `recordUsage(record)` — one friendly observation: `model`, camelCase
  `usage`, and optionally `harness`, `providerCostUsd` (a provider-reported
  charge; `0` means known-zero), `costBasis`, `eventId`, `sessionId`,
  `turnId`, `occurredAt`, `usageKind` (`'delta' | 'cumulative'`),
  `isSubagent`, `replayOfEventId`. Supply a stable `eventId` when retries may
  re-emit the same observation — replay dedupe collapses repeats across the
  whole tracker.
- `record(input)` — an engine-shaped `IngestUsageInput` or a pre-built
  `TaskCostEventV1` (adapter / event-source output).
- `summary()` — the `TaskCostReport`. Never throws; an empty tracker returns
  a well-formed `unavailable` report.
- `events()` — the accepted contract events.
- `flush()` — persist accepted-but-unpersisted events to the opt-in `ledger`
  (`measureTask` flushes automatically after the run).
- `reset()` — back to a brand-new, empty tracker.

**Bad data never throws.** A malformed record returns
`{ status: 'rejected', reason }` plus an `invalid_usage` diagnostic, with
totals unchanged. Only programmer errors (a non-object argument, an unknown
harness, an invalid task id, bad price overrides) throw `TaskCostMeasureError`
(`code: 'INVALID_ARGUMENT'`).

### Usage mappers

- `fromAnthropicUsage(u)` — Anthropic Messages API `usage` (`input_tokens`,
  `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- `fromOpenAIUsage(u)` — OpenAI `usage` (`prompt_tokens`,
  `completion_tokens`, `prompt_tokens_details.cached_tokens`,
  `completion_tokens_details.reasoning_tokens`). OpenAI's `prompt_tokens`
  _includes_ cached tokens; the mapper separates the tiers so pricing never
  double counts. Don't combine it with `harness: 'codex'` (Codex rollouts
  report reasoning tokens disjointly from output; the OpenAI API does not).

## Privacy

The report, the stored events, and the opt-in ledger hold **only allow-listed
numeric and categorical fields**: token counts, USD amounts, model ids,
harness names, enum values, timestamps, and caller-chosen identifiers. They
never hold prompts, transcript text, file paths, credentials, or account
identifiers — extra keys on any input are dropped by allow-list projection,
the contract validator rejects forbidden keys at any depth, and session-file
problems become count-only diagnostics (a path never appears in output, not
even in an error). There are no network calls, nothing reads the
`HOKUSAI_API_KEY` environment variable, and nothing is written to disk unless
you pass a `ledger`. The test suite proves all of this with sentinel-laced
fixtures and a hard-blocked network.

## Pricing accuracy

These figures are **estimates, not invoices**:

- The built-in price table is snapshotted at `MODEL_PRICING_AS_OF` (exported
  by `@hokusai/core`; also in `report.pricing.builtInTableAsOf`). Prices
  change — pin accuracy with `priceOverrides` when it matters.
- Provider-reported charges (`actualUsd`) and local token-equivalent
  estimates (`estimatedUsd`) are always reported separately; the resolved
  `totalUsd` prefers the charge per event.
- A `subscription` cost basis means the dollar figures are token-equivalent
  estimates of what the usage _would_ cost on per-token APIs — not a bill.
- Tiered, negotiated, batch, and regional pricing are not modeled.
- **An unpriced event yields `null`, never `$0`** — with its model named in
  `coverage.unknownModels` and an `unpriced_model` diagnostic. The list covers
  any model from an unpriced event: models absent from the price table, and
  known models whose usage was unpriceable (see the cache-token note below).
  The priced subtotal stays visible in `estimatedUsd`/`actualUsd` as a lower
  bound.
- Cache tokens: Anthropic and OpenAI models bill cache writes at 1.25× and
  reads at 0.1× the input rate. Reported cache tokens on other models (e.g.
  Gemini) are unpriceable from the built-in table — the event stays unpriced
  (`no_pricing_data`) unless an override sets `cacheWriteMultiplier` /
  `cacheReadMultiplier`.
- `pricing.revision` is the latest price revision used and
  `pricing.revisions` lists all of them; more than one implies a
  `stale_pricing_revision` diagnostic.

## Compatibility

`resolveActualCostUsd` (in `@hokusai/core`) is **unchanged** — keep using it
where a single best-effort number for one session is enough:

| Use                                                                                                             | Reach for                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| One number for one session/run, best effort                                                                     | `resolveActualCostUsd`                  |
| Multi-turn or multi-model work, per-model/per-harness attribution, coverage and pricing provenance, diagnostics | `measureTask` / `createTaskCostTracker` |

Its statusline/transcript capture tiers are superseded by explicit-boundary
session files (`sessionFiles`), which never guess at "the newest file".

Bridging into the router (`route.reportOutcome` / `reportExternalOutcome`,
both optional and never called by this package):

```ts
await route.reportOutcome({
  status: 'succeeded',
  // A null (partial) total must be passed as ABSENT — never as 0.
  ...(cost.totalUsd !== null ? { actualCostUsd: cost.totalUsd } : {}),
});
```

## Routing and contribution are optional

Measurement is a standalone, local feature. This package never imports the
router, never constructs a Hokusai client, and needs no `HOKUSAI_API_KEY`.
Routing (`@hokusai/router`) and outcome contribution remain entirely opt-in,
separate steps — nothing measured here is submitted anywhere unless _you_
pass a total to `reportOutcome` yourself.

---

## Lower-level APIs

The drop-in API above is a shell over three lower layers, each usable on its
own. The wire contract (event/ledger/summary schemas, validators, and the
pure reference reducer `aggregateTaskCost` / `aggregateTaskCostByModel`)
lives in [`@hokusai/core`](../core/src/task-cost/README.md).

```
measureTask / tracker ──▶ engine ──▶ @hokusai/core (contract)
        ▲                      ▲
   source adapters        price tables + overrides
```

### Engine

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
```

`ingest` also accepts a pre-built `TaskCostEventV1` (already priced by an
adapter): it is validated, deduped, and stored verbatim — the engine never
re-prices a contract event. Every event the engine assembles or is handed
passes `validateTaskCostEventV1` before storage.

#### Estimate precedence (per event)

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

Codex `token_count` events report cached input as a subset of
`input_tokens` and `reasoning_output_tokens` as a subset of `output_tokens`.
The `codex/2` adapter (HOK-3104) restores disjoint buckets on ingest:
`cache_read` + `cache_write` are subtracted from `input_tokens` (clamped to
zero, with a `codex_cache_exceeds_input` diagnostic on underflow), and
`reasoning_tokens` is reporting-only — never billed as output. Historical
`codex/1` rows keep their old interpretation. Claude Code's thinking tokens
are already inside `output_tokens` and are left alone.

Host overrides beat the built-in table by design, are validated at
construction (`TypeError` for negative/non-finite rates or two overrides that
normalize to the same model), and price with exact BigInt arithmetic, rounding
at micro-USD like `computeActualCostUsd`.

#### Replay and isolation

- `ingest` is idempotent per `event_id`: a repeat returns
  `{ status: 'duplicate' }` and never touches totals.
- `replay_of_event_id` supersede chains, cumulative-vs-delta reconciliation,
  backward-jump clamping, coverage promotion, model segments, and nano-USD
  rounding are all the reducer's, via `snapshot()`.
- Every engine's state lives in per-instance closure locals; two tasks never
  share accounting state. Rejected inputs mutate nothing.

### Source adapters (opt-in)

Task/session capture for Claude Code and Codex ships behind dedicated subpath
exports. The package root stays parser- and Node-free; importing a subpath is
the opt-in:

| Subpath                               | What it does                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `@hokusai/costs/sources/claude-code`  | `extractClaudeCodeUsage` — assistant-turn usage from session transcript JSONL contents     |
| `@hokusai/costs/sources/codex`        | `extractCodexUsage` — `token_count` usage from rollout JSONL contents                      |
| `@hokusai/costs/sources/event-source` | `extractEventSourceUsage` — boundary filter for harnesses already emitting usage records   |
| `@hokusai/costs/sources/node-fs`      | `readSessionFiles` / `readSessionFilePaths` — Node-only reads over explicit roots or paths |

Design rules the adapters hold to:

- **Explicit boundary only.** Correlation is `session_id ∈ sessionIds` AND
  `startedAt <= observed_at <= endedAt` — never "the newest file". Concurrent
  tasks with disjoint boundaries cannot cross-charge.
- **Dedupe by source identity.** Streamed rows collapse to the final one, a
  resumed session's copied history is not double-charged, and a retry (same
  message id, fresh request id) stays two events.
- **Deltas preferred, cumulative diffed.** A regressing counter is a reset:
  the tracker re-baselines and marks `cumulative_counter_reset`.
- **Fail soft, count only.** Malformed lines, missing timestamps, unreadable
  files: each becomes a count-only diagnostic; nothing throws on bad input.
- **Allow-list projection.** Prompts, transcript text, paths, branches, and
  account attributes have no code path into the output.

### Local ledger

The optional local ledger stores measured task costs as checksummed,
versioned JSONL. Supply a storage instance with an explicit absolute path and
a hash function:

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

Pass it as `createTaskCostTracker({ ledger })` / `measureTask({ ledger, … })`
to persist each run's accepted events (`toLedgerEntries` maps contract events
onto ledger records; a missing price is stored as `unpriced`/`null`, never
`$0`, and a `null` token counter is stored as `0` with `coverage: 'partial'`
so the zero is never read back as a known value).

`resolveDefaultLedgerPath({ homeDir })` constructs a suggested path under
`.hokusai/costs/`, but never reads the home directory implicitly. Only one
writer may use a ledger path at a time. The Node store uses a single append
write followed by `fsync`, creates files with mode `0600` and new parent
directories with mode `0700`, and never uploads data.

Each record has exactly these 17 keys: `v`, `id`, `c`, `ts`, `taskId`,
`model`, `harness`, `backend`, `source`, `pricingBasis`, `amountMicros`,
`currency`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheWriteTokens`, and `coverage`. Callers provide an `eventKey`, which is
hashed into `id` and never stored raw. Amounts are integer micro-USD; queries
keep metered charges separate from token-equivalent estimates.

At open, the ledger truncates only an incomplete final line, preserving every
earlier byte. Corrupt lines are skipped and counted in diagnostics. Replay of
the same `(taskId, source, eventKey)` returns `duplicate` without another
write, including after a restart. A v1 reader skips future-version lines
without changing them.

## Testing

```sh
pnpm --filter @hokusai/costs test
HOKUSAI_COSTS_PERF=1 pnpm --filter @hokusai/costs test   # + 100k-event throughput gate
pnpm smoke:costs   # pack → clean install → run the shipped examples offline
```

`fixtures.parity.test.ts` replays all golden fixtures from `@hokusai/core`
through the engine — in fixture order, reversed, and across seeded
permutations — and requires exact-equal summaries. `readme-examples.test.ts`
executes the tagged snippets in this file, so README drift fails CI.

## Related work

- HOK-3072 — the contract (`@hokusai/core/task-cost`).
- HOK-3071 — the pricing engine.
- HOK-3070 — session-file source adapters.
- HOK-3069 — the local ledger + queries.
- HOK-3073 — this drop-in API and the first public release.
