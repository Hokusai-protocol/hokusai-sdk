# Integration Guide

This repository is intentionally split between reusable contracts and harness adapters.

## Recommended integration flow

1. Depend on `@hokusai/core` for shared task, outcome, consent, anonymization, and correlation abstractions.
2. Choose an adapter package when a harness needs opinionated command or manifest metadata.
3. Use `examples/reference-harness` as the smallest offline composition template.

## Shared API client

`@hokusai/core` exports `HokusaiClient`, which supports both offline dispatch and live API calls.

```typescript
import { HokusaiClient } from '@hokusai/core';

const client = new HokusaiClient({ apiKey: process.env.HOKUSAI_API_KEY });

// Route a task
const route = await client.route({ taskId: 'task-1', prompt: 'summarise HOK-2104' });

// Report an outcome
await client.reportOutcome({
  taskId: 'task-1',
  routingId: route.routingId,
  status: 'completed',
  summary: 'Done',
});
```

All three adapters (Wavemill, Claude Code, Codex) accept an optional `client` or `clientOptions`
field and expose the resolved `HokusaiClient` as `adapter.client`.

Key options:
- `apiKey` — required for network calls; omit for offline `prepareDispatch` use only.
- `baseUrl` — override the default API origin.
- `dryRun` — validate inputs and return a request descriptor without calling the network.
- `maxRetries` — default `2`; set to `0` to disable retries.
- `transport` — inject a custom `fetch`-compatible function (useful in tests).

Structured errors (`HokusaiAuthError`, `HokusaiValidationError`, `HokusaiNetworkError`,
`HokusaiApiError`) are exported from `@hokusai/core` and carry `code`, `status`, and `requestId`
fields for actionable error handling.
