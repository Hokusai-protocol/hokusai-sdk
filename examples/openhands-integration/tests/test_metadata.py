from __future__ import annotations

import pytest

from hokusai_openhands.errors import PromptLeakageError
from hokusai_openhands.metadata import build_routing_metadata


def test_build_routing_metadata_allowlists_safe_fields() -> None:
    metadata = build_routing_metadata(
        {
            "task_type": "bugfix",
            "estimated_output_tokens": 512,
            "latency_budget_ms": 600,
            "quality_tier": "speed",
            "requires_tools": True,
            "context_length_needed": 32768,
            "budget_usd": 0.02,
            "ignored_field": "not forwarded",
        },
        candidate_models=["openhands/devstral-small-2507"],
        messages=[{"role": "user", "content": "SECRET"}],
        integration_version="hokusai-openhands-example/0.1.0",
    )

    assert metadata["task_type"] == "bugfix"
    assert metadata["candidate_models"] == ["openhands/devstral-small-2507"]
    assert metadata["estimated_input_tokens"] == 4
    assert "ignored_field" not in metadata


def test_build_routing_metadata_rejects_forbidden_keys() -> None:
    with pytest.raises(PromptLeakageError):
        build_routing_metadata(
            {"task_type": "bugfix", "prompt": "SECRET_PROMPT_TOKEN"},
            candidate_models=["openhands/devstral-small-2507"],
            integration_version="hokusai-openhands-example/0.1.0",
        )
