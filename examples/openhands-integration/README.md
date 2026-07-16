# Hokusai OpenHands Integration (`@hokusai/adapter-openhands` equivalent)

This example is the Python-side equivalent of `@hokusai/adapter-openhands`.
OpenHands is a Python SDK, so its adapter surface is a Python package
(`hokusai_openhands`) rather than a TypeScript workspace. It wires the
OpenHands `RouterLLM` pre-call model selection hook and the OpenHands
`llm.metrics` / `conversation.conversation_stats` post-call metrics into
Hokusai:

- **Before each LLM call:** Hokusai routing selects a model. The recommendation
  is mapped onto one of the configured `llms_for_routing` keys.
- **After each LLM call:** OpenHands SDK metrics (accumulated cost, prompt /
  completion tokens, response latency, and completion status) feed a
  `harness_outcome_row/v1` contribution row.
- **Route attribution:** every route response is required to include a
  `routeId`, and that id is persisted as `inference_log_id` on the outcome row.

## Quickstart

```sh
cd examples/openhands-integration
python3.12 -m venv .venv          # OpenHands requires Python >= 3.12
. .venv/bin/activate
pip install -e '.[dev,openhands]'
ruff check .
mypy hokusai_openhands
pytest -q
python examples/run_demo.py
```

The `openhands` extra pins `openhands-sdk==1.36.1`. Install without it
(`pip install -e '.[dev]'`) if you only want to exercise the routing logic and
outcome-row build against the built-in fakes; the tests do not require the
OpenHands runtime.

Set `HOKUSAI_API_KEY` and `HOKUSAI_API_BASE_URL` to point at a live backend.
The demo runs entirely against local mocks by default.

Additional environment variables useful for OpenHands itself:

- `LLM_API_KEY` — provider key OpenHands uses to run the selected model
- `LLM_BASE_URL` — optional provider base URL
- `LLM_MODEL` — fallback model id when routing is unavailable

## Wiring the router

```python
from openhands.sdk.llm.llm import LLM
from hokusai_openhands import (
    HokusaiHttpClient,
    HokusaiRouteResolver,
    ModelBinding,
    create_hokusai_router_llm,
)

client = HokusaiHttpClient(api_key=..., base_url=...)
resolver = HokusaiRouteResolver(
    client=client,
    bindings=[
        ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini"),
        ModelBinding(key="claude-4", model_id="anthropic/claude-4"),
    ],
    latency_budget_ms=600,
    budget_usd=0.02,
    unavailable_policy="decline",   # or "fallback" with fallback_key=...
    task_metadata_provider=lambda: {"task_type": "bugfix"},
)

router = create_hokusai_router_llm(
    resolver,
    llms_for_routing={
        "gpt-4o-mini": LLM(model="openai/gpt-4o-mini", api_key=..., usage_id="mini"),
        "claude-4": LLM(model="anthropic/claude-4", api_key=..., usage_id="c4"),
    },
)
```

Then use `router` anywhere OpenHands accepts an `LLM`. `router.select_llm(messages)`
now calls Hokusai, returns the routing key, and stashes the routed
`RouteDecision` on the resolver.

## Reporting outcomes

After a routed call finishes:

```python
from hokusai_openhands import HokusaiOutcomeReporter, last_call_id

reporter = HokusaiOutcomeReporter(client, resolver, openhands_sdk_version="1.36.1")
call_id = last_call_id(router)
decision = resolver.pop_decision(call_id)
reporter.report(
    decision=decision,
    metrics=router.active_llm.metrics,  # or conversation.conversation_stats
    started_at=started_at,
    ended_at=ended_at,
    completion_result="success",
    task_id="task-1",
)
```

The reporter reads only:

- `metrics.accumulated_cost`
- `metrics.accumulated_token_usage.{prompt,completion,total}_tokens`
- `metrics.response_latencies` (falls back to wall-clock)
- Explicit completion status / exception type

It never reads message content, tool arguments, or completion text.

## Unavailable-recommendation policy

If Hokusai recommends a model that is not present in the configured
`llms_for_routing` set, behavior is controlled by `HokusaiRouteResolver`:

- `unavailable_policy="decline"` (default) raises
  `ModelUnavailableError(recommendation, allowed_models)` so the caller can
  surface the mismatch loudly.
- `unavailable_policy="fallback"` requires `fallback_key`; the resolver picks
  that routing key, records `fallback_used=True`, and stores the recommended
  model in `harness_metadata.recommended_model` for auditing.

The runnable model in `selected_models` is always the underlying `model_id` of
the routing key actually used, never the unavailable recommendation.

## What data leaves the host

| Payload | Purpose | Includes | Excludes |
|---|---|---|---|
| Route request | Pre-call model selection | task_type, message_count, integer input/output token estimates, budget & latency signals, `candidate_models`, integration version | Message content, prompts, tool arguments, completions, response text |
| Contribution row | Post-call outcome learning | schema_version, task_descriptor, allowed_models, selected_models (routing key + reviewer), actual_cost_usd, wall_clock_seconds, completion_result, success_under_budget, inference_log_id, harness=`openhands`, task_id, harness_metadata (routing_key, fallback flags, prompt/completion/total tokens, error_type) | Message content, prompts, tool arguments, completions, response text |

Prompt/response/tool payloads never leave the host. The privacy filter both
allowlists top-level keys and does a deep key scan against a hard-coded
forbidden-key list to catch accidental leakage.

## Package surface

```python
from hokusai_openhands import (
    HokusaiHttpClient,
    HokusaiOutcomeReporter,
    HokusaiRouteResolver,
    ModelBinding,
    RouteDecision,
    Recommendation,
    MetricsSnapshot,
    ModelUnavailableError,
    MissingRouteIdError,
    build_harness_outcome_row,
    build_routing_metadata,
    canonical_model_id,
    create_hokusai_router_llm,
    hokusai_select_llm,
    last_call_id,
    snapshot_from_metrics,
)
```

## Privacy boundary

This is not a Hokusai prompt proxy. Hokusai never sees prompts, tool
arguments, or completions. See [../../docs/privacy-model.md](../../docs/privacy-model.md)
for the shared policy.
