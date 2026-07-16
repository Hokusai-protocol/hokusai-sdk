# OpenHands RouterLLM Integration Prototype

This example shows how to route an OpenHands `RouterLLM` decision through
Hokusai, run the selected OpenHands model locally, then submit a redacted
`harness_outcome_row/v1` contribution row.

The package is intentionally metadata-only:

- Hokusai receives safe routing metadata and the post-run outcome row.
- Raw prompts, messages, tool arguments, completions, and workspace contents
  stay inside OpenHands and the configured provider path.

## Quickstart

```sh
cd examples/openhands-integration
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
ruff check .
mypy hokusai_openhands
pytest -q
python examples/run_demo.py
```

To use the adapter with a real OpenHands install, add the current OpenHands SDK
package from the official docs:

- https://docs.openhands.dev/sdk/getting-started

Set these environment variables for live routing or contribution submission:

- `HOKUSAI_API_KEY`
- `HOKUSAI_API_BASE_URL`

The demo uses local mocks by default.

## How It Works

1. `HokusaiRouterLLM` builds allowlisted routing metadata from a
   `metadata_provider`.
2. `HokusaiHttpClient` calls Hokusai before model selection and requires a
   `routeId`.
3. The recommendation is mapped onto the configured OpenHands runnable model set.
4. After execution, OpenHands metrics and conversation stats are converted into
   cost, token, latency, and completion signals.
5. The adapter builds one `harness_outcome_row/v1` row and submits it through
   the shared `{"rows": [...], "metadata": {"idempotency_key": ...}}` shape.

## Fallback And Decline Modes

Default behavior is explicit decline:

- If Hokusai routing fails, `RoutingUnavailableError` is raised.
- If Hokusai recommends a model outside the configured OpenHands model set,
  `ModelUnavailableError` is raised.

Optional fallback behavior is enabled by setting `fallback_model` to one of the
configured runnable models. When fallback is used:

- the selected model is the configured fallback model
- `fallback_used=True` is persisted on the route context
- the original `routeId` is still preserved when the routing call succeeded

## What Data Leaves The Host

Routing requests only send:

- `task_type`
- estimated token counts
- latency and budget knobs
- `quality_tier`
- `requires_tools`
- `context_length_needed`
- configured candidate model ids
- integration bookkeeping such as `integration_version`

Contribution rows only send the canonical `harness_outcome_row/v1` fields:

- `task_descriptor`
- `allowed_models`
- `selected_models`
- `actual_cost_usd` when available
- `wall_clock_seconds` when available
- `completion_result`
- `success_under_budget` when derivable
- `inference_log_id`
- `task_id` when you provide one
- `harness_metadata`

The adapter rejects outbound payloads containing prompt-like keys such as
`prompt`, `messages`, `content`, `tools`, `completion`, or `response`.

## Demo Notes

`examples/run_demo.py` runs without the real OpenHands SDK by using small local
test doubles. Set `OPENHANDS_DEMO_REQUIRE_REAL_SDK=1` if you want the script to
fail fast unless the upstream OpenHands SDK is installed.
