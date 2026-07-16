# LiteLLM Metadata-Only Routing Integration

## Overview

This prototype wires Hokusai into LiteLLM as a metadata-only enterprise routing
integration. Hokusai receives a safe routing payload and a post-run
`harness_outcome_row/v1` contribution row. Raw prompts, message bodies, tool
arguments, and completion text stay inside the LiteLLM and provider path.

The implementation lives in
[`examples/litellm-integration`](../examples/litellm-integration/README.md).

## Architecture

```text
LiteLLM request
  |
  | 1. Custom routing strategy
  |    - count-only request signals
  |    - allowlisted task/routing metadata
  v
Hokusai /predict
  |
  | recommendation: model id + inference_log_id
  v
LiteLLM deployment selection
  |
  | raw prompt/messages/tools stay here
  v
Provider execution
  |
  | 2. Custom callback
  |    - success/failure
  |    - selected model / allowed pool
  |    - cost / token usage / latency
  v
Hokusai /contributions
```

The flow mirrors the shared SDK pattern:

1. Route from safe metadata only.
2. Execute inside the host runtime.
3. Contribute a redacted outcome row from host telemetry.

## Privacy boundary

The privacy boundary is enforced with an allowlist-first design.

- Routing metadata is assembled only from:
  - caller-supplied categorical metadata
  - message count
  - candidate model ids
  - explicit latency and budget knobs
- Unknown LiteLLM kwargs are ignored by default.
- Forbidden prompt-like keys trigger `PromptLeakageError` before any outbound
  request is sent.
- Contribution rows are constrained to the canonical
  `harness_outcome_row/v1` field list exported from `@hokusai/core`.
- Failure reporting stores only the exception class name in local callback
  telemetry, never the exception message.

## Not a Hokusai prompt proxy

This integration is explicitly **not** a Hokusai prompt proxy.

Non-goals:

- Hokusai does not receive `messages`, `prompt`, `input`, `content`, `system`,
  `tools`, `tool_calls`, or completion text.
- Hokusai does not sit in the request path as a full prompt-forwarding gateway.
- Hokusai does not rewrite prompts or inspect tool arguments.

Positioning this as a prompt proxy would conflict with the privacy model. The
intended use case is enterprise routing and post-run telemetry from safe
metadata only.

## Metadata allowlist

| Field | Source | Example | Why safe |
| --- | --- | --- | --- |
| `task_type` | caller metadata | `bugfix` | categorical label |
| `estimated_input_tokens` | caller metadata + message count heuristic | `258` | count only |
| `estimated_output_tokens` | caller metadata | `512` | count only |
| `latency_budget_ms` | integration config or caller metadata | `600` | budget only |
| `quality_tier` | caller metadata | `high` | categorical label |
| `requires_tools` | boolean presence check | `true` | no tool args |
| `context_length_needed` | caller metadata | `32768` | numeric only |
| `candidate_models` | LiteLLM deployment ids | `["gpt-4o-mini", "gpt-4o"]` | model ids only |
| `budget_usd` | integration config or caller metadata | `0.02` | budget only |
| `integration_version` | integration constant | `hokusai-litellm-example/0.1.0` | SDK bookkeeping |

## Contribution row shape

The callback builds `harness_outcome_row/v1` with:

- `task_descriptor.task_type`
- `allowed_models`
- `selected_models`
- `completion_result`
- `actual_cost_usd` when LiteLLM exposes cost
- `wall_clock_seconds`
- `inference_log_id` when the routing response includes one
- `task_id` when the caller provided one
- `harness_metadata` with `harness` and `sdk_version`

LiteLLM token usage is captured in callback-local telemetry for logging and test
inspection. It is not added to the contribution row because the canonical
`harness_outcome_row/v1` schema does not permit token fields.

## Fail-open behavior

Routing is advisory. If Hokusai times out, returns `5xx`, drops the connection,
or returns malformed JSON, the LiteLLM request continues against the first
configured fallback deployment.

The prototype defaults to a 500 ms routing timeout to keep this boundary sharp:
Hokusai can influence deployment choice, but it must not become a reliability
dependency for completion success.

## Deployment mapping

Hokusai recommendations are mapped onto LiteLLM deployments by normalizing
provider prefixes such as `openrouter/`, `litellm/`, `openai/`, `anthropic/`,
and `azure/`, then matching against:

- `deployment["model_name"]`
- `deployment["litellm_params"]["model"]`
- `deployment["model_info"]["hokusai_id"]`

Unknown or missing recommendations fall back to the first deployment and are
marked `fallback_used=true` in callback metadata.

## Getting started

Use the example package in
[`examples/litellm-integration`](../examples/litellm-integration/README.md):

```sh
cd examples/litellm-integration
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest -q
python examples/run_demo.py
```

Set `HOKUSAI_API_KEY` and `HOKUSAI_API_BASE_URL` to target a live backend. The
demo runs against local mocks by default.

## Limitations & follow-ups

- The prototype mirrors the shared contribution contract in Python; it does not
  reuse the TypeScript runtime directly.
- The route request body is intentionally minimal and metadata-only rather than
  a full reconstruction of the richer TypeScript route payload.
- Streaming-specific callback nuances in LiteLLM are not modeled beyond the
  standard success/failure hooks.
- Publishing the Python package separately is out of scope for this task.
