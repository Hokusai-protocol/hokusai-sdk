from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from hokusai_openhands.contribution import HARNESS_OUTCOME_ROW_FIELDS_PY
from hokusai_openhands.hokusai_client import HokusaiHttpClient
from hokusai_openhands.metadata import ALLOWED_ROUTING_FIELDS, FORBIDDEN_FIELDS
from hokusai_openhands.outcome import HokusaiOutcomeReporter
from hokusai_openhands.router import HokusaiRouteResolver, ModelBinding
from tests.conftest import collect_keys

SECRETS = {
    "SECRET_PROMPT_TOKEN",
    "SECRET_SYSTEM_TOKEN",
    "SECRET_TOOL_ARG",
    "SECRET_COMPLETION_TOKEN",
    "SECRET_BACKDOOR",
}

BINDINGS = [ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini")]


@pytest.mark.asyncio
async def test_end_to_end_requests_never_carry_prompt_or_completion(
    tracking_transport: Any,
) -> None:
    client = HokusaiHttpClient(
        api_key="k_test",
        base_url="https://api.hokus.ai",
        transport=tracking_transport,
    )
    resolver = HokusaiRouteResolver(
        client=client,
        bindings=BINDINGS,
        latency_budget_ms=500,
        budget_usd=0.02,
    )

    async def _task_metadata() -> dict[str, Any]:
        return {"task_type": "bugfix"}

    resolver.task_metadata_provider = lambda: {"task_type": "bugfix"}

    decision = await resolver.route_call_async(
        message_count=3,
        task_metadata={"task_type": "bugfix"},
    )

    reporter = HokusaiOutcomeReporter(client, resolver)
    await reporter.async_report(
        decision=decision,
        metrics={
            "accumulated_cost": 0.0021,
            "accumulated_token_usage": {"prompt_tokens": 12, "completion_tokens": 24},
            "response_latencies": [0.31],
            # Simulate a leaky metrics source: privacy filter must drop these.
            "prompt": "SECRET_PROMPT_TOKEN",
            "completion": "SECRET_COMPLETION_TOKEN",
        },
        started_at=datetime.now(UTC),
        completion_result="success",
    )

    assert len(tracking_transport.requests) == 2

    for captured in tracking_transport.requests:
        serialized = json.dumps(captured["body"])
        for secret in SECRETS:
            assert secret not in serialized
        assert not (collect_keys(captured["body"]) & FORBIDDEN_FIELDS)

    routing_body = tracking_transport.requests[0]["body"]
    contribution_body = tracking_transport.requests[1]["body"]

    assert set(routing_body["safe_metadata"]).issubset(ALLOWED_ROUTING_FIELDS)
    assert set(contribution_body["rows"][0]).issubset(HARNESS_OUTCOME_ROW_FIELDS_PY)


def test_metrics_source_that_leaks_content_is_ignored() -> None:
    # If the caller's metrics object accidentally exposes prompt text or a
    # completion string, our snapshot must not surface it in the row.
    from hokusai_openhands.telemetry import snapshot_from_metrics

    snapshot = snapshot_from_metrics(
        {
            "accumulated_cost": 0.001,
            "prompt": "SECRET_PROMPT_TOKEN",
            "response": "SECRET_COMPLETION_TOKEN",
        },
        completion_result="success",
    )
    serialized = json.dumps(
        {
            "cost": snapshot.accumulated_cost,
            "prompt_tokens": snapshot.prompt_tokens,
            "completion_tokens": snapshot.completion_tokens,
            "total_tokens": snapshot.total_tokens,
            "latency_seconds": snapshot.latency_seconds,
            "completion_result": snapshot.completion_result,
            "error_type": snapshot.error_type,
        }
    )
    for secret in SECRETS:
        assert secret not in serialized
