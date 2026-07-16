# `@hokusai/adapter-aider`

`@hokusai/adapter-aider` is a thin wrapper around Aider that:

- routes a task through Hokusai,
- launches Aider with the resolved `--model`,
- captures model/cost/usage telemetry when Aider exposes it,
- submits `harness_outcome_row/v1` through the shared core integration kit.

## Install

```bash
pnpm --filter @hokusai/adapter-aider build
pipx install aider-chat
```

## Basic usage

```bash
export HOKUSAI_API_KEY=hk_live_xxx
export OPENAI_API_KEY=sk_live_xxx

pnpm --filter @hokusai/adapter-aider exec hokusai-aider \
  "fix the flaky test and update snapshots" \
  --repo .
```

Constrain execution to a single model:

```bash
pnpm --filter @hokusai/adapter-aider exec hokusai-aider \
  "refactor the parser" \
  --repo . \
  --model gpt-5-mini
```

Preview the routed model and planned contribution shape without running Aider:

```bash
pnpm --filter @hokusai/adapter-aider exec hokusai-aider \
  "add a smoke test" \
  --repo . \
  --dry-run
```

Pass extra arguments through to Aider after `--`:

```bash
pnpm --filter @hokusai/adapter-aider exec hokusai-aider \
  "update CI docs" \
  --repo . \
  -- --map-tokens 2048
```

## Hokusai configuration

- `HOKUSAI_API_KEY`: required for routing and contribution submission.
- `HOKUSAI_API_BASE_URL`: optional override for the Hokusai API origin.
- `HOKUSAI_MODEL_ALLOWLIST`: optional comma-separated model list used when `--model` is not supplied.
- `HOKUSAI_REDACTION_SALT`: optional salt for deterministic task redaction. Defaults to `hokusai-aider`.

`--api-base-url` overrides `HOKUSAI_API_BASE_URL` for a single invocation.

## Aider / BYOK configuration

The wrapper does not manage provider credentials. Aider still reads its normal provider environment variables locally.

OpenAI example:

```bash
export OPENAI_API_KEY=sk_live_xxx
pnpm --filter @hokusai/adapter-aider exec hokusai-aider "implement the fix" --repo .
```

OpenAI-compatible example:

```bash
export OPENAI_API_KEY=provider_key
export OPENAI_API_BASE=https://my-gateway.example/v1

pnpm --filter @hokusai/adapter-aider exec hokusai-aider \
  "apply the migration" \
  --repo . \
  --model openai/my-compatible-model
```

Anthropic example:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
pnpm --filter @hokusai/adapter-aider exec hokusai-aider \
  "tighten the tests" \
  --repo . \
  --model claude-sonnet-4-6
```

## Privacy boundary

- Task text is redacted before Hokusai sees it.
- The wrapper submits only the derived task descriptor and contribution row metadata needed for routing/outcome accounting.
- Provider credentials such as `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` stay local and are only available to Aider/provider tooling through the local process environment.
- Raw repository file contents are not submitted to Hokusai by this wrapper.

## Telemetry behavior

- If Aider reports a measured cost, the wrapper submits that value.
- If Aider omits measured cost but reports known tokens for a model in Hokusai's shared pricing table, the wrapper derives `actual_cost_usd` through the shared pricing path.
- If model/cost/token data cannot be verified, the wrapper omits `actual_cost_usd` and the row degrades explicitly to telemetry instead of pretending to be training-eligible.
