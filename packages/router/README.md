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

// Reads HOKUSAI_API_KEY from the environment. Ranks across the default
// Anthropic model pool unless you pass your own.
const { model, reasoning } = await route({
  task: 'Refactor the billing webhook retry handling.',
  context: { domain: 'payments', repoType: 'monorepo' },
});

const result = await models[model].run(task);

// Reporting the outcome is what improves the router.
await route.reportOutcome({
  status: 'succeeded',
  latency: 'medium',
  cost: 'low',
  tokens: 'medium',
});
```

`route(...)` returns the recommended `model`, the router's `reasoning`, a
`confidence`, ranked `alternatives`, and a `correlationId`. `route.reportOutcome`
defaults its `correlationId` to the most recent `route()` call, so the common
single-flight loop needs nothing threaded through.

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
    return Promise.resolve({
      status: 200,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({ taskId: 'task-1', status: 'recorded' }),
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
