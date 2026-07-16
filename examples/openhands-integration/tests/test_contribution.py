from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from hokusai_openhands.contribution import (
    HARNESS_OUTCOME_ROW_FIELDS_PY,
    HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
    build_harness_outcome_row,
)
from hokusai_openhands.errors import PromptLeakageError
from hokusai_openhands.hokusai_client import HokusaiHttpClient, Recommendation
from hokusai_openhands.outcome import HokusaiOutcomeReporter
from hokusai_openhands.router import HokusaiRouteResolver, ModelBinding, RouteDecision

BINDINGS = [
    ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini"),
    ModelBinding(key="claude-4", model_id="anthropic/claude-4"),
]


def _decision(
    *,
    fallback: bool = False,
    routing_key: str = "gpt-4o-mini",
    model_id: str = "openai/gpt-4o-mini",
    route_id: str = "route-outer",
    routing_metadata: dict[str, Any] | None = None,
) -> RouteDecision:
    binding = next(b for b in BINDINGS if b.key == routing_key and b.model_id == model_id)
    return RouteDecision(
        call_id="call-1",
        binding=binding,
        recommendation=Recommendation(
            route_id=route_id,
            selected_model=model_id,
            allowed_models=tuple(b.model_id for b in BINDINGS),
        ),
        fallback_used=fallback,
        fallback_reason="recommendation_not_in_routing_set" if fallback else None,
        routing_metadata=routing_metadata or {"task_type": "bugfix", "budget_usd": 0.05},
    )


def test_build_harness_outcome_row_success_case() -> None:
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        allowed_models=["openai/gpt-4o-mini", "anthropic/claude-4"],
        selected_model="openai/gpt-4o-mini",
        completion_result="success",
        cost_usd=0.0021,
        prompt_tokens=128,
        completion_tokens=342,
        wall_clock_seconds=0.42,
        budget_usd=0.02,
        inference_log_id="route-abc",
        task_id="task-1",
        observed_at="2026-07-16T12:00:00Z",
    )

    assert row["schema_version"] == HARNESS_OUTCOME_ROW_SCHEMA_VERSION
    assert set(row).issubset(HARNESS_OUTCOME_ROW_FIELDS_PY)
    assert row["selected_models"] == {
        "coder": "openai/gpt-4o-mini",
        "reviewer": "openai/gpt-4o-mini",
    }
    assert row["actual_cost_usd"] == 0.0021
    assert row["success_under_budget"] is True
    assert row["harness"] == "openhands"
    assert row["inference_log_id"] == "route-abc"
    assert row["harness_metadata"]["prompt_tokens"] == 128
    assert row["harness_metadata"]["total_tokens"] == 470


def test_build_harness_outcome_row_omits_missing_cost_on_failure() -> None:
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        allowed_models=["openai/gpt-4o-mini"],
        selected_model="openai/gpt-4o-mini",
        completion_result="failure",
        cost_usd=None,
        prompt_tokens=None,
        completion_tokens=None,
        wall_clock_seconds=0.0,
    )
    assert row["completion_result"] == "failure"
    assert row["success_under_budget"] is False
    assert row["wall_clock_seconds"] == 0.0
    assert "actual_cost_usd" not in row


def test_build_harness_outcome_row_rejects_unknown_top_level_field() -> None:
    with pytest.raises(PromptLeakageError):
        row: dict[str, Any] = dict(
            build_harness_outcome_row(
                task_descriptor={"task_type": "bugfix"},
                allowed_models=["openai/gpt-4o-mini"],
                selected_model="openai/gpt-4o-mini",
                completion_result="success",
                cost_usd=0.0,
                prompt_tokens=1,
                completion_tokens=1,
                wall_clock_seconds=0.1,
            )
        )
        row["messages"] = [{"role": "user", "content": "SECRET"}]
        from hokusai_openhands.contribution import assert_safe_contribution_row

        assert_safe_contribution_row(row)


