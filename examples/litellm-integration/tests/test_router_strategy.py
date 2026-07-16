from __future__ import annotations

import logging

import pytest

from hokusai_litellm.errors import ConfigurationError, RoutingCallFailed
from hokusai_litellm.hokusai_client import Recommendation
from hokusai_litellm.router_strategy import HokusaiRoutingStrategy, map_recommendation_to_deployment


class FakeClient:
    def __init__(self, recommendation: Recommendation | Exception) -> None:
        self.recommendation = recommendation

    async def select_model(self, metadata: dict[str, object]) -> Recommendation:
        if isinstance(self.recommendation, Exception):
            raise self.recommendation
        return self.recommendation


DEPLOYMENTS = [
    {
        "model_name": "gpt-4o-mini",
        "litellm_params": {"model": "openai/gpt-4o-mini"},
        "model_info": {"hokusai_id": "gpt-4o-mini"},
    },
    {
        "model_name": "gpt-4o",
        "litellm_params": {"model": "azure/gpt-4o"},
        "model_info": {"hokusai_id": "gpt-4o"},
    },
]


def test_map_recommendation_to_deployment_matches_aliases() -> None:
    deployment, fallback_used = map_recommendation_to_deployment("azure/gpt-4o", DEPLOYMENTS)
    assert deployment["model_name"] == "gpt-4o"
    assert fallback_used is False


def test_map_recommendation_to_deployment_falls_back_when_unknown() -> None:
    deployment, fallback_used = map_recommendation_to_deployment("unknown-model", DEPLOYMENTS)
    assert deployment["model_name"] == "gpt-4o-mini"
    assert fallback_used is True


def test_map_recommendation_to_deployment_rejects_empty_deployments() -> None:
    with pytest.raises(ConfigurationError):
        map_recommendation_to_deployment("gpt-4o-mini", [])


@pytest.mark.asyncio
async def test_routing_strategy_maps_recommendation_and_stashes_metadata() -> None:
    strategy = HokusaiRoutingStrategy(
        FakeClient(Recommendation(model="gpt-4o", inference_log_id="route-1")),  # type: ignore[arg-type]
        DEPLOYMENTS,
    )
    kwargs = {
        "messages": [{"role": "user", "content": "SECRET_PROMPT_TOKEN"}],
        "metadata": {"task_type": "bugfix"},
    }

    deployment = await strategy.async_get_available_deployment(
        model="router-group",
        messages=kwargs["messages"],
        request_kwargs=kwargs,
    )

    assert deployment["model_name"] == "gpt-4o"
    assert kwargs["metadata"]["hokusai"]["selected_model_id"] == "gpt-4o"
    assert kwargs["metadata"]["hokusai"]["allowed_deployment_names"] == ["gpt-4o-mini", "gpt-4o"]
    assert kwargs["metadata"]["hokusai"]["fallback_used"] is False


@pytest.mark.asyncio
async def test_routing_strategy_fails_open_on_client_errors(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING)
    strategy = HokusaiRoutingStrategy(
        FakeClient(RoutingCallFailed("timeout")),  # type: ignore[arg-type]
        DEPLOYMENTS,
    )
    kwargs = {"metadata": {"task_type": "bugfix"}}

    deployment = await strategy.async_get_available_deployment(
        model="router-group",
        request_kwargs=kwargs,
    )

    assert deployment["model_name"] == "gpt-4o-mini"
    assert kwargs["metadata"]["hokusai"]["fallback_used"] is True
    assert "failed open" in caplog.text


@pytest.mark.asyncio
async def test_routing_strategy_falls_back_when_recommendation_missing() -> None:
    strategy = HokusaiRoutingStrategy(
        FakeClient(Recommendation(model=None, inference_log_id="route-1")),  # type: ignore[arg-type]
        DEPLOYMENTS,
    )

    deployment = await strategy.async_get_available_deployment(
        model="router-group",
        request_kwargs={"metadata": {"task_type": "bugfix"}},
    )

    assert deployment["model_name"] == "gpt-4o-mini"
