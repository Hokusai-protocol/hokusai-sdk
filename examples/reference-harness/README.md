# Reference Harness

Fork this to integrate Hokusai into your own coding harness — Pi, OpenHands, or an agent loop you built yourself.

It runs offline. No API key, no network, no credentials. It uses fake task data and a mock Hokusai API so you can watch the whole loop before you wire up anything real.

```bash
pnpm --filter @hokusai/reference-harness start
```

## What it demonstrates

The point of a Hokusai integration is not to route a task. It is to contribute a row that **trains the router and earns stake**. Those are different things, and the difference is easy to miss: a row that trains and a row that is silently discarded both come back `accepted: true`.

So this harness runs the loop twice.

| Run | `actual_cost_usd` | Server tier         | Outcome                                                     |
| --- | ----------------- | ------------------- | ----------------------------------------------------------- |
| A   | reported          | `training_eligible` | Trains the router. Earns stake.                             |
| B   | omitted           | `partial`           | Stored as telemetry. Excluded from training. Earns nothing. |

Everything else about the two rows is identical. Only `rowFidelityTiers` in the response tells them apart. Run it and read the output — that contrast is the whole lesson.

## Training eligibility

The server classifies every row it accepts. It is **authoritative** — never compute the tier yourself; read `response.rowFidelityTiers`. To land `training_eligible` a row needs all of:

- a non-empty `task_descriptor`
- a non-empty `allowed_models`
- a `selected_models` naming at least a coder or reviewer
- a numeric `budget_usd` **and** a numeric `actual_cost_usd`

The last one is where real harnesses fall down. The reward scorer decides whether a run came in under budget; with no cost it cannot, so the row is demoted. Most harnesses have token counts rather than a dollar figure — `computeActualCostUsd()` converts one to the other, and returns `undefined` for a model it does not recognize rather than inventing a number.

## Structure

The split is the point. One directory is yours, one is not.

```
src/
  hokusai/     <- thin wrapper around @hokusai/core's reusable loop
  harness/     <- yours. Four TODOs.
  mock-client.ts  <- an offline stand-in for the Hokusai API
  index.ts        <- wires the two together and prints the trace
```

`src/harness/adapter.ts` has exactly four things to implement:

1. `collectTaskContext` — where does a task come from in your harness?
2. `discoverRunnableModels` — which models can you actually run?
3. `executeWithModel` — run it; return token usage
4. `previewRedactedPayload` — show the operator what will be sent

Everything else — descriptor derivation, redaction, routing, pricing, row construction, submission — lives in `@hokusai/core`'s integration kit and should not need changing.

## The step every integrator gets wrong

Route returns an `inference_log_id` (as `RouteResponse.routeId`). It must be threaded into the contribution row. Without it the row cannot be attributed back to the routing decision, so it earns nothing no matter how complete the rest of it is.

The Claude Code plugin shipped this bug: it received the id and dropped it on the floor. `runHokusaiLoop()` in `@hokusai/core` threads it, and `src/index.test.ts` asserts it.

## Notes for specific harnesses

### Pi and OpenHands

Both have their own model-selection surface. `mapRecommendation()` resolves the router's recommended model id against your `InMemoryModelRegistry`; when the router names a model you cannot run, it **throws** `ModelMappingError` with `code` `UNKNOWN_MODEL`, `PROVIDER_NOT_ALLOWED`, or `MODEL_UNAVAILABLE` and a `suggestions` list of registered alternatives. Catch it and either remap to a model you actually run (`selected_models` must describe what ran) or record a decline — do not silently substitute a model and then report the recommended one.

Model ids in `discoverRunnableModels()` must be real provider ids. `pricing.ts` looks them up; a made-up id yields no cost and drops your row to `partial`.

### Cost capture

Claude Code exposes a statusline and a session transcript, so `session-usage.ts` can derive cost automatically from those Claude-specific surfaces. OpenHands surfaces its own cost signals — `RouterLLM` plus LLM/conversation metrics report per-turn token counts and (typically) a cost — and Pi and most custom loops carry token counts from the underlying provider. In every case, return token counts from `executeWithModel` and let `computeActualCostUsd()` price them, as this harness does; if your runtime already reports a measured dollar cost, use it directly.

If your provider reports prompt-cache tokens, pass `cacheCreationTokens` and `cacheReadTokens` too. They are billed at 1.25x and 0.1x the input rate; folding them into `inputTokens` overstates cost on cache-heavy runs.

## Privacy

Raw task text is read to derive categorical labels and then discarded. It is never stored and never transmitted. `validateContributionRow()` enforces this with a forbidden-key guard: a row containing `prompt`, `messages`, `task_text`, `description`, and similar is rejected outright.

The mock client runs that same validator, so a fork that leaks prompt text **fails locally**, in tests, rather than at the network boundary in production. `src/index.test.ts` covers it.

## Example payloads

Safe-to-publish fixtures live in [`examples/`](./examples/README.md). `contribution-row.example.json` is generated from an actual run of this harness, so it cannot drift from what the code emits.

## Further reading

- [`docs/reference-pattern.md`](../../docs/reference-pattern.md) — the harness-agnostic contract
- [`docs/privacy-model.md`](../../docs/privacy-model.md) — what leaves the machine
- [`packages/adapter-claude-code/`](../../packages/adapter-claude-code/) and [`packages/adapter-wavemill/`](../../packages/adapter-wavemill/) — two production integrations