def test_reporter_submits_row_with_inference_log_id(
    tracking_transport: Any,
) -> None:
    client = HokusaiHttpClient(
        "k_test", "https://api.hokus.ai", transport=tracking_transport
    )
    resolver = HokusaiRouteResolver(client=client, bindings=BINDINGS)
    reporter = HokusaiOutcomeReporter(client, resolver, openhands_sdk_version="1.36.1")

    decision = _decision(routing_metadata={"task_type": "refactor", "budget_usd": 0.05})
    started_at = datetime(2026, 7, 16, 12, 0, 0, tzinfo=UTC)

    row = reporter.report(
        decision=decision,
        metrics={
            "accumulated_cost": 0.0031,
            "accumulated_token_usage": {"prompt_tokens": 50, "completion_tokens": 90},
            "response_latencies": [0.32],
        },
        started_at=started_at,
        completion_result="success",
        task_id="task-42",
    )

    assert row["inference_log_id"] == "route-outer"
    assert row["actual_cost_usd"] == 0.0031
    assert row["success_under_budget"] is True
    assert row["harness_metadata"]["routing_key"] == "gpt-4o-mini"
    assert row["harness_metadata"]["openhands_sdk_version"] == "1.36.1"

    contribution_requests = [
        req for req in tracking_transport.requests if req["path"].endswith("/contributions")
    ]
    assert len(contribution_requests) == 1
    body = contribution_requests[0]["body"]
    assert body["rows"][0]["inference_log_id"] == "route-outer"


def test_reporter_records_fallback_metadata() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"accepted": True})

    client = HokusaiHttpClient(
        "k_test", "https://api.hokus.ai", transport=httpx.MockTransport(handler)
    )
    resolver = HokusaiRouteResolver(
        client=client,
        bindings=BINDINGS,
        unavailable_policy="fallback",
        fallback_key="gpt-4o-mini",
    )
    reporter = HokusaiOutcomeReporter(client, resolver)
    decision = RouteDecision(
        call_id="call-1",
        binding=BINDINGS[0],
        recommendation=Recommendation(
            route_id="route-x", selected_model="qwen-3-coder"
        ),
        fallback_used=True,
        fallback_reason="recommendation_not_in_routing_set",
        routing_metadata={"task_type": "refactor"},
    )
    row = reporter.report(
        decision=decision,
        metrics={"accumulated_cost": None},
        completion_result="success",
    )

    assert row["harness_metadata"]["recommended_model"] == "qwen-3-coder"
    assert row["harness_metadata"]["fallback_used"] is True
    assert row["selected_models"]["coder"] == "openai/gpt-4o-mini"


def test_reporter_swallows_submission_error(caplog: pytest.LogCaptureFixture) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/contributions"):
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(200, json={"accepted": True})

    client = HokusaiHttpClient(
        "k_test", "https://api.hokus.ai", transport=httpx.MockTransport(handler)
    )
    resolver = HokusaiRouteResolver(client=client, bindings=BINDINGS)
    reporter = HokusaiOutcomeReporter(client, resolver)

    row = reporter.report(
        decision=_decision(),
        metrics={"accumulated_cost": 0.001},
        completion_result="success",
    )
    assert row["inference_log_id"] == "route-outer"
    assert "submission failed" in caplog.text.lower()


def test_reporter_failure_metrics_record_error_type() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"accepted": True})

    client = HokusaiHttpClient(
        "k_test", "https://api.hokus.ai", transport=httpx.MockTransport(handler)
    )
    resolver = HokusaiRouteResolver(client=client, bindings=BINDINGS)
    reporter = HokusaiOutcomeReporter(client, resolver)

    row = reporter.report(
        decision=_decision(),
        metrics={"accumulated_cost": None},
        error=RuntimeError("SECRET_PROMPT_TOKEN exploded"),
    )
    assert row["completion_result"] == "failure"
    assert row["harness_metadata"]["error_type"] == "RuntimeError"
    assert "SECRET_PROMPT_TOKEN" not in json.dumps(row)
