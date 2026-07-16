from __future__ import annotations

import pytest

from hokusai_openhands.errors import ConfigurationError
from hokusai_openhands.hokusai_client import Recommendation
from hokusai_openhands.router import (
    HokusaiRouteResolver,
    ModelBinding,
    attach_hokusai_resolver,
    create_hokusai_router_llm,
    hokusai_select_llm,
    last_call_id,
)

pytest.importorskip(
    "openhands.sdk.llm.router.base",
    reason="openhands-sdk is required for the OpenHands router bridge",
)


class _FakeClient:
    def __init__(self, recs: list[Recommendation]) -> None:
        self._recs = list(recs)

    def select_model_sync(
        self, metadata: object, *, request_id: str | None = None
    ) -> Recommendation:
        del metadata, request_id
        return self._recs.pop(0)

    async def select_model(
        self, metadata: object, *, request_id: str | None = None
    ) -> Recommendation:
        del metadata, request_id
        return self._recs.pop(0)


def _openhands_llms() -> dict[str, object]:
    from openhands.sdk.llm.llm import LLM

    return {
        "gpt-4o-mini": LLM(
            model="openai/gpt-4o-mini",
            api_key=None,
            usage_id="test-mini",
        ),
        "claude-4": LLM(
            model="anthropic/claude-4",
            api_key=None,
            usage_id="test-c4",
        ),
    }


def test_router_llm_returns_hokusai_key_on_select() -> None:
    client = _FakeClient(
        [
            Recommendation(
                route_id="route-A", selected_model="openai/gpt-4o-mini"
            ),
        ]
    )
    resolver = HokusaiRouteResolver(
        client=client,  # type: ignore[arg-type]
        bindings=[
            ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini"),
            ModelBinding(key="claude-4", model_id="anthropic/claude-4"),
        ],
    )
    router = create_hokusai_router_llm(resolver, llms_for_routing=_openhands_llms())

    key = router.select_llm([])
    assert key == "gpt-4o-mini"

    call_id = last_call_id(router)
    assert call_id is not None
    decision = resolver.get_decision(call_id)
    assert decision is not None
    assert decision.route_id == "route-A"


def test_router_llm_requires_resolver_to_be_attached() -> None:
    resolver = HokusaiRouteResolver(
        client=_FakeClient(  # type: ignore[arg-type]
            [
                Recommendation(
                    route_id="route-A", selected_model="openai/gpt-4o-mini"
                )
            ]
        ),
        bindings=[ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini")],
    )
    router = create_hokusai_router_llm(
        resolver, llms_for_routing={"gpt-4o-mini": _openhands_llms()["gpt-4o-mini"]}
    )
    # Wipe the resolver binding and expect a clear configuration error.
    router.__dict__.pop("_hokusai_router_state", None)
    with pytest.raises(ConfigurationError):
        hokusai_select_llm(router, [])


def test_create_router_rejects_missing_llms_for_routing_key() -> None:
    resolver = HokusaiRouteResolver(
        client=_FakeClient([]),  # type: ignore[arg-type]
        bindings=[ModelBinding(key="mystery", model_id="openai/gpt-4o-mini")],
    )
    with pytest.raises(ConfigurationError):
        create_hokusai_router_llm(
            resolver, llms_for_routing={"gpt-4o-mini": _openhands_llms()["gpt-4o-mini"]}
        )


def test_attach_hokusai_resolver_overwrites_existing_binding() -> None:
    resolver_a = HokusaiRouteResolver(
        client=_FakeClient(  # type: ignore[arg-type]
            [Recommendation(route_id="route-A", selected_model="openai/gpt-4o-mini")]
        ),
        bindings=[ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini")],
    )
    resolver_b = HokusaiRouteResolver(
        client=_FakeClient(  # type: ignore[arg-type]
            [Recommendation(route_id="route-B", selected_model="openai/gpt-4o-mini")]
        ),
        bindings=[ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini")],
    )
    router = create_hokusai_router_llm(
        resolver_a, llms_for_routing={"gpt-4o-mini": _openhands_llms()["gpt-4o-mini"]}
    )
    attach_hokusai_resolver(router, resolver_b)
    router.select_llm([])
    call_id = last_call_id(router)
    assert call_id is not None
    assert resolver_b.get_decision(call_id) is not None
    assert resolver_a.active_call_ids() == []
