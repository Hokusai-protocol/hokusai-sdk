# `@hokusai/adapter-wavemill`

Wavemill is the public reference adapter for showing how a richer harness composes over `@hokusai/core` without turning Wavemill internals into the SDK architecture.

## What this adapter contributes

- Correlation replay metadata via `priorCorrelationId` and `formatCorrelation(...)`.
- Per-customer redaction lexicon support with `customerNames`.
- Harness outcome extensions for `spendUsdBucket` and `wallClockMinutes`.
- A Wavemill default task profile: deep reasoning for feature/refactor work, `['shell', 'git', 'test runner']`, and `['pnpm workspace']`.
- Re-exported conformance fixtures for task packets, outcomes, and anonymization.

## Vs a simpler harness

The `examples/reference-harness` shape can stick to plain task prompts, default reasoning inference, and minimal preview/output wiring. Wavemill adds replay-aware dispatch context, customer-specific redaction input, and typed harness telemetry that a simpler harness would not need.

## Route/report flow

```ts
import {
  HokusaiClient,
  HokusaiDispatchBuilder,
  InMemoryModelRegistry,
} from '@hokusai/core';
import {
  reportWavemillOutcome,
  routeWithWavemill,
} from '@hokusai/adapter-wavemill';

const client = new HokusaiClient({ apiKey: 'k_prod_xxx' });
const dispatchBuilder = new HokusaiDispatchBuilder({
  consent: {
    subjectId: 'developer-123',
    grantedScopes: ['task-execution'],
  },
  modelRegistry: new InMemoryModelRegistry([
    {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt',
      capabilities: ['reasoning', 'tool-use'],
      default: true,
    },
  ]),
});

await routeWithWavemill({
  client,
  dispatchBuilder,
  task: {
    id: 'task-1',
    prompt: 'Implement the planned adapter change.',
  },
  modelId: 'gpt-5-codex',
});

// DEPRECATED. `reportWavemillOutcome` posts to the legacy `/outcomes` endpoint,
// which patches an inference log and bypasses training and reward attribution
// entirely — the row trains nothing and earns nothing. See
// docs/reference-pattern.md. New integrations should build a contribution row
// with `buildHarnessOutcomeRow()` and submit it via `client.submitContribution()`;
// `examples/reference-harness` shows the full loop.
await reportWavemillOutcome({
  client,
  input: {
    correlationId: 'route_123',
    recommendedModel: 'gpt-5-codex',
    actualModel: 'gpt-5-codex',
    recommendationAccepted: true,
    completionStatus: 'succeeded',
    latencyBucket: 'medium',
    costBucket: 'medium',
    tokenBucket: 'medium',
    spendUsdBucket: '0.50-1.00',
    wallClockMinutes: 18,
  },
});
```

## Conformance fixtures

Use `wavemillConformanceFixtures` when you want one import that covers:

- `taskPacket`
- `successOutcome`
- `overriddenOutcome`
- `anonymization`
