from __future__ import annotations

from types import SimpleNamespace

from hokusai_openhands.metrics import extract_metrics, infer_completion_result


class FakeConversationStats:
    def __init__(self, metrics: object) -> None:
        self.metrics = metrics

    def get_metrics_for_usage(self, usage_id: str) -> object:
        _ = usage_id
        return self.metrics


def test_extract_metrics_reads_cost_tokens_and_latency() -> None:
    metrics = SimpleNamespace(
        accumulated_cost=0.013,
        accumulated_token_usage=SimpleNamespace(
            prompt_tokens=120,
            completion_tokens=45,
        ),
        response_latencies=[
            SimpleNamespace(latency=0.2),
            SimpleNamespace(latency=0.4),
        ],
    )
    conversation = SimpleNamespace(
        state=SimpleNamespace(
            execution_status=SimpleNamespace(value="finished"),
            stats=FakeConversationStats(metrics),
        )
    )

    snapshot = extract_metrics(
        conversation=conversation,
        usage_id="agent-fast",
    )

    assert snapshot.actual_cost_usd == 0.013
    assert snapshot.prompt_tokens == 120
    assert snapshot.completion_tokens == 45
    assert snapshot.total_tokens == 165
    assert snapshot.latency_seconds == 0.6000000000000001
    assert snapshot.completion_result == "success"


def test_extract_metrics_handles_missing_metrics_object() -> None:
    conversation = SimpleNamespace(
        state=SimpleNamespace(execution_status=SimpleNamespace(value="error"))
    )

    snapshot = extract_metrics(conversation=conversation)

    assert snapshot.actual_cost_usd is None
    assert snapshot.prompt_tokens is None
    assert snapshot.latency_seconds is None
    assert snapshot.completion_result == "failure"


def test_infer_completion_result_returns_none_for_non_terminal_status() -> None:
    conversation = SimpleNamespace(
        state=SimpleNamespace(execution_status=SimpleNamespace(value="running"))
    )
    assert infer_completion_result(conversation) is None
