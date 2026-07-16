from __future__ import annotations

import pytest

from hokusai_openhands.errors import ModelUnavailableError
from hokusai_openhands.models import (
    allowed_model_ids,
    list_runnable_models,
    map_recommendation_to_runnable_model,
)


class FakeLLM:
    def __init__(
        self,
        *,
        model: str,
        usage_id: str,
        hokusai_aliases: tuple[str, ...] = (),
    ) -> None:
        self.model = model
        self.usage_id = usage_id
        self.hokusai_aliases = hokusai_aliases


LLMS = {
    "fast": FakeLLM(
        model="openhands/devstral-small-2507",
        usage_id="agent-fast",
        hokusai_aliases=("devstral-small",),
    ),
    "quality": FakeLLM(
        model="openhands/claude-sonnet-4-5-20250929",
        usage_id="agent-quality",
    ),
}


def test_list_runnable_models_preserves_explicit_identifiers() -> None:
    runnable_models = list_runnable_models(LLMS)
    assert [model.key for model in runnable_models] == ["fast", "quality"]
    assert allowed_model_ids(runnable_models) == [
        "openhands/devstral-small-2507",
        "openhands/claude-sonnet-4-5-20250929",
    ]


def test_map_recommendation_matches_explicit_alias() -> None:
    selection = map_recommendation_to_runnable_model("devstral-small", LLMS)
    assert selection.key == "fast"
    assert selection.model_id == "openhands/devstral-small-2507"
    assert selection.fallback_used is False


def test_map_recommendation_declines_unknown_model_by_default() -> None:
    with pytest.raises(ModelUnavailableError) as excinfo:
        map_recommendation_to_runnable_model("openhands/unknown-model", LLMS)
    message = str(excinfo.value)
    assert "openhands/unknown-model" in message
    assert "openhands/devstral-small-2507" in message
    assert "openhands/claude-sonnet-4-5-20250929" in message


def test_map_recommendation_uses_configured_fallback() -> None:
    selection = map_recommendation_to_runnable_model(
        "openhands/unknown-model",
        LLMS,
        fallback_model="fast",
    )
    assert selection.key == "fast"
    assert selection.fallback_used is True


def test_map_recommendation_rejects_empty_model_set() -> None:
    with pytest.raises(ValueError):
        map_recommendation_to_runnable_model("openhands/devstral-small-2507", {})


def test_map_recommendation_rejects_invalid_fallback() -> None:
    with pytest.raises(ValueError):
        map_recommendation_to_runnable_model(
            "openhands/unknown-model",
            LLMS,
            fallback_model="not-configured",
        )
