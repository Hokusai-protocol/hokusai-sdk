# Reference Harness

This package is the smallest complete Hokusai integration example that is safe to publish. It uses only fake task data and an in-memory mock client, so a harness author can run the full route and report flow without private credentials or a live Hokusai API.

## How to run

```bash
pnpm --filter @hokusai/reference-harness start
```

## Expected console output

The script prints nine labeled steps:

```text
[1/9] Collecting task context
[2/9] Building generic task packet
[3/9] Previewing anonymized dispatch payload
[4/9] Calling mock route
[5/9] Mapping recommended model
[6/9] Persisting local decision id
[7/9] Collecting fake outcome
[8/9] Previewing anonymized outcome report
[9/9] Submitting report
```

The payload preview and report preview also print redacted values so you can confirm that fake secrets are removed before anything is sent.

## Structure

- `src/fake-data.ts` contains safe-to-publish task and outcome fixtures.
- `src/mock-client.ts` provides offline `route` and `reportOutcome` methods with deterministic responses.
- `src/index.ts` defines the minimal `HarnessAdapter` plus the full nine-step integration flow.
- `src/index.test.ts` proves the flow runs end to end and that both previews redact the fake secret.

## Adapting this

For a real harness, keep the reusable `@hokusai/core` pieces and replace only the harness-specific parts:

- Replace `src/fake-data.ts` with real task-context and outcome collection.
- Replace `src/mock-client.ts` with a real `HokusaiClient`.
- Keep the `HokusaiDispatchBuilder`, model registry, outcome builder, and local correlation storage wiring.
- Expand the adapter methods to reflect your harness command surface, consent UX, model discovery, and local persistence choices.
