from __future__ import annotations

import asyncio

import httpx
import pytest

from hokusai_openhands.errors import (
    ConfigurationError,
    MissingRouteIdError,
    ModelUnavailableError,
    RoutingCallFailed,
)
from hokusai_openhands.hokusai_client import HokusaiHttpClient, Recommendation
from hokusai_openhands.router import (
    HokusaiRouteResolver,
    ModelBinding,
    canonical_model_id,
)

BINDINGS = [
    ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini"),
    ModelBinding(key="gpt-4o", model_id="anthropic/claude-4"),
]


class FakeClient:
    def __init__(
        self,
        recommendations: list[Recommendation] | Recommendation | Exception,
    ) -> None:
        if isinstance(recommendations, list):
            self.recommendations: list[Recommendation] = recommendations
        elif isinstance(recommendations, Exception):
            self.error: Exception | None = recommendations
            self.recommendations = []
        else:
            self.recommendations = [recommendations]
            self.error = None
        self.calls: list[dict[str, object]] = []

    async def select_model(
        self, metadata: object, *, request_id: str | None = None
    ) -> Recommendation:
        self.calls.append({"metadata": metadata, "request_id": request_id})
        if getattr(self, "error", None) is not None:
            raise self.error  # type: ignore[misc]
        return self.recommendations.pop(0)

    def select_model_sync(
        self, metadata: object, *, request_id: str | None = None
    ) -> Recommendation:
        self.calls.append({"metadata": metadata, "request_id": request_id})
        if getattr(self, "error", None) is not None:
            raise self.error  # type: ignore[misc]
        return self.recommendations.pop(0)


def _resolver(
    client: object,
    *,
    unavailable_policy: str = "decline",
    fallback_key: str | None = None,
) -> HokusaiRouteResolver:
    return HokusaiRouteResolver(
        client=client,  # type: ignore[arg-type]
        bindings=BINDINGS,
        unavailable_policy=unavailable_policy,  # type: ignore[arg-type]
        fallback_key=fallback_key,
        latency_budget_ms=600,
        budget_usd=0.05,
    )


def test_canonical_model_id_strips_provider_prefixes() -> None:
    assert canonical_model_id("openai/gpt-4o-mini") == "gpt-4o-mini"
    assert canonical_model_id("openrouter/anthropic/claude-4") == "claude-4"
    assert canonical_model_id(None) is None


def test_resolver_selects_recommended_binding() -> None:
    client = FakeClient(
        Recommendation(route_id="route-1", selected_model="openai/gpt-4o-mini")
    )
    resolver = _resolver(client)
    decision = resolver.route_call_sync(message_count=3)

    assert decision.routing_key == "gpt-4o-mini"
    assert decision.model_id == "openai/gpt-4o-mini"
    assert decision.route_id == "route-1"
    assert decision.fallback_used is False
    assert decision.routing_metadata["candidate_models"] == [
        "openai/gpt-4o-mini",
        "anthropic/claude-4",
    ]


def test_resolver_declines_when_recommendation_not_configured() -> None:
    client = FakeClient(Recommendation(route_id="route-1", selected_model="qwen-3-coder"))
    resolver = _resolver(client)
    with pytest.raises(ModelUnavailableError) as excinfo:
        resolver.route_call_sync(message_count=1)
    assert "qwen-3-coder" in str(excinfo.value)
    assert excinfo.value.allowed_models == ["gpt-4o-mini", "gpt-4o"]


def test_resolver_falls_back_when_policy_allows() -> None:
    client = FakeClient(Recommendation(route_id="route-1", selected_model="qwen-3-coder"))
    resolver = _resolver(
        client, unavailable_policy="fallback", fallback_key="gpt-4o-mini"
    )
    decision = resolver.route_call_sync(message_count=1)

    assert decision.fallback_used is True
    assert decision.fallback_reason == "recommendation_not_in_routing_set"
    assert decision.routing_key == "gpt-4o-mini"
    assert decision.recommendation.selected_model == "qwen-3-coder"


