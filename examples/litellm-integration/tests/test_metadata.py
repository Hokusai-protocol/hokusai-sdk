from __future__ import annotations

from typing import Any

import pytest

from hokusai_litellm import metadata
from hokusai_litellm.errors import PromptLeakageError


class ContentTrap:
    def __getitem__(self, key: str) -> Any:
        raise AssertionError(f"message field should not be read: {key}")


def test_build_routing_metadata_returns_allowlisted_fields_only() -> None:
    result = metadata.build_routing_metadata(
        {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": "secret"}],
            "metadata": {"task_type": "bugfix", "quality_tier": "high"},
        },
        candidate_models=["gpt-4o-mini", "gpt-4o"],
        latency_budget_ms=500,
        budget_usd=0.05,
    )

    assert set(result).issubset(metadata.ALLOWED_ROUTING_FIELDS)
    assert result["task_type"] == "bugfix"
    assert result["candidate_models"] == ["gpt-4o-mini", "gpt-4o"]
    assert result["latency_budget_ms"] == 500
    assert result["budget_usd"] == 0.05


def test_build_routing_metadata_uses_message_count_only() -> None:
    result = metadata.build_routing_metadata(
        {
            "messages": [ContentTrap(), ContentTrap()],
            "metadata": {"estimated_input_tokens": 250},
        },
        candidate_models=["gpt-4o-mini"],
    )

    assert result["estimated_input_tokens"] == 258
    assert result["task_type"] == "unknown"


def test_build_routing_metadata_raises_if_forbidden_key_is_injected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        metadata,
        "ALLOWED_ROUTING_FIELDS",
        metadata.ALLOWED_ROUTING_FIELDS | {"prompt"},
    )

    with pytest.raises(PromptLeakageError):
        metadata.build_routing_metadata(
            {
                "metadata": {"prompt": "SECRET_PROMPT_TOKEN"},
            },
            candidate_models=["gpt-4o-mini"],
        )


def test_build_routing_metadata_derives_tool_usage_without_reading_tool_payload() -> None:
    result = metadata.build_routing_metadata(
        {
            "tools": [{"function": {"parameters": "SECRET_TOOL_ARG"}}],
            "metadata": {"task_type": "bugfix"},
        },
        candidate_models=["gpt-4o-mini"],
    )

    assert result["requires_tools"] is True
