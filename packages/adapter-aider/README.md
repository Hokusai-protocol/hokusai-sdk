# `@hokusai/adapter-aider`

A thin, vendor-neutral CLI wrapper that routes a coding task through Hokusai, launches [Aider](https://aider.chat) with the recommended model unchanged, parses the model/token/cost lines Aider prints, and submits one `harness_outcome_row/v1` contribution through the shared `@hokusai/core` integration path.

Aider is a good proof point precisely because it is not a Hokusai-native tool: it uses whatever model you point it at, over whatever OpenAI-compatible endpoint you configure. The wrapper does not touch model handoff, does not rewrite provider prefixes, and does not fabricate cost when Aider's output changes shape.

## Install

```sh
pnpm add @hokusai/adapter-aider
npm install @hokusai/adapter-aider
```

Aider itself must already be installed and on `PATH`. See [Aider's install docs](https://aider.chat/docs/install.html).

## Quick start

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
export OPENAI_API_BASE=https://openrouter.ai/api/v1
export OPENAI_API_KEY=sk-or-v1-your_openrouter_key
hokusai-aider --max-cost-usd 1 -- "fix the failing test in packages/foo"
```

Anything after `--` is forwarded to Aider verbatim, so you can pass files, `--model-metadata-file`, `--no-auto-commits`, or any other Aider flag alongside the wrapper's defaults.

## Handoff behavior

The wrapper hands the model id to Aider byte-for-byte:

- `openai/gpt-4o` stays `openai/gpt-4o`
- `openrouter/anthropic/claude-3.5-sonnet` stays as it was
- `litellm/...` prefixes stay as they were

If your routing decision names a model outside the built-in Hokusai catalog, add it once with `--available-model`:

```sh
hokusai-aider --available-model openrouter/anthropic/claude-3.5-sonnet -- "…"
```

The extra id is treated as an opaque candidate: routable, mappable, and passed to `aider --model` unchanged.

## OpenAI-compatible / BYOK configuration

Hokusai picks the model. Aider uses **your** provider credentials to run it. The wrapper never reads or transmits provider keys.

- OpenAI-compatible providers: set `OPENAI_API_BASE` + `OPENAI_API_KEY` and use `openai/<model>` ids (Aider convention).
- Provider-specific keys (Anthropic, Groq, DeepSeek, Google, …) remain Aider/provider concerns and are read straight from the environment.
- Aider aliases (`--alias`) or `.aider.conf.yml` still work — the wrapper does not intercept them.

## Privacy boundary

- The routing payload is redacted by `@hokusai/core` before transport.
- The submitted contribution row carries metadata only: task descriptor labels, allowed and selected model ids, cost/timing/status, route id, harness name, and SDK version.
- Source code, diffs, full prompts, Aider stdout/stderr, and API keys are **not** submitted. `harness_outcome_row/v1` explicitly forbids fields like `prompt`, `messages`, and `task_text`.

## Telemetry degradation

The wrapper never fabricates cost. Rows explicitly degrade to telemetry-only when any of these hold:

- Aider printed no session `Cost: $... session` line and token counts are missing.
- The selected model is not priced in the shared table.
- Aider exited non-zero (failed runs always omit `actual_cost_usd`).
- The output format changed and neither cost nor tokens parsed.

The server then classifies the row as `partial` or `non_ranking` — telemetry that is stored but excluded from training and ranking. `training_eligible` is never asserted client-side.

## Library usage

You can also call the loop directly from Node without the CLI:

```ts
import { HokusaiClient } from '@hokusai/core';
import { runAiderLoop } from '@hokusai/adapter-aider';

const client = new HokusaiClient({ apiKey: process.env.HOKUSAI_API_KEY });
const result = await runAiderLoop({
  client,
  taskText: 'refactor the auth middleware to use the new policy engine',
  budgetUsd: 0.5,
  extraAiderArgs: ['--no-auto-commits'],
});

console.log(result.selectedModel, result.fidelityTier);
```

## Caveats

Aider's cost/token output format is not part of a published stable API and can change between releases. When the format changes, the wrapper intentionally degrades to telemetry rather than guess. If a new format lands, extend `packages/adapter-aider/src/accounting.ts` and add a fixture — do not add a locale-guessed fallback.
