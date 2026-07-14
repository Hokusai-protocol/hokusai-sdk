# @hokusai/router

The front-door SDK for the Hokusai task router. One import, two calls: ask the
router which model to use, then report how it went. Reporting outcomes is what
trains the router and mints tokens proportional to the performance lift.

`@hokusai/router` is a thin façade over [`@hokusai/core`](../core). It owns the
wiring the common case should not have to think about — the API client, the
dispatch builder, the consent snapshot, and the model registry. When you need
more control, drop to `@hokusai/core` directly.

## Install

```sh
npm install @hokusai/router
```

## Quickstart

```ts
import { route } from '@hokusai/router';

// Your own model runners. Hokusai never calls a model — it only tells you which
// one to call, ranked across the pool you give it.
const models = {
  'claude-sonnet-4-6': { run: async (task: string) => ({ ok: true, costUsd: 0.42 }) },
  'claude-opus-4-8': { run: async (task: string) => ({ ok: true, costUsd: 1.10 }) },
};

const task = 'Refactor the billing webhook retry handling.';

// Reads HOKUSAI_API_KEY from the environment.
const { model, reasoning } = await route({
  task,
  context: { domain: 'payments', repo_type: 'monorepo' },
  availableModels: Object.keys(models),
  maxCostUsd: 1,
});

const result = await models[model].run(task);

// Reporting the outcome is what trains the router.
await route.reportOutcome({
  status: result.ok ? 'succeeded' : 'failed',
  actualCostUsd: result.costUsd,
});
```

`route(...)` returns the recommended `model`, the router's `reasoning`, a
`confidence`, ranked `alternatives`, a `routeId`, and a `correlationId`.
`route.reportOutcome` attributes the outcome to the most recent `route()` call,
so the common single-flight loop needs nothing threaded through.

### Make the contribution count

`reportOutcome` submits a **contribution row** — the record the router actually
trains on. The server scores it and returns a `fidelityTier`, and **only
`training_eligible` rows train the router or earn rewards**:

```ts
const { fidelityTier } = await route.reportOutcome({ status: 'succeeded', actualCostUsd: 0.42 });
// 'training_eligible'
```

To reach that tier the server needs to score the cost against the budget, so it
needs **both**:

| You must pass | Where |
| --- | --- |
| `maxCostUsd` — the budget | `route({ ... })` |
| `actualCostUsd` — what it really cost | `route.reportOutcome({ ... })` |

Omit either and the row is accepted but classified `partial`: stored as
telemetry, trains nothing, earns nothing. The router warns when this happens
rather than letting you discover it in the tier. The tier is
**server-authoritative** — never compute it locally.

## Configuration

For anything beyond the zero-config default — a pinned model pool, a default
objective, or an injected client — build a router explicitly:

```ts
import { createRouter } from '@hokusai/router';

const route = createRouter({
  apiKey: process.env.HOKUSAI_API_KEY,
  availableModels: ['claude-sonnet-4-6', 'claude-opus-4-8', 'gpt-5-codex'],
  objective: 'reliability', // 'speed' | 'cost' | 'reliability'
});
```

Per-call overrides take precedence over the router defaults:

```ts
await route({
  task,
  availableModels: ['claude-opus-4-8', 'claude-sonnet-4-6'],
  objective: 'speed',
  maxCostUsd: 0.5,
  maxLatencySeconds: 30,
});
```

### Candidate pools are honest

The router ranks across a **typed** candidate pool. A pool it cannot rank — one
model, after de-duplication — is not swallowed: `route(...)` throws the same
`HokusaiValidationError` that `@hokusai/core` raises. If you deliberately want to
route with a single model (and record the row as non-ranking telemetry), opt in:

```ts
await route({
  task,
  availableModels: ['claude-sonnet-4-6'],
  routingMode: 'non-ranking',
});
```

## Offline / mocked usage

Inject a client for tests or offline development — no network, no API key:

```ts
import { createRouter } from '@hokusai/router';
import { HokusaiClient } from '@hokusai/core';

const client = new HokusaiClient({
  apiKey: 'test',
  transport: (input, init) => {
    const pathname = new URL(input).pathname;
    if (pathname.endsWith('/predict')) {
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              routeId: 'route-1',
              taskId: 'task-1',
              status: 'accepted',
              recommendation: { model: 'claude-sonnet-4-6', reason: 'Mocked.' },
            }),
          ),
      });
    }
    // Outcomes are submitted as contribution rows.
    return Promise.resolve({
      status: 200,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            accepted: true,
            rows_accepted: 1,
            row_fidelity_tiers: ['training_eligible'],
          }),
        ),
    });
  },
});

const route = createRouter({ client });
const { model } = await route({ task: 'Anything, offline.' });
```

## Dropping to `@hokusai/core`

Advanced integrations that need custom consent, redaction, correlation storage,
or the raw request/response shapes should use `@hokusai/core`'s `HokusaiClient`
and `HokusaiDispatchBuilder` directly. `@hokusai/router` is built entirely on
those public APIs and hides none of them.
