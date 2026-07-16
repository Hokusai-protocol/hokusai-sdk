from __future__ import annotations

import httpx
import pytest

from hokusai_openhands.contribution import build_harness_outcome_row
from hokusai_openhands.errors import RoutingUnavailableError
from hokusai_openhands.hokusai_client import HokusaiHttpClient
from hokusai_openhands.metrics import OpenHandsMetricsSnapshot
from hokusai_openhands.router import RouteContext


def test_route_requires_route_id() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "predictions": {"recommended_strategy": {"model": "openhands/devstral-small-2507"}}
            },
        )

    client = HokusaiHttpClient(
        "k_test",
        "https://api.hokus.ai",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(RoutingUnavailableError):
        client.route(
            {
                "task_type": "bugfix",
                "candidate_models": ["openhands/devstral-small-2507"],
                "integration_version": "hokusai-openhands-example/0.1.0",
            }
        )


def test_route_rejects_malformed_response_without_model() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"routeId": "route-1", "predictions": {}})

    client = HokusaiHttpClient(
        "k_test",
        "https://api.hokus.ai",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(RoutingUnavailableError):
        client.route(
            {
                "task_type": "bugfix",
                "candidate_models": ["openhands/devstral-small-2507"],
                "integration_version": "hokusai-openhands-example/0.1.0",
            }
        )


def test_submit_contribution_uses_shared_request_shape() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.read().decode("utf8")
        return httpx.Response(200, json={"accepted": True})

    client = HokusaiHttpClient(
        "k_test",
        "https://api.hokus.ai",
        transport=httpx.MockTransport(handler),
    )
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        route_context=RouteContext(
            route_id="route-1",
            selected_model="openhands/devstral-small-2507",
            selected_key="fast",
            selected_usage_id="agent-fast",
            allowed_models=["openhands/devstral-small-2507"],
            fallback_used=False,
            recommended_model="openhands/devstral-small-2507",
            idempotency_key="idem-1",
            routing_metadata={"task_type": "bugfix"},
        ),
        metrics=OpenHandsMetricsSnapshot(
            actual_cost_usd=0.01,
            latency_seconds=1.0,
            completion_result="success",
        ).as_contribution_metrics(),
    )

    client.submit_contribution(row, idempotency_key="idem-1")

    assert '"rows": [' in str(captured["body"])
    assert '"metadata": {"idempotency_key": "idem-1"}' in str(captured["body"])
