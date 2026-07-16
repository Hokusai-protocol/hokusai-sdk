from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from hokusai_openhands import metadata as metadata_mod
from hokusai_openhands.errors import PromptLeakageError
from hokusai_openhands.telemetry import snapshot_from_metrics


def test_build_routing_metadata_returns_allowlisted_fields_only() -> None:
    result = metadata_mod.build_routing_metadata(
        candidate_models=["openai/gpt-4o-mini", "anthropic/claude-4"],
        task_metadata={
            "task_type": "bugfix",
            "quality_tier": "high",
            "estimated_input_tokens": 400,
        },
        message_count=6,
        latency_budget_ms=800,
        budget_usd=0.10,
        integration_version="hokusai-openhands-example/0.1.0",
    )

    assert set(result).issubset(metadata_mod.ALLOWED_ROUTING_FIELDS)
    assert result["task_type"] == "bugfix"
    assert result["quality_tier"] == "high"
    assert result["candidate_models"] == ["openai/gpt-4o-mini", "anthropic/claude-4"]
    assert result["latency_budget_ms"] == 800
    assert result["budget_usd"] == 0.10
    assert result["estimated_input_tokens"] == 400
    assert result["message_count"] == 6


def test_build_routing_metadata_estimates_input_tokens_from_message_count() -> None:
    result = metadata_mod.build_routing_metadata(
        candidate_models=["openai/gpt-4o-mini"],
        task_metadata={"task_type": "refactor"},
        message_count=5,
        integration_version="hokusai-openhands-example/0.1.0",
    )

    assert result["estimated_input_tokens"] == 20
    assert result["message_count"] == 5


def test_build_routing_metadata_ignores_unknown_metadata_keys() -> None:
    # Only allowlisted keys are read from ``task_metadata``. Even if a caller
    # passes prompt-shaped metadata, the resulting payload never carries it.
    result = metadata_mod.build_routing_metadata(
        candidate_models=["openai/gpt-4o-mini"],
        task_metadata={
            "task_type": "bugfix",
            "prompt": "SECRET_PROMPT_TOKEN",
            "messages": [{"role": "user", "content": "SECRET_PROMPT_TOKEN"}],
        },
        message_count=2,
        integration_version="hokusai-openhands-example/0.1.0",
    )
    import json

    serialized = json.dumps(result)
    assert "SECRET_PROMPT_TOKEN" not in serialized
    assert set(result).issubset(metadata_mod.ALLOWED_ROUTING_FIELDS)


def test_assert_safe_routing_metadata_rejects_forbidden_key() -> None:
    with pytest.raises(PromptLeakageError):
        metadata_mod.assert_safe_routing_metadata(
            {"task_type": "bugfix", "prompt": "SECRET_PROMPT_TOKEN"}
        )


class _FakeMetrics:
    def __init__(self) -> None:
        self.accumulated_cost = 0.00321
        self.accumulated_token_usage = _FakeUsage(115, 305)
        self.response_latencies = [0.45, 0.58]


class _FakeUsage:
    def __init__(self, prompt: int, completion: int) -> None:
        self.prompt_tokens = prompt
        self.completion_tokens = completion

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


def test_snapshot_from_metrics_reads_openhands_style_object() -> None:
    snapshot = snapshot_from_metrics(_FakeMetrics(), completion_result="success")
    assert snapshot.accumulated_cost == 0.00321
    assert snapshot.prompt_tokens == 115
    assert snapshot.completion_tokens == 305
    assert snapshot.total_tokens == 420
    assert snapshot.latency_seconds == 0.58
    assert snapshot.completion_result == "success"


def test_snapshot_from_metrics_falls_back_to_wall_clock() -> None:
    start = datetime(2026, 7, 16, 12, 0, 0, tzinfo=UTC)
    end = start + timedelta(milliseconds=750)
    snapshot = snapshot_from_metrics(
        {"accumulated_cost": None},
        started_at=start,
        ended_at=end,
    )
    assert snapshot.accumulated_cost is None
    assert snapshot.latency_seconds == pytest.approx(0.75, rel=1e-6)
    assert snapshot.completion_result == "unknown"


def test_snapshot_from_metrics_handles_missing_costs_and_tokens() -> None:
    snapshot = snapshot_from_metrics({}, completion_result="failure")
    assert snapshot.accumulated_cost is None
    assert snapshot.prompt_tokens is None
    assert snapshot.completion_tokens is None
    assert snapshot.total_tokens is None
    assert snapshot.latency_seconds is None
    assert snapshot.completion_result == "failure"


def test_snapshot_from_metrics_marks_failure_when_error_present() -> None:
    snapshot = snapshot_from_metrics(
        {"accumulated_cost": 0.001},
        error=RuntimeError("boom"),
    )
    assert snapshot.completion_result == "failure"
    assert snapshot.error_type == "RuntimeError"


class _FakeConversationStats:
    def __init__(self) -> None:
        self._combined = {
            "accumulated_cost": 0.00512,
            "prompt_tokens": 210,
            "completion_tokens": 480,
            "response_latencies": [0.9],
        }

    def get_combined_metrics(self) -> dict[str, object]:
        return self._combined


def test_snapshot_from_conversation_stats_uses_combined_metrics() -> None:
    snapshot = snapshot_from_metrics(_FakeConversationStats(), completion_result="success")
    assert snapshot.accumulated_cost == 0.00512
    assert snapshot.prompt_tokens == 210
    assert snapshot.completion_tokens == 480
    assert snapshot.total_tokens == 690
    assert snapshot.latency_seconds == 0.9
    assert snapshot.completion_result == "success"
