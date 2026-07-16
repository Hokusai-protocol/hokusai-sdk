from __future__ import annotations

from typing import Any

import pytest

from hokusai_openhands.errors import ModelUnavailableError, RoutingUnavailableError
from hokusai_openhands.hokusai_client import RouteRecommendation
from hokusai_openhands.router import HokusaiRouterLLM


class FakeLLM:
    def __init__(self, *, model: str, usage_id: str) -> None:
        self.model = model
        self.usage_id = usage_id

    def completion(self, messages: list[Any], **_: Any) -> dict[str, object]:
        return {"model": self.model, "message_count": len(messages)}


class FakeClient:
    def __init__(self, result: RouteRecommendation | Exception) -> None:
        self.result = result

    def route(self, metadata: dict[str, object], **_: object) -> RouteRecommendation:
        if isinstance(self.result, Exception):
            raise self.result
        assert metadata["candidate_models"] == [
            "openhands/devstral-small-2507",
            "openhands/claude-sonnet-4-5-20250929",
        ]
        return self.result


LLMS = {
    "fast": FakeLLM(
        model="openhands/devstral-small-2507",
        usage_id="agent-fast",
    ),
    "quality": FakeLLM(
        model="openhands/claude-sonnet-4-5-20250929",
        usage_id="agent-quality",
    ),
}


def test_router_selects_hokusai_model_and_persists_route_context() -> None:
    router = HokusaiRouterLLM(
        client=FakeClient(
            RouteRecommendation(
                model="openhands/claude-sonnet-4-5-20250929",
                route_id="route-1",
            )
        ),  # type: ignore[arg-type]
        llms_for_routing=LLMS,
        metadata_provider=lambda _: {"task_type": "bugfix", "estimated_output_tokens": 144},
        request_id_factory=lambda: "idem-1",
    )

    result = router.completion(messages=[{"role": "user", "content": "SECRET_PROMPT_TOKEN"}])

    assert result["model"] == "openhands/claude-sonnet-4-5-20250929"
    assert router.last_route_context is not None
    assert router.last_route_context.route_id == "route-1"
    assert router.last_route_context.idempotency_key == "idem-1"
    assert router.last_route_context.fallback_used is False


def test_router_declines_unavailable_recommendation_by_default() -> None:
    router = HokusaiRouterLLM(
        client=FakeClient(
            RouteRecommendation(
                model="openhands/unknown-model",
                route_id="route-1",
            )
        ),  # type: ignore[arg-type]
        llms_for_routing=LLMS,
    )

    with pytest.raises(ModelUnavailableError):
        router.select_llm(messages=[])

    assert router.last_route_context is not None
    assert router.last_route_context.route_id == "route-1"
    assert router.last_route_context.selected_model is None
    assert router.last_route_context.error_type == "ModelUnavailableError"


def test_router_uses_configured_fallback_for_unavailable_recommendation() -> None:
    router = HokusaiRouterLLM(
        client=FakeClient(
            RouteRecommendation(
                model="openhands/unknown-model",
                route_id="route-1",
            )
        ),  # type: ignore[arg-type]
        llms_for_routing=LLMS,
        fallback_model="fast",
    )

    selected = router.select_llm(messages=[])

    assert selected == "fast"
    assert router.last_route_context is not None
    assert router.last_route_context.fallback_used is True
    assert router.last_route_context.selected_model == "openhands/devstral-small-2507"


def test_router_raises_on_routing_failure_without_fallback() -> None:
    router = HokusaiRouterLLM(
        client=FakeClient(RoutingUnavailableError("timeout")),  # type: ignore[arg-type]
        llms_for_routing=LLMS,
    )

    with pytest.raises(RoutingUnavailableError):
        router.select_llm(messages=[])

    assert router.last_route_context is not None
    assert router.last_route_context.route_id is None
    assert router.last_route_context.error_type == "RoutingUnavailableError"


def test_router_uses_fallback_on_routing_failure_when_configured() -> None:
    router = HokusaiRouterLLM(
        client=FakeClient(RoutingUnavailableError("timeout")),  # type: ignore[arg-type]
        llms_for_routing=LLMS,
        fallback_model="fast",
    )

    selected = router.select_llm(messages=[])

    assert selected == "fast"
    assert router.last_route_context is not None
    assert router.last_route_context.fallback_used is True