def test_resolver_fallback_requires_configured_fallback_key() -> None:
    with pytest.raises(ConfigurationError):
        HokusaiRouteResolver(
            client=FakeClient(  # type: ignore[arg-type]
                Recommendation(route_id="route-1", selected_model=None)
            ),
            bindings=BINDINGS,
            unavailable_policy="fallback",
        )


def test_resolver_rejects_unknown_policy() -> None:
    with pytest.raises(ConfigurationError):
        HokusaiRouteResolver(
            client=FakeClient(  # type: ignore[arg-type]
                Recommendation(route_id="route-1", selected_model=None)
            ),
            bindings=BINDINGS,
            unavailable_policy="ignore",  # type: ignore[arg-type]
        )


def test_resolver_rejects_duplicate_binding_keys() -> None:
    with pytest.raises(ConfigurationError):
        HokusaiRouteResolver(
            client=FakeClient(  # type: ignore[arg-type]
                Recommendation(route_id="route-1", selected_model=None)
            ),
            bindings=[
                ModelBinding(key="dup", model_id="openai/gpt-4o-mini"),
                ModelBinding(key="dup", model_id="anthropic/claude-4"),
            ],
        )


def test_missing_route_id_raises_via_client_parser() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "predictions": {"recommended_strategy": {"coder_model": "gpt-4o-mini"}},
                "metadata": {},
            },
        )

    client = HokusaiHttpClient(
        "k_test", "https://api.hokus.ai", transport=httpx.MockTransport(handler)
    )
    resolver = _resolver(client)
    with pytest.raises(MissingRouteIdError):
        resolver.route_call_sync(message_count=1)


def test_client_error_surfaces_as_routing_call_failed() -> None:
    client = FakeClient(RoutingCallFailed("timeout"))
    resolver = _resolver(client)
    with pytest.raises(RoutingCallFailed):
        resolver.route_call_sync(message_count=1)


def test_resolver_stores_state_per_call_id() -> None:
    recs = [
        Recommendation(route_id="route-1", selected_model="openai/gpt-4o-mini"),
        Recommendation(route_id="route-2", selected_model="anthropic/claude-4"),
    ]
    resolver = _resolver(FakeClient(recs))
    first = resolver.route_call_sync(message_count=1)
    second = resolver.route_call_sync(message_count=2)

    assert first.call_id != second.call_id
    assert resolver.get_decision(first.call_id) is first
    assert resolver.get_decision(second.call_id) is second

    popped = resolver.pop_decision(first.call_id)
    assert popped is first
    assert resolver.get_decision(first.call_id) is None
    assert resolver.get_decision(second.call_id) is second


def test_resolver_overlapping_async_calls_do_not_bleed_route_ids() -> None:
    async def _run() -> None:
        recs = [
            Recommendation(route_id=f"route-{idx}", selected_model="openai/gpt-4o-mini")
            for idx in range(4)
        ]
        client = FakeClient(recs)
        resolver = _resolver(client)

        decisions = await asyncio.gather(
            resolver.route_call_async(message_count=1),
            resolver.route_call_async(message_count=2),
            resolver.route_call_async(message_count=3),
            resolver.route_call_async(message_count=4),
        )

        seen_route_ids = {decision.route_id for decision in decisions}
        seen_call_ids = {decision.call_id for decision in decisions}
        assert seen_route_ids == {"route-0", "route-1", "route-2", "route-3"}
        assert len(seen_call_ids) == 4

    asyncio.run(_run())


def test_binding_matches_routing_key_when_no_prefix_present() -> None:
    binding = ModelBinding(key="claude-4-sonnet", model_id="anthropic/claude-4-sonnet")
    assert binding.matches("claude-4-sonnet") is True
    assert binding.matches("anthropic/claude-4-sonnet") is True
    assert binding.matches("openai/claude-4-sonnet") is True
    assert binding.matches("gpt-4o") is False
